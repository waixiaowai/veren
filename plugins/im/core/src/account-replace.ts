/**
 * Same-owner account replacement: one WeChat human is one live bot.
 *
 * A fresh QR authorization mints a new bot id on the provider side, and the
 * previous bots of the same owner are dead server-side. The durable tables
 * must follow: conversation rows, the active binding, and person address rows
 * move onto the new account, and the dead account rows are deleted — otherwise
 * the account list accumulates permanent offline ghosts (live counter-example:
 * one human, four listed accounts, three permanently offline).
 *
 * 同 owner 账号替换：一个微信号对应一只活 bot。
 *
 * 一次新的扫码授权会在 provider 侧铸造新 bot id，同 owner 的旧 bot 在服务端已死。持久化表
 * 必须跟着走：会话行、active 绑定与人员地址行改挂新账号，死账号行删除——否则账号列表会积累
 * 永久离线的幽灵（真机反例：一个人，四条账号，三条永久离线）。
 *
 * @module @veren/im/account-replace
 */

import type { ImAccount } from './contract.ts'
import { errorMessage } from './runtime-seams.ts'
import type { ImLogger } from './runtime-seams.ts'
import type { ImBindingStore, ImPersonStore } from './store.ts'

/** Storage and logging seams for the replacement. */
/** 替换所需的存储与日志接缝。 */
export interface ImRetireOptions {
  readonly store: ImBindingStore & ImPersonStore
  readonly logger: ImLogger
}

/**
 * Retire every same-owner same-provider account except the new one, moving
 * their conversations, active bindings, and person addresses onto it.
 * `protectedIds` lists accounts that must survive even when they share the
 * owner (the reconciliation path passes every live account). Returns the
 * retired account ids.
 * 除新账号外退役全部同 owner 同 provider 的账号，把它们的会话、active 绑定与人员地址
 * 改挂到新账号上。`protectedIds` 列出即使同 owner 也必须存活的账号（对账路径传入全部
 * 活账号）。返回被退役的账号 id。
 */
export async function retireOwnerAccounts(
  options: ImRetireOptions,
  providerId: string,
  account: ImAccount,
  protectedIds: ReadonlySet<string> = new Set(),
): Promise<string[]> {
  // owner 未知就无从谈起同主替换；保持原状，让既有的人工移除面兜底。
  // Without an owner there is nothing to match; leave the rows to the manual removal face.
  if (account.ownerId === undefined || account.ownerId === '') return []
  const retired: string[] = []
  const others = options.store.accounts()
    .filter(row => row.provider === providerId
      && row.owner_id === account.ownerId
      && row.id !== account.id
      && !protectedIds.has(row.id))
    .sort((left, right) => left.id.localeCompare(right.id))
  const claimed = new Set<string>()
  for (const other of others) {
    await migrateConversations(options.store, other.id, account.id)
    await migrateBindings(options.store, other.id, account.id, claimed)
    await migrateAddresses(options.store, other.id, account.id)
    await options.store.deleteAccount(other.id)
    retired.push(other.id)
  }
  if (retired.length > 0) {
    options.logger.info?.(
      `[im:bindings] owner ${account.ownerId} re-paired onto ${account.id};`
      + ` retired ${retired.length} dead account(s): ${retired.join(', ')}`,
    )
  }
  return retired
}

/**
 * Startup reconciliation: the provider's own live-account list is the server's
 * verdict on which bots are alive. Every same-owner durable row outside that
 * list is a leftover from a crash or missed cleanup and is retired onto its
 * live sibling. Runs when a provider registers, so a restart heals without
 * waiting for the next authorization.
 * 启动对账：provider 自己的活账号名单就是服务器对「哪些 bot 活着」的裁决。名单之外的
 * 同 owner 持久化行都是崩溃或清理失手窗口的遗留，退役改挂到同主的活账号上。它在 provider
 * 注册时运行，因此重启即自愈，不必等下一次授权。
 */
export async function reconcileProviderAccounts(
  options: ImRetireOptions,
  providerId: string,
  service: { accounts(): Promise<ImAccount[]> },
): Promise<string[]> {
  let live: ImAccount[]
  try {
    live = await service.accounts()
  } catch (error: unknown) {
    options.logger.warn(
      `[im:bindings] account reconciliation skipped: provider ${providerId} is unreachable: ${errorMessage(error)}`,
    )
    return []
  }
  const protectedIds = new Set(live.map(account => account.id))
  const retired: string[] = []
  for (const account of live) {
    if (account.ownerId === undefined || account.ownerId === '') continue
    try {
      retired.push(...await retireOwnerAccounts(options, providerId, account, protectedIds))
    } catch (error: unknown) {
      options.logger.warn(
        `[im:bindings] account reconciliation failed for ${account.id}: ${errorMessage(error)}`,
      )
    }
  }
  return retired
}

/** Move one dead account's conversation rows onto the new account. */
/** 把一个死账号的会话行改挂到新账号。 */
async function migrateConversations(
  store: ImBindingStore & ImPersonStore,
  oldId: string,
  newId: string,
): Promise<void> {
  for (const row of store.conversations().filter(entry => entry.account_id === oldId)) {
    await store.putConversation({ ...row, account_id: newId })
    await store.deleteConversation(oldId, row.conversation_id)
  }
}

/**
 * Move active bindings onto the new account; everything else about a dead
 * account is history without a future and is dropped. One conversation keeps
 * exactly one active binding: later duplicates are deleted, not stacked.
 * 把 active 绑定改挂到新账号；死账号的其余行是没有未来的历史，直接删除。一个会话只保留
 * 一条 active 绑定：后来的重复删除而不是叠放。
 */
async function migrateBindings(
  store: ImBindingStore & ImPersonStore,
  oldId: string,
  newId: string,
  claimed: Set<string>,
): Promise<void> {
  for (const binding of store.bindings().filter(entry => entry.accountId === oldId)) {
    if (!binding.active || claimed.has(binding.conversationId)) {
      await store.deleteBinding(binding.id)
      continue
    }
    await store.putBinding({ ...binding, accountId: newId })
    claimed.add(binding.conversationId)
  }
}

/**
 * Move one dead account's person address rows onto the new account. The
 * address key includes the account id, so each row re-keys: write the new-key
 * row first, then drop every old-key row of the dead account.
 * 把一个死账号的人员地址行改挂到新账号。地址键含账号 id，每行都要换键：先写新键行，
 * 再删除死账号的全部旧键行。
 */
async function migrateAddresses(
  store: ImBindingStore & ImPersonStore,
  oldId: string,
  newId: string,
): Promise<void> {
  for (const row of store.personAddresses().filter(entry => entry.account_id === oldId)) {
    await store.putPersonAddress({ ...row, account_id: newId })
  }
  await store.deletePersonAddressesOf(oldId)
}
