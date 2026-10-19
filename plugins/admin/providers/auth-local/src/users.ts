/**
 * User and API-token operations of the local auth provider.
 *
 * Email uniqueness, password strength and anti-lockout are enforced here rather
 * than in routes, so every caller (HTTP, a future CLI, a test) meets the same
 * rules.
 *
 * 本地认证 provider 的用户与 API token 操作。邮箱唯一性、口令强度与防自锁在这里而不�? * 路由里执行，因此每个调用方（HTTP、未来的 CLI、测试）面对同一套规则�? *
 * @module @veren/admin-auth-local/users
 */

import {
  AdminError,
  type AdminAccess,
  type AdminTable,
  type AdminTokenView,
  type AdminUserView,
} from '@veren/admin-contract'
import type { Context } from '@deepseek-ai/cordis'
import { randomUUID } from 'node:crypto'
import { hashPassword, hashToken, randomToken } from './passwords.ts'
import {
  isEmail,
  normalizeEmail,
  SESSIONS,
  TOKENS,
  USERS,
  type SessionRecord,
  type TokenRecord,
  type UserRecord,
} from './store.ts'

/** Password policy this provider enforces. �?provider 执行的口令策略�?*/
export interface PasswordPolicy {
  /** Minimum password length. 最小口令长度�?*/
  readonly minLength: number
}

/**
 * @param ctx - owning context 所属上下文
 * @returns the user collection 用户集合
 */
export function userTable(ctx: Context): AdminTable<UserRecord> {
  return ctx.adminData.table<UserRecord>(USERS)
}

/**
 * @param ctx - owning context 所属上下文
 * @returns the session collection 会话集合
 */
export function sessionTable(ctx: Context): AdminTable<SessionRecord> {
  return ctx.adminData.table<SessionRecord>(SESSIONS)
}

/**
 * @param ctx - owning context 所属上下文
 * @returns the token collection token 集合
 */
export function tokenTable(ctx: Context): AdminTable<TokenRecord> {
  return ctx.adminData.table<TokenRecord>(TOKENS)
}

/**
 * Find one user by normalized email.
 *
 * @param ctx - owning context 所属上下文
 * @param email - raw email 原始邮箱
 * @returns the user, or `undefined` 用户�?`undefined`
 */
export function findUserByEmail(ctx: Context, email: string): UserRecord | undefined {
  const normalized = normalizeEmail(email)
  return userTable(ctx).list().find((user) => user.email === normalized)
}

/**
 * Project one stored user into the admin view.
 *
 * @param ctx - owning context 所属上下文
 * @param user - stored user 存储的用�? * @returns the view 视图
 */
export async function userView(ctx: Context, user: UserRecord): Promise<AdminUserView> {
  const roles = await ctx.adminAccess.rolesOf(user.id)
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    active: user.active,
    roles,
    createdAt: user.createdAt,
    ...(user.lastLoginAt === undefined ? {} : { lastLoginAt: user.lastLoginAt }),
  }
}

/**
 * List every user with its bound roles.
 *
 * @param ctx - owning context 所属上下文
 * @returns the user views 用户视图
 */
export async function listUsers(ctx: Context): Promise<readonly AdminUserView[]> {
  const users = userTable(ctx).list()
  return Promise.all(users.map((user) => userView(ctx, user)))
}

/**
 * Create one user and bind its initial roles.
 *
 * @param ctx - owning context 所属上下文
 * @param policy - password policy 口令策略
 * @param input - user input 用户输入
 * @returns the stored user 存储的用�? */
export async function createUser(
  ctx: Context,
  policy: PasswordPolicy,
  input: { email: string; password: string; name: string; roles?: readonly string[] },
): Promise<UserRecord> {
  const email = normalizeEmail(input.email)
  if (!isEmail(email)) throw new AdminError('VALIDATION_FAILED', 'email is not valid', { field: 'email' })
  if (input.password.length < policy.minLength) {
    throw new AdminError('VALIDATION_FAILED', `password must be at least ${policy.minLength} characters`, {
      field: 'password',
      minLength: policy.minLength,
    })
  }
  if (findUserByEmail(ctx, email) !== undefined) {
    throw new AdminError('CONFLICT', `a user with email '${email}' already exists`, { field: 'email' })
  }
  const user: UserRecord = {
    id: randomUUID(),
    email,
    name: input.name.trim() || email,
    active: true,
    passwordHash: await hashPassword(input.password),
    createdAt: new Date().toISOString(),
  }
  await userTable(ctx).save(user)
  for (const role of input.roles ?? []) await ctx.adminAccess.assignRole(user.id, role)
  return user
}

/**
 * Apply a partial update to one user.
 *
 * @param ctx - owning context 所属上下文
 * @param policy - password policy 口令策略
 * @param id - user id 用户 id
 * @param patch - changed fields 变更字段
 * @returns the updated user 更新后的用户
 */
export async function updateUser(
  ctx: Context,
  policy: PasswordPolicy,
  id: string,
  patch: { name?: string; active?: boolean; password?: string },
): Promise<UserRecord> {
  const current = userTable(ctx).find(id)
  if (current === undefined) throw new AdminError('NOT_FOUND', `user '${id}' does not exist`, { userId: id })
  if (patch.password !== undefined && patch.password.length < policy.minLength) {
    throw new AdminError('VALIDATION_FAILED', `password must be at least ${policy.minLength} characters`, {
      field: 'password',
      minLength: policy.minLength,
    })
  }
  const next: UserRecord = {
    ...current,
    ...(patch.name === undefined ? {} : { name: patch.name.trim() || current.name }),
    ...(patch.active === undefined ? {} : { active: patch.active }),
    ...(patch.password === undefined ? {} : { passwordHash: await hashPassword(patch.password) }),
  }
  await userTable(ctx).save(next)
  return next
}

/**
 * Count how many users currently hold the owner role.
 *
 * @param ctx - owning context 所属上下文
 * @returns the owner count 所有者数�? */
export async function countOwners(ctx: Context): Promise<number> {
  const access: AdminAccess = ctx.adminAccess
  const roles = await Promise.all(userTable(ctx).list().map((user) => access.rolesOf(user.id)))
  return roles.filter((bound) => bound.includes('owner')).length
}

/**
 * Delete one user, its sessions, its tokens and its role bindings, refusing to
 * remove the deployment's last owner.
 *
 * @param ctx - owning context 所属上下文
 * @param id - user id 用户 id
 * @throws AdminError `LAST_OWNER` when the user is the last owner
 */
export async function deleteUser(ctx: Context, id: string): Promise<void> {
  const user = userTable(ctx).find(id)
  if (user === undefined) throw new AdminError('NOT_FOUND', `user '${id}' does not exist`, { userId: id })
  const roles = await ctx.adminAccess.rolesOf(id)
  if (roles.includes('owner') && (await countOwners(ctx)) <= 1) {
    throw new AdminError('LAST_OWNER', 'the last owner account cannot be deleted', { userId: id })
  }
  for (const session of sessionTable(ctx).list()) {
    if (session.userId === id) await sessionTable(ctx).remove(session.id)
  }
  for (const token of tokenTable(ctx).list()) {
    if (token.userId === id) await tokenTable(ctx).remove(token.id)
  }
  for (const role of roles) await ctx.adminAccess.revokeRole(id, role)
  await userTable(ctx).remove(id)
}

/**
 * Project one stored token into the admin view; the secret never appears.
 *
 * @param token - stored token 存储�?token
 * @returns the view 视图
 */
export function tokenView(token: TokenRecord): AdminTokenView {
  return {
    id: token.id,
    userId: token.userId,
    name: token.name,
    prefix: token.prefix,
    scopes: [...token.scopes],
    createdAt: token.createdAt,
    ...(token.revokedAt === undefined ? {} : { revokedAt: token.revokedAt }),
  }
}

/**
 * List one user's API tokens.
 *
 * @param ctx - owning context 所属上下文
 * @param userId - owning user id 所属用�?id
 * @returns the token views token 视图
 */
export function listTokens(ctx: Context, userId: string): readonly AdminTokenView[] {
  return tokenTable(ctx)
    .list()
    .filter((token) => token.userId === userId)
    .map(tokenView)
}

/**
 * Mint one API token. The plaintext secret is returned once.
 *
 * @param ctx - owning context 所属上下文
 * @param input - token input Token 输入
 * @returns the plaintext secret and its view 明文密钥与视�? */
export async function createToken(
  ctx: Context,
  input: { userId: string; name: string; scopes: readonly string[] },
): Promise<{ token: string; view: AdminTokenView }> {
  if (userTable(ctx).find(input.userId) === undefined) {
    throw new AdminError('NOT_FOUND', `user '${input.userId}' does not exist`, { userId: input.userId })
  }
  const secret = `adm_${randomToken(24)}`
  const record: TokenRecord = {
    id: randomUUID(),
    userId: input.userId,
    name: input.name.trim() || 'token',
    prefix: secret.slice(0, 12),
    secretHash: hashToken(secret),
    scopes: [...input.scopes],
    createdAt: new Date().toISOString(),
  }
  await tokenTable(ctx).save(record)
  return { token: secret, view: tokenView(record) }
}

/**
 * Revoke one API token; repeated revocation keeps the first timestamp.
 *
 * @param ctx - owning context 所属上下文
 * @param tokenId - token id Token id
 */
export async function revokeToken(ctx: Context, tokenId: string): Promise<void> {
  const token = tokenTable(ctx).find(tokenId)
  if (token === undefined) throw new AdminError('NOT_FOUND', `token '${tokenId}' does not exist`, { tokenId })
  if (token.revokedAt !== undefined) return
  await tokenTable(ctx).save({ ...token, revokedAt: new Date().toISOString() })
}
