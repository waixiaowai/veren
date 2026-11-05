/**
 * 共享实体行类型：与数据字典（design/data.md）字段一一对应。
 * 本文件只放类型；运行时行为归属各域模块。
 *
 * Shared entity row types, mirroring the data dictionary (design/data.md)
 * field by field. Types only; runtime behavior belongs to the domain modules.
 *
 * @module @veren/auth-core/types
 */

/** 主体档案（User）。 / The user row. */
export interface UserRow {
  id: string
  name: string
  /** 入库前小写归一，全局唯一。 / Lowercased before storage; globally unique. */
  email: string
  /** 仅经校验流程置位。 / Set only through the verification flow. */
  emailVerified: boolean
  image: string | null
  createdAt: Date
  updatedAt: Date
}

/** 会话记录（Session）。 / The session row. */
export interface SessionRow {
  id: string
  /** 32 位随机值，唯一索引。 / A 32-char random value, unique-indexed. */
  token: string
  userId: string
  expiresAt: Date
  ipAddress: string | null
  userAgent: string | null
  createdAt: Date
  updatedAt: Date
  /** admin 冒充标记；本框架仅保留字段面。 / Admin impersonation marker; kept for the field surface. */
  impersonatedBy?: string
}

/** 账号绑定（Account）。 / The account-binding row. */
export interface AccountRow {
  id: string
  userId: string
  /** 提供方标识，如 "credential"。 / The provider id, e.g. "credential". */
  providerId: string
  /** 外部账号标识；(providerId, accountId) 唯一。 / The external account id; (providerId, accountId) unique. */
  accountId: string
  accessToken?: string | null
  refreshToken?: string | null
  idToken?: string | null
  accessTokenExpiresAt?: Date | null
  refreshTokenExpiresAt?: Date | null
  scope?: string | null
  /** 仅凭证提供方使用；散列值，永不外泄。 / Credential provider only; a hash, never returned. */
  password?: string | null
  createdAt: Date
  updatedAt: Date
}

/** 校验凭据（Verification）。 / The verification row. */
export interface VerificationRow {
  id: string
  /** 唯一索引；一次性凭据的定位键。 / Unique index; the locator of one-time credentials. */
  identifier: string
  /** 载荷（JSON 或令牌）。 / The payload (JSON or a token). */
  value: string
  /** 过期即无效。 / Invalid once expired. */
  expiresAt: Date
  createdAt: Date
  updatedAt: Date
}

/** 限流计数（RateLimit）。 / The rate-limit counter row. */
export interface RateLimitRow {
  id: string
  /** `${ip}|${path}`，唯一索引。 / `${ip}|${path}`, unique-indexed. */
  key: string
  count: number
  /** 窗口起点判定（毫秒时间）。 / The window-start marker (epoch millis). */
  lastRequest: number
}

/** 会话解析产物：会话行 + 主体档案。 / The session resolution result: session row plus user row. */
export interface SessionContext {
  session: SessionRow
  user: UserRow
  /** 会话级凭据（不记住我）标记。 / The session-only cookie (don't-remember-me) marker. */
  dontRemember: boolean
}
