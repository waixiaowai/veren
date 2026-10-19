/**
 * Local-account implementation of the `auth` capability.
 *
 * Credentials, sessions and API tokens live in the provider's own collections;
 * role bindings live in `access`. Sign-in compares a scrypt hash in constant
 * time, sessions expire absolutely and on idleness, and token secrets are only
 * ever stored hashed.
 *
 * `auth` 能力的本地账号实现。凭据、会话与 API token 存放在 provider 自己的集合中；
 * 角色绑定存放在 `access`。登录以常量时间比对 scrypt 散列，会话按绝对时间与空闲时间
 * 过期，token 密钥只以散列形式存储。
 *
 * @module @veren/admin-auth-local/provider
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import {
  AdminError,
  type AdminAuth,
  type AdminIdentity,
  type AdminLoginInput,
  type AdminLoginResult,
  type AdminSessionView,
  type AdminSetupInput,
  type AdminTokenView,
  type AdminUserView,
  type AuthenticatedPrincipal,
  type HealthReport,
} from '@veren/admin-contract'
import { hashToken, randomToken, verifyPassword } from './passwords.ts'
import { normalizeEmail, scopeFor, type SessionRecord, type UserRecord } from './store.ts'
import {
  createToken,
  createUser,
  deleteUser,
  findUserByEmail,
  listTokens,
  listUsers,
  revokeToken,
  sessionTable,
  tokenTable,
  updateUser,
  userTable,
} from './users.ts'

/** Raw plugin configuration. 原始插件配置。 */
export interface AuthConfig {
  /** Browser session lifetime in days. 浏览器会话时长（天）。 */
  sessionDays?: number
  /** Idle expiry in hours. 空闲过期（小时）。 */
  idleHours?: number
  /** Mark cookies `Secure`; enable behind TLS. TLS 后启用时给 Cookie 加 `Secure`。 */
  secureCookies?: boolean
  /** Minimum password length. 最小口令长度。 */
  passwordMinLength?: number
  /** Sign-in attempt budget. 登录尝试预算。 */
  loginRateLimit?: { window?: number; max?: number }
}

/** Configuration with every default applied. 已应用全部默认值的配置。 */
export interface ResolvedAuthConfig {
  /** Session lifetime in days. 会话时长（天）。 */
  readonly sessionDays: number
  /** Idle expiry in hours. 空闲过期（小时）。 */
  readonly idleHours: number
  /** Whether cookies carry `Secure`. Cookie 是否携带 `Secure`。 */
  readonly secureCookies: boolean
  /** Minimum password length. 最小口令长度。 */
  readonly passwordMinLength: number
  /** Sign-in attempt budget. 登录尝试预算。 */
  readonly loginRateLimit: { readonly window: number; readonly max: number }
}

/**
 * Apply defaults to a validated auth config.
 *
 * @param config - raw config 原始配置
 * @returns the resolved config 解析后的配置
 */
export function resolveAuthConfig(config: AuthConfig): ResolvedAuthConfig {
  return {
    sessionDays: config.sessionDays ?? 7,
    idleHours: config.idleHours ?? 12,
    secureCookies: config.secureCookies ?? false,
    passwordMinLength: config.passwordMinLength ?? 8,
    loginRateLimit: { window: config.loginRateLimit?.window ?? 60, max: config.loginRateLimit?.max ?? 10 },
  }
}

/** Fixed-window counters for sign-in attempts. 登录尝试的固定窗口计数。 */
interface AttemptBucket {
  /** Window start, epoch milliseconds. 窗口起点（毫秒）。 */
  start: number
  /** Attempts in the window. 窗口内尝试次数。 */
  count: number
}

/** The local auth provider. 本地认证 provider。 */
export class LocalAuth implements AdminAuth {
  /** Owning context. 所属上下文。 */
  private readonly ctx: Context

  /** Resolved configuration. 解析后的配置。 */
  private readonly config: ResolvedAuthConfig

  /** Sign-in attempt counters keyed by email and peer address. 按邮箱与对端地址索引的登录计数。 */
  private readonly attempts = new Map<string, AttemptBucket>()

  /**
   * @param ctx - owning context 所属上下文
   * @param config - resolved config 解析后的配置
   */
  constructor(ctx: Context, config: ResolvedAuthConfig) {
    this.ctx = ctx
    this.config = config
  }

  /** @returns whether the deployment still needs its first administrator 部署是否仍需要首个管理员 */
  async setupRequired(): Promise<boolean> {
    return userTable(this.ctx).size === 0
  }

  /**
   * Create the first administrator and sign it in.
   *
   * @param input - first administrator input 首个管理员输入
   * @returns sign-in material 登录材料
   */
  async setup(input: AdminSetupInput): Promise<AdminLoginResult> {
    if (!(await this.setupRequired())) {
      throw new AdminError('ALREADY_INITIALIZED', 'the deployment already has an administrator')
    }
    await createUser(this.ctx, { minLength: this.config.passwordMinLength }, { ...input, roles: ['owner'] })
    return this.login({ email: input.email, password: input.password })
  }

  /**
   * Verify credentials and open a session.
   *
   * @param input - sign-in input 登录输入
   * @returns sign-in material 登录材料
   */
  async login(input: AdminLoginInput): Promise<AdminLoginResult> {
    this.assertLoginAllowed(input.email, input.ip)
    const user = findUserByEmail(this.ctx, input.email)
    const valid = user !== undefined && user.active && (await verifyPassword(input.password, user.passwordHash))
    if (user === undefined || !valid) {
      throw new AdminError('AUTH_REQUIRED', 'email or password is incorrect')
    }
    const issued = await this.issueSession(user)
    await userTable(this.ctx).save({ ...user, lastLoginAt: new Date().toISOString() })
    return {
      principal: await this.principalOf(await this.identityOf(user)),
      session: sessionView(issued.record),
      csrfToken: randomToken(18),
      sessionToken: issued.token,
    }
  }

  /**
   * Close one session by its cookie token.
   *
   * @param sessionToken - the cookie token Cookie 令牌
   */
  async logout(sessionToken: string): Promise<void> {
    const hash = hashToken(sessionToken)
    const session = sessionTable(this.ctx).list().find((entry) => entry.tokenHash === hash)
    if (session !== undefined) await sessionTable(this.ctx).remove(session.id)
  }

  /**
   * Resolve an identity from a session token or an API token.
   *
   * @param credential - presented credentials 提交的凭据
   * @returns the identity, or `undefined` when invalid 身份；无效时为 `undefined`
   */
  async authenticate(credential: {
    readonly sessionId?: string
    readonly bearer?: string
  }): Promise<AdminIdentity | undefined> {
    if (credential.sessionId !== undefined) return this.authenticateSession(credential.sessionId)
    if (credential.bearer !== undefined) return this.authenticateToken(credential.bearer)
    return undefined
  }

  /** @returns every user with its bound roles 每个用户及其绑定角色 */
  async listUsers(): Promise<readonly AdminUserView[]> {
    return listUsers(this.ctx)
  }

  /** @param input - user input 用户输入 @returns the created user 创建的用户 */
  async createUser(input: {
    readonly email: string
    readonly password: string
    readonly name: string
    readonly roles?: readonly string[]
  }): Promise<AdminUserView> {
    const user = await createUser(this.ctx, { minLength: this.config.passwordMinLength }, input)
    return (await listUsers(this.ctx)).find((view) => view.id === user.id) as AdminUserView
  }

  /** @param id - user id 用户 id @param patch - changed fields 变更字段 @returns the updated user 更新后的用户 */
  async updateUser(
    id: string,
    patch: { readonly name?: string; readonly active?: boolean; readonly password?: string },
  ): Promise<AdminUserView> {
    await updateUser(this.ctx, { minLength: this.config.passwordMinLength }, id, patch)
    return (await listUsers(this.ctx)).find((view) => view.id === id) as AdminUserView
  }

  /** @param id - user id 用户 id */
  async deleteUser(id: string): Promise<void> {
    await deleteUser(this.ctx, id)
  }

  /** @param userId - owning user id 所属用户 id @returns token views token 视图 */
  async listTokens(userId: string): Promise<readonly AdminTokenView[]> {
    return listTokens(this.ctx, userId)
  }

  /** @param input - token input Token 输入 @returns the plaintext secret and its view 明文密钥与视图 */
  async createToken(input: {
    readonly userId: string
    readonly name: string
    readonly scopes: readonly string[]
  }): Promise<{ readonly token: string; readonly view: AdminTokenView }> {
    return createToken(this.ctx, input)
  }

  /** @param tokenId - token id Token id */
  async revokeToken(tokenId: string): Promise<void> {
    await revokeToken(this.ctx, tokenId)
  }

  /** @returns the provider health verdict provider 健康结论 */
  async health(): Promise<HealthReport> {
    try {
      userTable(this.ctx).size
      return { status: 'ok' }
    } catch (error) {
      return { status: 'down', detail: error instanceof Error ? error.message : String(error) }
    }
  }

  /**
   * Resolve a browser session token, enforcing absolute and idle expiry.
   *
   * @param token - the cookie token Cookie 令牌
   * @returns the identity, or `undefined` when unusable 身份；不可用时为 `undefined`
   */
  private async authenticateSession(token: string): Promise<AdminIdentity | undefined> {
    const hash = hashToken(token)
    const sessions = sessionTable(this.ctx)
    const session = sessions.list().find((entry) => entry.tokenHash === hash)
    if (session === undefined) return undefined
    const now = Date.now()
    const idleMs = now - new Date(session.lastSeenAt).getTime()
    if (new Date(session.expiresAt).getTime() <= now || idleMs > this.config.idleHours * 3_600_000) {
      await sessions.remove(session.id)
      return undefined
    }
    // Refreshing at most once a minute keeps a busy session one write per minute
    // instead of one write per request.
    // 最多每分钟刷新一次，使繁忙会话每分钟一次写入而非每请求一次。
    if (idleMs > 60_000) await sessions.save({ ...session, lastSeenAt: new Date(now).toISOString() })
    const user = userTable(this.ctx).find(session.userId)
    if (user === undefined || !user.active) return undefined
    return { ...(await this.identityOf(user)), sessionId: session.id }
  }

  /**
   * Resolve an API token, rejecting revoked tokens.
   *
   * @param secret - the presented bearer secret 提交的 bearer 密钥
   * @returns the identity, or `undefined` when unusable 身份；不可用时为 `undefined`
   */
  private async authenticateToken(secret: string): Promise<AdminIdentity | undefined> {
    const hash = hashToken(secret)
    const tokens = tokenTable(this.ctx)
    const token = tokens.list().find((entry) => entry.secretHash === hash)
    if (token === undefined || token.revokedAt !== undefined) return undefined
    const user = userTable(this.ctx).find(token.userId)
    if (user === undefined || !user.active) return undefined
    const lastUsed = new Date(token.lastUsedAt ?? token.createdAt).getTime()
    if (Date.now() - lastUsed > 60_000) await tokens.save({ ...token, lastUsedAt: new Date().toISOString() })
    return { ...(await this.identityOf(user)), tokenId: token.id, scopes: token.scopes }
  }

  /**
   * Build the identity facts of one user.
   *
   * @param user - stored user 存储的用户
   * @returns the identity without permissions 不含权限的身份
   */
  private async identityOf(user: UserRecord): Promise<AdminIdentity> {
    const roles = await this.ctx.adminAccess.rolesOf(user.id)
    return { userId: user.id, email: user.email, name: user.name, roles, scope: scopeFor(roles) }
  }

  /**
   * Attach resolved permissions to an identity.
   *
   * @param identity - the identity 身份
   * @returns the principal 主体
   */
  private async principalOf(identity: AdminIdentity): Promise<AuthenticatedPrincipal> {
    return { ...identity, permissions: await this.ctx.adminAccess.permissionsOf(identity) }
  }

  /**
   * Open one session record and return its cookie token.
   *
   * @param user - the signed-in user 已登录用户
   * @returns the plaintext token and the stored record 明文令牌与存储记录
   */
  private async issueSession(user: UserRecord): Promise<{ token: string; record: SessionRecord }> {
    const now = new Date()
    const token = randomToken()
    const record: SessionRecord = {
      id: randomUUID(),
      userId: user.id,
      tokenHash: hashToken(token),
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.config.sessionDays * 86_400_000).toISOString(),
      lastSeenAt: now.toISOString(),
    }
    await sessionTable(this.ctx).save(record)
    return { token, record }
  }

  /**
   * Consume one sign-in attempt, refusing when the budget is spent.
   *
   * @param email - attempted email 尝试的邮箱
   * @param ip - peer address 对端地址
   */
  private assertLoginAllowed(email: string, ip: string | undefined): void {
    const key = `${normalizeEmail(email)}|${ip ?? 'unknown'}`
    const now = Date.now()
    const windowMs = this.config.loginRateLimit.window * 1000
    const bucket = this.attempts.get(key)
    if (bucket === undefined || now - bucket.start >= windowMs) {
      this.attempts.set(key, { start: now, count: 1 })
      return
    }
    bucket.count += 1
    if (bucket.count > this.config.loginRateLimit.max) {
      throw new AdminError('RATE_LIMITED', 'too many sign-in attempts', { window: this.config.loginRateLimit.window })
    }
  }
}

/**
 * Project a stored session into its public view.
 *
 * @param record - stored session 存储的会话
 * @returns the view 视图
 */
function sessionView(record: SessionRecord): AdminSessionView {
  return { id: record.id, userId: record.userId, createdAt: record.createdAt, expiresAt: record.expiresAt }
}
