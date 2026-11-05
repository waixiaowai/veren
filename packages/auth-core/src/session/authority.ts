/**
 * 会话域权威（设计文档 modules/03-session.md）。
 * 铁律：先落库后分发；敏感操作读权威源；续期节流（距上次写入不足
 * updateAge 不回写）；过期即删（读到过期记录删除并清凭据）；记录 id 由
 * 服务端生成，token 为 32 位随机值。
 *
 * The session authority (design modules/03-session.md). Iron rules: persist
 * before distributing; sensitive operations read the authority; refresh
 * throttling (no rewrite within `updateAge`); expired means deleted (expire
 * rows are removed and credentials cleared); the record id is server
 * generated and the token is a 32-char random value.
 *
 * @module @veren/auth-core/session/authority
 */

import { randomBytes, randomUUID } from 'node:crypto'
import type { DBAdapter } from '../storage/adapter.ts'
import type { InternalAdapter, InternalAdapterHooks } from '../identity/internal-adapter.ts'
import type { SessionContext, SessionRow } from '../types.ts'

/** 会话域配置（秒）。 / The session config (seconds). */
export interface SessionAuthorityConfig {
  /** 有效期，默认 604800。 / Lifetime, default 604800. */
  expiresIn: number
  /** 续期节流，默认 86400；0 每次都续。 / Refresh throttle, default 86400; 0 refreshes always. */
  updateAge: number
  /** 新鲜度窗口，默认 86400。 / Freshness window, default 86400. */
  freshAge: number
}

/** 会话签发输入。 / The session-issuance input. */
export interface CreateSessionInput {
  userId: string
  dontRememberMe?: boolean
  ipAddress?: string | null
  userAgent?: string | null
}

/** 会话权威面。 / The session authority face. */
export interface SessionAuthority {
  create(input: CreateSessionInput): Promise<SessionRow>
  /** 按令牌解析权威会话；过期记录即删并返回 null。 / Resolve the authoritative session by token; expired rows delete and answer null. */
  find(token: string): Promise<SessionContext | null>
  /** 续期回写（调用方已过节流判定）。 / Rewrite the expiry (the caller has already applied throttling). */
  refresh(session: SessionContext): Promise<SessionContext | null>
  /** 按令牌吊销。 / Revoke by token. */
  revoke(token: string): Promise<void>
  /** 吊销某主体全部会话（可豁免当前令牌）。 / Revoke all sessions of a user (optionally sparing one token). */
  revokeAllForUser(userId: string, exceptToken?: string): Promise<void>
}

/** 32 位随机令牌。 / The 32-char random token. */
function newToken(): string {
  return randomBytes(32).toString('base64url')
}

/** 过期时间：不记住我缩至 1 天（§3.2）。 / Expiry: don't-remember shrinks to 1 day (§3.2). */
function expiryFor(config: SessionAuthorityConfig, dontRemember: boolean): Date {
  const seconds = dontRemember ? Math.min(config.expiresIn, 24 * 60 * 60) : config.expiresIn
  return new Date(Date.now() + seconds * 1000)
}

/** 会话是否已过期。 / Whether a session is past due. */
export function isExpired(session: SessionRow): boolean {
  return session.expiresAt.getTime() < Date.now()
}

/** 续期是否到期：剩余不足 `expiresIn - updateAge` 即到期（§3.4）。 / Whether refresh is due: remaining below `expiresIn - updateAge` (§3.4). */
export function isRefreshDue(session: SessionRow, config: SessionAuthorityConfig, dontRemember: boolean): boolean {
  if (config.updateAge === 0) return true
  if (dontRemember) return false
  const dueAt = session.expiresAt.getTime() - config.expiresIn * 1000 + config.updateAge * 1000
  return dueAt <= Date.now()
}

/** 新鲜度判定：会话创建时间在 freshAge 内（0 关闭检查）。 / Freshness: created within freshAge (0 disables). */
export function isFresh(session: SessionRow, config: SessionAuthorityConfig): boolean {
  if (config.freshAge === 0) return true
  return Date.now() - session.createdAt.getTime() <= config.freshAge * 1000
}

/**
 * 装配会话权威。会话写入前过 `hooks.session.create.before`（装配域钩子面）。
 * / Assemble the session authority. Writes pass `hooks.session.create.before`
 * (the context domain's hook face) first.
 */
export function createSessionAuthority(db: DBAdapter, internal: InternalAdapter, config: SessionAuthorityConfig, hooks?: InternalAdapterHooks): SessionAuthority {
  return {
    create: (input) => createSessionRow(db, hooks, config, input),
    find: (token) => findSession(db, internal, token),
    refresh: (session) => refreshSession(db, session, config),
    revoke: async (token) => {
      await db.delete({ model: 'session', where: [{ field: 'token', value: token }] })
    },
    revokeAllForUser: (userId, exceptToken) => revokeForUser(db, userId, exceptToken),
  }
}

/** 签发：先落库，成功后才由调用方下发凭据（铁律 1）。 / Issue: persist first; the caller distributes credentials only after success (iron rule 1). */
async function createSessionRow(db: DBAdapter, hooks: InternalAdapterHooks | undefined, config: SessionAuthorityConfig, input: CreateSessionInput): Promise<SessionRow> {
  const seeded: Record<string, unknown> = {
    id: randomUUID(),
    token: newToken(),
    userId: input.userId,
    expiresAt: expiryFor(config, input.dontRememberMe === true),
    ipAddress: input.ipAddress ?? null,
    userAgent: input.userAgent ?? null,
  }
  const before = hooks?.session?.create?.before
  const prepared = before === undefined ? seeded : (await before(seeded)) || seeded
  return db.create<SessionRow>({ model: 'session', data: prepared as Record<string, unknown>, forceAllowId: true })
}

/** 解析权威会话：记录缺失或已过期（记录即删）都返回 null（铁律 4）。 / Resolve the authoritative session: missing or expired (row deleted) both answer null (iron rule 4). */
async function findSession(db: DBAdapter, internal: InternalAdapter, token: string): Promise<SessionContext | null> {
  const row = await db.findOne<SessionRow>({ model: 'session', where: [{ field: 'token', value: token }] })
  if (row === null) return null
  if (isExpired(row)) {
    await db.delete({ model: 'session', where: [{ field: 'token', value: token }] })
    return null
  }
  const user = await internal.findUserById(row.userId)
  if (user === null) {
    await db.delete({ model: 'session', where: [{ field: 'token', value: token }] })
    return null
  }
  return { session: row, user, dontRemember: false }
}

/** 续期回写：写入失败（零行命中）返回 null——调用方据此清凭据（§3.4）。 / Rewrite the expiry: a zero-match write answers null so the caller clears credentials (§3.4). */
async function refreshSession(db: DBAdapter, session: SessionContext, config: SessionAuthorityConfig): Promise<SessionContext | null> {
  const expiresAt = new Date(Date.now() + config.expiresIn * 1000)
  const updated = await db.update<SessionRow>({
    model: 'session',
    where: [{ field: 'token', value: session.session.token }],
    update: { expiresAt },
  })
  if (updated === null) return null
  return { ...session, session: updated }
}

/** 吊销某主体全部会话（可豁免当前令牌）。 / Revoke all of a user's sessions (optionally sparing one token). */
async function revokeForUser(db: DBAdapter, userId: string, exceptToken?: string): Promise<void> {
  if (exceptToken === undefined) {
    await db.deleteMany({ model: 'session', where: [{ field: 'userId', value: userId }] })
    return
  }
  const rows = await db.findMany<SessionRow>({
    model: 'session',
    where: [{ field: 'userId', value: userId }, { field: 'token', operator: 'ne', value: exceptToken }],
  })
  for (const row of rows) {
    await db.delete({ model: 'session', where: [{ field: 'token', value: row.token }] })
  }
}
