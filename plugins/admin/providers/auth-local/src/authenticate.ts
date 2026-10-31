/**
 * Credential resolution of the local auth provider: turn a presented session
 * token or API token into an identity, or `undefined` when unusable.
 *
 * Both paths re-read the owning user on every call, so deactivating an account
 * cuts off its sessions and tokens without touching them one by one.
 *
 * 本地认证 provider 的凭据解析：把提交的会话令牌或 API token 解析为身份，不可用时
 * 为 `undefined`。两条路径每次调用都重读所属用户，因此停用账号会立即切断其会话与
 * token，无需逐一清理。
 *
 * @module @veren/admin-auth-local/authenticate
 */

import type { Context } from '@deepseek-ai/cordis'
import type { AdminIdentity } from '@veren/admin-contract'
import { hashToken } from './passwords.ts'
import type { ResolvedAuthConfig } from './config.ts'
import type { UserRecord } from './store.ts'
import { sessionTable, tokenTable, userTable } from './users.ts'

/** How a resolved user becomes an identity (the provider's role lookup). 由用户解析出身份的回调（provider 的角色查询）。 */
export type IdentityResolver = (user: UserRecord) => Promise<AdminIdentity>

/**
 * Resolve a browser session token, enforcing absolute and idle expiry.
 *
 * @param ctx - owning context 所属上下文
 * @param config - resolved auth config 解析后的认证配置
 * @param token - the cookie token Cookie 令牌
 * @param resolveIdentity - turns the user into an identity 把用户解析为身份
 * @returns the identity, or `undefined` when unusable 身份；不可用时为 `undefined`
 */
export async function authenticateSession(
  ctx: Context,
  config: ResolvedAuthConfig,
  token: string,
  resolveIdentity: IdentityResolver,
): Promise<AdminIdentity | undefined> {
  const hash = hashToken(token)
  const sessions = sessionTable(ctx)
  const session = sessions.list().find((entry) => entry.tokenHash === hash)
  if (session === undefined) return undefined
  const now = Date.now()
  const idleMs = now - new Date(session.lastSeenAt).getTime()
  if (new Date(session.expiresAt).getTime() <= now || idleMs > config.idleHours * 3_600_000) {
    await sessions.remove(session.id)
    return undefined
  }
  // Refreshing at most once a minute keeps a busy session one write per minute
  // instead of one write per request.
  // 每分钟最多刷新一次，让繁忙会话每分钟一次写入而非每请求一次。
  if (idleMs > 60_000) await sessions.save({ ...session, lastSeenAt: new Date(now).toISOString() })
  const user = userTable(ctx).find(session.userId)
  if (user === undefined || !user.active) return undefined
  return { ...(await resolveIdentity(user)), sessionId: session.id }
}

/**
 * Resolve an API token, rejecting revoked tokens.
 *
 * @param ctx - owning context 所属上下文
 * @param secret - the presented bearer secret 提交的 bearer 密钥
 * @param resolveIdentity - turns the user into an identity 把用户解析为身份
 * @returns the identity, or `undefined` when unusable 身份；不可用时为 `undefined`
 */
export async function authenticateToken(
  ctx: Context,
  secret: string,
  resolveIdentity: IdentityResolver,
): Promise<AdminIdentity | undefined> {
  const hash = hashToken(secret)
  const tokens = tokenTable(ctx)
  const token = tokens.list().find((entry) => entry.secretHash === hash)
  if (token === undefined || token.revokedAt !== undefined) return undefined
  const user = userTable(ctx).find(token.userId)
  if (user === undefined || !user.active) return undefined
  const lastUsed = new Date(token.lastUsedAt ?? token.createdAt).getTime()
  if (Date.now() - lastUsed > 60_000) await tokens.save({ ...token, lastUsedAt: new Date().toISOString() })
  return { ...(await resolveIdentity(user)), tokenId: token.id, scopes: token.scopes }
}
