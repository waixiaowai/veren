/**
 * Durable record types and small pure helpers of the local auth provider.
 *
 * Records are plain immutable values; every mutation writes a new object. The
 * three collections are owned by this provider and never read by another one.
 *
 * 本地认证 provider 的持久记录类型与小型纯函数。记录是不可变值；每次变更写入新对象。
 * 三个集合由本 provider 拥有，其他 provider 绝不直接读取。
 *
 * @module @veren/admin-auth-local/store
 */

import type { AdminEntity } from '@veren/admin-contract'

/** Collection of user accounts. 用户账号集合。 */
export const USERS = 'admin_users'

/** Collection of browser sessions. 浏览器会话集合。 */
export const SESSIONS = 'admin_sessions'

/** Collection of API tokens. API token 集合。 */
export const TOKENS = 'admin_tokens'

/**
 * One user account. The stored email is already normalized to lower case; the
 * display name is the only presentation field.
 *
 * 单个用户账号。存储的邮箱已归一化为小写；显示名是唯一的展示字段。
 */
export interface UserRecord extends AdminEntity {
  /** Normalized sign-in email. 归一化的登录邮箱。 */
  readonly email: string
  /** Display name. 显示名。 */
  readonly name: string
  /** Whether the account may sign in. 账号是否可登录。 */
  readonly active: boolean
  /** scrypt hash string. scrypt 散列串。 */
  readonly passwordHash: string
  /** Creation instant, ISO-8601 UTC. 创建时刻。 */
  readonly createdAt: string
  /** Last successful sign-in instant. 最近成功登录时刻。 */
  readonly lastLoginAt?: string
}

/** One browser session. 单个浏览器会话。 */
export interface SessionRecord extends AdminEntity {
  /** Owning user id. 所属用户 id。 */
  readonly userId: string
  /** SHA-256 of the cookie token. Cookie 令牌的 SHA-256。 */
  readonly tokenHash: string
  /** Creation instant. 创建时刻。 */
  readonly createdAt: string
  /** Absolute expiry instant. 绝对过期时刻。 */
  readonly expiresAt: string
  /** Last request instant, used for idle expiry. 最近请求时刻，用于空闲过期。 */
  readonly lastSeenAt: string
}

/** One API token. 单个 API token。 */
export interface TokenRecord extends AdminEntity {
  /** Owning user id. 所属用户 id。 */
  readonly userId: string
  /** Operator-supplied label. 运营方标签。 */
  readonly name: string
  /** Visible prefix for identification. 用于辨识的可见前缀。 */
  readonly prefix: string
  /** SHA-256 of the secret. 密钥的 SHA-256。 */
  readonly secretHash: string
  /** Granted scopes. 授予的 scope。 */
  readonly scopes: readonly string[]
  /** Creation instant. 创建时刻。 */
  readonly createdAt: string
  /** Last successful use instant. 最近成功使用时刻。 */
  readonly lastUsedAt?: string
  /** Revocation instant, when revoked. 撤销时刻。 */
  readonly revokedAt?: string
}

/**
 * Normalize an email for comparison and storage.
 *
 * @param email - raw input 原始输入
 * @returns the trimmed lower-case form 去空白的小写形式
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

/**
 * Whether an email is syntactically usable.
 *
 * @param email - normalized email 归一化邮箱
 * @returns whether it has the minimal shape the provider accepts 是否具备 provider 接受的最小形态
 */
export function isEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

/**
 * Derive the data scope from the bound roles. Owners and administrators see
 * everything; every other role is limited to its own records.
 *
 * 由绑定角色推导数据范围。所有者与管理员可见全部；其他角色只能看到自己的记录。
 *
 * @param roles - bound role ids 已绑定角色 id
 * @returns the scope 数据范围
 */
export function scopeFor(roles: readonly string[]): 'all' | 'assigned' | 'own' {
  if (roles.includes('owner') || roles.includes('admin')) return 'all'
  if (roles.includes('reviewer')) return 'assigned'
  return 'own'
}
