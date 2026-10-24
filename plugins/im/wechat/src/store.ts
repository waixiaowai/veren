/**
 * The WeChat storage domain and its store implementation.
 *
 * Account state (display name, owner, base URL, cursor, deduplication ring) and
 * the per-user `context_token` cache live in the `im_wechat` storage domain on
 * the profile's default backend. Split out of `state.ts` so the type surface
 * and the credential seam stay under the file-size ceiling; the export surface
 * of `state.ts` is unchanged — it re-exports the domain names from here.
 *
 * 微信存储域与其存储实现。账号状态（显示名、owner、base URL、游标、去重环）与按用户的
 * `context_token` 缓存位于 `im_wechat` 存储域，走 profile 的默认后端。按职责从 `state.ts`
 * 拆出，让类型面与凭据边界保持在单文件行数上限内；`state.ts` 的导出面不变——它从这里
 * 原样再导出域相关名字。
 *
 * @module @veren/im-wechat/store
 */

import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import type { Context } from '@deepseek-ai/cordis'
import type { WechatState, WechatStore } from './state.ts'

/** One `im_wechat.accounts` row. */
interface WechatAccountRow {
  account_id: string
  display_name: string
  owner_id?: string
  base_url: string
  cursor: string
  seen: string[]
}

/** One `im_wechat.contexts` row; `updated_at` orders pruning only. */
interface WechatContextRow {
  account_id: string
  user_id: string
  token: string
  updated_at: number
}

const accountSchema = z.object({
  account_id: z.string().min(1),
  display_name: z.string().min(1),
  owner_id: z.string().optional(),
  base_url: z.string().min(1),
  cursor: z.string(),
  seen: z.array(z.string()),
})

const contextSchema = z.object({
  account_id: z.string().min(1),
  user_id: z.string().min(1),
  token: z.string().min(1),
  updated_at: z.number(),
})

/**
 * Authoritative WeChat storage: a provider-owned domain on the shared storage
 * facility. Channel state belongs to the channel package, while the backend,
 * validation, lifecycle, and durability are the same for every domain plugin.
 * 权威微信存储：共享存储设施上的 provider 自有域。渠道状态属于渠道包，而后端、校验、
 * 生命周期与持久化与其他 domain 插件完全一致。
 */
export const wechatDomain = defineDomain({
  name: 'im_wechat',
  version: 1,
  tables: {
    accounts: domainTable<string, WechatAccountRow>(accountSchema),
    contexts: domainTable<string, WechatContextRow>(contextSchema),
  },
})

/** Domain name, shared with diagnostics. */
export const WECHAT_DOMAIN_NAME = wechatDomain.name

/** Upper bound on cached per-user context tokens for one account. */
export const WECHAT_CONTEXT_LIMIT = 200

/** Stable key for one account/user context row. */
function contextKey(accountId: string, userId: string): string {
  return `${accountId}\u0000${userId}`
}

/** Copy a stored row into the mutable runtime state. */
function toState(row: WechatAccountRow): WechatState {
  return {
    accountId: row.account_id,
    displayName: row.display_name,
    ...(row.owner_id === undefined ? {} : { ownerId: row.owner_id }),
    baseUrl: row.base_url,
    cursor: row.cursor,
    seen: [...row.seen],
  }
}

/** Copy runtime state into one storage row. */
function toRow(state: WechatState): WechatAccountRow {
  return {
    account_id: state.accountId,
    display_name: state.displayName,
    ...(state.ownerId === undefined ? {} : { owner_id: state.ownerId }),
    base_url: state.baseUrl,
    cursor: state.cursor,
    seen: [...state.seen],
  }
}

/** Store backed by the `im_wechat` domain. */
export class DomainWechatStore implements WechatStore {
  constructor(private readonly domain: Domain<typeof wechatDomain>) {}

  states(): WechatState[] {
    return [...this.domain.table('accounts').entries()].map(([, row]) => toState(row))
  }

  async putState(state: WechatState): Promise<void> {
    await this.domain.table('accounts').put(state.accountId, toRow(state))
  }

  async deleteState(accountId: string): Promise<void> {
    await this.domain.table('accounts').delete(accountId)
    await this.deleteContexts(accountId)
  }

  contextToken(accountId: string, userId: string): string | undefined {
    return this.domain.table('contexts').get(contextKey(accountId, userId))?.token
  }

  async putContextToken(accountId: string, userId: string, token: string, now: number): Promise<void> {
    const table = this.domain.table('contexts')
    await table.put(contextKey(accountId, userId), {
      account_id: accountId,
      user_id: userId,
      token,
      updated_at: now,
    })
    const own = [...table.entries()].filter(([, row]) => row.account_id === accountId)
    if (own.length <= WECHAT_CONTEXT_LIMIT) return
    own.sort((left, right) => left[1].updated_at - right[1].updated_at)
    for (const [key] of own.slice(0, own.length - WECHAT_CONTEXT_LIMIT)) await table.delete(key)
  }

  async deleteContexts(accountId: string): Promise<void> {
    const table = this.domain.table('contexts')
    for (const [key, row] of [...table.entries()]) {
      if (row.account_id === accountId) await table.delete(key)
    }
  }

  /** Close the underlying domain; safe to call twice. */
  async close(): Promise<void> {
    await this.domain.close()
  }
}

/**
 * Open the WeChat domain, closing a handle left by a previous activation first.
 * An open failure propagates, so a missing backend or a malformed row fails the
 * plugin loudly instead of starting a provider that cannot persist anything.
 * 打开微信域；先关闭上一次激活遗留的句柄。打开失败会向上抛出，因此后端缺失或记录损坏会让
 * 插件明确失败，而不是启动一个无法持久化的 provider。
 * @param ctx - context carrying `storageDomain` and `logger`.
 * @returns the opened store.
 */
export async function openWechatStore(ctx: Context): Promise<DomainWechatStore> {
  const stale = ctx.storageDomain.get(WECHAT_DOMAIN_NAME)
  if (stale !== undefined) {
    try {
      await stale.close()
      ctx.logger.warn('[im:wechat] closed the storage domain left open by a previous activation')
    } catch (error: unknown) {
      ctx.logger.warn(`[im:wechat] the previous storage domain could not close: ${String(error)}`)
    }
  }
  return new DomainWechatStore(await ctx.storageDomain.open(wechatDomain))
}
