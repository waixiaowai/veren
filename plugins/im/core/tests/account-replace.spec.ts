import { describe, expect, it } from 'vitest'
import { reconcileProviderAccounts, retireOwnerAccounts } from '../src/account-replace.ts'
import type { ImBinding } from '../src/contract.ts'
import type { ImAccountRow, ImConversationRow, ImPersonAddressRow } from '../src/store.ts'
import { MemoryStore } from './memory-store.ts'

/** One silent logger; retirement log lines are not under test. */
const logger = { info: () => undefined, warn: () => undefined, error: () => undefined }

/** The account shape a provider hands to persistAccount. */
function account(id: string, ownerId: string | undefined) {
  return { id, displayName: 'WeChat', ...(ownerId === undefined ? {} : { ownerId }), status: 'offline' as const }
}

/** One durable account row. */
async function putAccount(store: MemoryStore, id: string, ownerId: string): Promise<void> {
  const row: ImAccountRow = { id, provider: 'wechat', token_ref: `ref:${id}`, owner_id: ownerId }
  await store.putAccount(row)
}

/** One direct conversation row owned by an account. */
async function putConversation(store: MemoryStore, accountId: string, conversationId: string): Promise<void> {
  const row: ImConversationRow = { account_id: accountId, conversation_id: conversationId, kind: 'direct' }
  await store.putConversation(row)
}

/** One active binding owned by an account. */
async function putBinding(store: MemoryStore, id: string, accountId: string, conversationId: string, active = true): Promise<void> {
  const binding: ImBinding = { id, accountId, conversationId, sessionId: 'session-1', active, settings: {} }
  await store.putBinding(binding)
}

/** One person address row owned by an account. */
async function putAddress(store: MemoryStore, personId: string, accountId: string, externalId: string): Promise<void> {
  const row: ImPersonAddressRow = {
    person_id: personId,
    provider: 'wechat',
    account_id: accountId,
    conversation_id: `p2p:${externalId}`,
    external_id: externalId,
    updated_at: 1,
  }
  await store.putPersonAddress(row)
}

describe('retireOwnerAccounts', () => {
  it('moves conversations, the active binding, and addresses onto the new account', async () => {
    const store = new MemoryStore()
    await putAccount(store, 'old-1', 'owner-1')
    await putAccount(store, 'old-2', 'owner-1')
    await putAccount(store, 'new', 'owner-1')
    await putConversation(store, 'old-1', 'p2p:human')
    await putBinding(store, 'bind-1', 'old-2', 'p2p:human')
    await putAddress(store, 'person-1', 'old-1', 'human@im.wechat')
    await putAddress(store, 'person-1', 'old-2', 'human@im.wechat')

    const retired = await retireOwnerAccounts({ store, logger }, 'wechat', account('new', 'owner-1'))

    expect(retired).toEqual(['old-1', 'old-2'])
    expect(store.accounts().map(row => row.id)).toEqual(['new'])
    expect(store.conversations().map(row => row.account_id)).toEqual(['new'])
    const bindings = store.bindings()
    expect(bindings.map(row => row.id)).toEqual(['bind-1'])
    expect(bindings[0]).toMatchObject({ accountId: 'new', active: true })
    const addresses = store.personAddresses()
    expect(addresses.length).toBe(1)
    expect(addresses[0]).toMatchObject({ account_id: 'new', person_id: 'person-1' })
  })

  it('keeps one active binding per conversation and drops dead history', async () => {
    const store = new MemoryStore()
    await putAccount(store, 'old-1', 'owner-1')
    await putAccount(store, 'old-2', 'owner-1')
    await putConversation(store, 'old-1', 'p2p:human')
    await putBinding(store, 'bind-active', 'old-1', 'p2p:human')
    await putBinding(store, 'bind-stale', 'old-1', 'p2p:human', false)
    await putBinding(store, 'bind-later', 'old-2', 'p2p:human')

    await retireOwnerAccounts({ store, logger }, 'wechat', account('new', 'owner-1'))

    const bindings = store.bindings()
    expect(bindings.length).toBe(1)
    expect(bindings[0]).toMatchObject({ id: 'bind-active', accountId: 'new', active: true })
  })

  it('leaves other owners and ownerless new accounts untouched', async () => {
    const store = new MemoryStore()
    await putAccount(store, 'other-owner', 'owner-2')
    await putConversation(store, 'other-owner', 'p2p:other')

    const retired = await retireOwnerAccounts({ store, logger }, 'wechat', account('new', 'owner-1'))
    expect(retired).toEqual([])
    expect(store.accounts().map(row => row.id)).toEqual(['other-owner'])

    const none = await retireOwnerAccounts({ store, logger }, 'wechat', account('new-2', undefined))
    expect(none).toEqual([])
    expect(store.accounts().length).toBe(1)
  })

  it('is a no-op when the owner has no previous accounts', async () => {
    const store = new MemoryStore()
    await putAccount(store, 'new', 'owner-1')

    const retired = await retireOwnerAccounts({ store, logger }, 'wechat', account('new', 'owner-1'))

    expect(retired).toEqual([])
    expect(store.accounts().length).toBe(1)
  })

  it('reconciles a polluted store against the provider live list', async () => {
    const store = new MemoryStore()
    await putAccount(store, 'ghost-1', 'owner-1')
    await putAccount(store, 'ghost-2', 'owner-1')
    await putAccount(store, 'live', 'owner-1')
    await putConversation(store, 'ghost-1', 'p2p:human')
    await putBinding(store, 'bind-1', 'ghost-2', 'p2p:human')
    await putAddress(store, 'person-1', 'ghost-1', 'human@im.wechat')

    const retired = await reconcileProviderAccounts({ store, logger }, 'wechat', {
      accounts: async () => [account('live', 'owner-1')],
    })

    expect(retired).toEqual(['ghost-1', 'ghost-2'])
    expect(store.accounts().map(row => row.id)).toEqual(['live'])
    expect(store.bindings()[0]).toMatchObject({ accountId: 'live', active: true })
  })

  it('keeps every live account even when one owner holds two', async () => {
    const store = new MemoryStore()
    await putAccount(store, 'live-a', 'owner-1')
    await putAccount(store, 'live-b', 'owner-1')

    const retired = await reconcileProviderAccounts({ store, logger }, 'wechat', {
      accounts: async () => [account('live-a', 'owner-1'), account('live-b', 'owner-1')],
    })

    expect(retired).toEqual([])
    expect(store.accounts().map(row => row.id)).toEqual(['live-a', 'live-b'])
  })

  it('skips reconciliation when the provider is unreachable', async () => {
    const store = new MemoryStore()
    await putAccount(store, 'ghost-1', 'owner-1')

    const retired = await reconcileProviderAccounts({ store, logger }, 'wechat', {
      accounts: async () => {
        throw new Error('network down')
      },
    })

    expect(retired).toEqual([])
    expect(store.accounts().map(row => row.id)).toEqual(['ghost-1'])
  })
})
