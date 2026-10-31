/**
 * Browser-session lifecycle of the local auth provider: issuing, projecting
 * and revoking session records.
 *
 * Session tokens exist only as the returned plaintext; the stored record keeps
 * a SHA-256 hash, so a database leak cannot be replayed as a sign-in.
 *
 * 本地认证 provider 的浏览器会话生命周期：签发、投影与吊销会话记录。会话令牌只以
 * 返回的明文存在；存储记录只留 SHA-256 散列，因此数据库泄漏也无法重放为登录。
 *
 * @module @veren/admin-auth-local/sessions
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { AdminSessionView } from '@veren/admin-contract'
import { hashToken, randomToken } from './passwords.ts'
import type { ResolvedAuthConfig } from './config.ts'
import type { SessionRecord, UserRecord } from './store.ts'
import { sessionTable } from './users.ts'

/**
 * Project a stored session into its public view.
 *
 * @param record - stored session 存储的会话
 * @returns the view 视图
 */
export function sessionView(record: SessionRecord): AdminSessionView {
  return { id: record.id, userId: record.userId, createdAt: record.createdAt, expiresAt: record.expiresAt }
}

/**
 * Open one session record and return its cookie token.
 *
 * @param ctx - owning context 所属上下文
 * @param config - resolved auth config 解析后的认证配置
 * @param user - the signed-in user 已登录用户
 * @returns the plaintext token and the stored record 明文令牌与存储记录
 */
export async function issueSession(
  ctx: Context,
  config: ResolvedAuthConfig,
  user: UserRecord,
): Promise<{ token: string; record: SessionRecord }> {
  const now = new Date()
  const token = randomToken()
  const record: SessionRecord = {
    id: randomUUID(),
    userId: user.id,
    tokenHash: hashToken(token),
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + config.sessionDays * 86_400_000).toISOString(),
    lastSeenAt: now.toISOString(),
  }
  await sessionTable(ctx).save(record)
  return { token, record }
}

/**
 * Drop every session of one user except the given one.
 *
 * @param ctx - owning context 所属上下文
 * @param userId - owning user id 所属用户 id
 * @param keepSessionId - session to keep, when known 要保留的会话（已知时）
 * @returns how many sessions were removed 移除的会话数
 */
export async function revokeSessionsExcept(
  ctx: Context,
  userId: string,
  keepSessionId: string | undefined,
): Promise<number> {
  let revoked = 0
  for (const record of sessionTable(ctx).list()) {
    if (record.userId !== userId || record.id === keepSessionId) continue
    await sessionTable(ctx).remove(record.id)
    revoked += 1
  }
  return revoked
}
