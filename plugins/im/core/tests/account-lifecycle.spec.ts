import { describe, expect, it } from 'vitest'
import { reconcileProviderAccounts, retireOwnerAccounts } from '../src/account-replace.ts'
import type { ImAccount } from '../src/contract.ts'
import type { ImAccountRow, ImConversationRow } from '../src/store.ts'
import { MemoryStore } from './memory-store.ts'

/**
 * Property-style lifecycle check: seeded random interleavings of pairing,
 * restarting, and inbound traffic must keep the account invariants. A failure
 * prints its seed so the exact scenario can be replayed.
 * 属性式生命周期检查：配对、重启与入站流量的种子化随机交错必须保住账号不变式。
 * 失败时打印种子，精确场景可以重放。
 */

const logger = { info: () => undefined, warn: () => undefined, error: () => undefined }

/** Deterministic PRNG (mulberry32) so scenarios never flake. */
function rng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** One simulated owner: the bot the provider reports live plus its conversations. */
interface SimOwner {
  ownerId: string
  liveBot: string
  conversations: string[]
}

/** Build one full account row. */
async function putAccount(store: MemoryStore, id: string, ownerId: string): Promise<void> {
  const row: ImAccountRow = { id, provider: 'wechat', token_ref: `ref:${id}`, owner_id: ownerId }
  await store.putAccount(row)
}

/** Build one conversation row. */
async function putConversation(store: MemoryStore, accountId: string, conversationId: string): Promise<void> {
  const row: ImConversationRow = { account_id: accountId, conversation_id: conversationId, kind: 'direct' }
  await store.putConversation(row)
}

/** The account shape a provider hands to persistAccount. */
function account(id: string, ownerId: string): ImAccount {
  return { id, displayName: 'WeChat', ownerId, status: 'offline' }
}

/** The invariants every operation must preserve. */
function assertInvariants(store: MemoryStore, live: ReadonlySet<string>, scenario: string): void {
  for (const row of store.accounts()) {
    expect(live.has(row.id), `${scenario}: account ${row.id} is durable but not server-live`).toBe(true)
  }
  for (const binding of store.bindings()) {
    expect(live.has(binding.accountId), `${scenario}: binding ${binding.id} points at a dead account`).toBe(true)
  }
  const activePerConversation = new Map<string, number>()
  for (const binding of store.bindings()) {
    if (!binding.active) continue
    activePerConversation.set(binding.conversationId, (activePerConversation.get(binding.conversationId) ?? 0) + 1)
  }
  for (const [conversation, count] of activePerConversation) {
    expect(count, `${scenario}: conversation ${conversation} has ${count} active bindings`).toBeLessThanOrEqual(1)
  }
  const addressKeys = new Set<string>()
  for (const address of store.personAddresses()) {
    expect(live.has(address.account_id), `${scenario}: address of ${address.external_id} sits on a dead account`).toBe(true)
    const key = `${address.person_id}\u0000${address.account_id}\u0000${address.external_id}`
    expect(addressKeys.has(key), `${scenario}: duplicate address row ${key}`).toBe(false)
    addressKeys.add(key)
  }
}

describe('account lifecycle invariants under seeded interleavings', () => {
  it('keeps the directory consistent across 200 randomized scenarios', async () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const random = rng(seed)
      const store = new MemoryStore()
      const owners: SimOwner[] = [
        { ownerId: 'owner-1', liveBot: 'bot-1@im.bot', conversations: ['p2p:human-1'] },
        { ownerId: 'owner-2', liveBot: 'bot-2@im.bot', conversations: ['p2p:human-2'] },
      ]
      const scenario = `seed=${seed}`
      const liveIds = new Set(owners.map(entry => entry.liveBot))
      for (const owner of owners) {
        await putAccount(store, owner.liveBot, owner.ownerId)
        for (const conversation of owner.conversations) await putConversation(store, owner.liveBot, conversation)
      }

      let counter = 0
      for (let step = 0; step < 24; step += 1) {
        const owner = owners[Math.floor(random() * owners.length)]!
        const roll = random()
        if (roll < 0.5) {
          // 重新扫码授权：新 bot 确认，旧 bot 退役迁移（生产路径 persistAccount 的序列）。
          counter += 1
          const freshBot = `bot-fresh-${counter}@im.bot`
          const protect = new Set(liveIds)
          protect.delete(owner.liveBot)
          await retireOwnerAccounts({ store, logger }, 'wechat', account(freshBot, owner.ownerId), protect)
          await putAccount(store, freshBot, owner.ownerId)
          liveIds.delete(owner.liveBot)
          liveIds.add(freshBot)
          owner.liveBot = freshBot
        } else if (roll < 0.75) {
          // 重启：以 provider 活名单为裁决对账（自愈路径）。
          await reconcileProviderAccounts({ store, logger }, 'wechat', {
            accounts: async () => owners.map(entry => account(entry.liveBot, entry.ownerId)),
          })
        } else {
          // 入站流量：在活账号上产生一条会话行（地址观察的最粗粒度代理）。
          const conversation = owner.conversations[Math.floor(random() * owner.conversations.length)]!
          await putConversation(store, owner.liveBot, conversation)
        }
        assertInvariants(store, liveIds, `${scenario} step=${step}`)
      }
      expect(store.accounts().length).toBeGreaterThan(0)
    }
  })
})
