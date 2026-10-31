/**
 * Local-account implementation of the `auth` capability.
 *
 * Credentials, sessions and API tokens live in the provider's own collections;
 * role bindings live in `access`. Sign-in compares a scrypt hash, sessions
 * expire absolutely and on idleness, and token secrets are only ever stored
 * hashed. Configuration, rate limiting, session lifecycle and credential
 * resolution each live in their own module; this class composes them.
 *
 * `auth` 能力的本地账号实现。凭据、会话与 API token 存放在 provider 自己的集合中；
 * 角色绑定存放在 `access`。登录比对 scrypt 散列，会话按绝对时间与空闲时间过期，
 * token 密钥只以散列存储。配置、限流、会话生命周期与凭据解析各归各模块，本类负责组装。
 *
 * @module @veren/admin-auth-local/local-auth
 */

import type { Context } from '@deepseek-ai/cordis'
import {
  AdminError,
  type AdminAuth,
  type AdminIdentity,
  type AdminLoginInput,
  type AdminLoginResult,
  type AdminSetupInput,
  type AdminTokenView,
  type AdminUserView,
  type AuthenticatedPrincipal,
  type HealthReport,
} from '@veren/admin-contract'
import type { ResolvedAuthConfig } from './config.ts'
import { authenticateSession, authenticateToken } from './authenticate.ts'
import { hashToken, randomToken, verifyPassword } from './passwords.ts'
import { LoginRateLimiter } from './login-limit.ts'
import { issueSession, revokeSessionsExcept, sessionView } from './sessions.ts'
import { scopeFor, type UserRecord } from './store.ts'
import {
  createToken,
  createUser,
  deleteUser,
  findUserByEmail,
  listTokens,
  listUsers,
  revokeToken,
  sessionTable,
  updateUser,
  userTable,
} from './users.ts'

/** The local auth provider. 本地认证 provider。 */
export class LocalAuth implements AdminAuth {
  /** Owning context. 所属上下文。 */
  private readonly ctx: Context

  /** Resolved configuration. 解析后的配置。 */
  private readonly config: ResolvedAuthConfig

  /** Fixed-window limiter over sign-in attempts. 登录尝试的固定窗口限流器。 */
  private readonly limiter: LoginRateLimiter

  /**
   * @param ctx - owning context 所属上下文
   * @param config - resolved config 解析后的配置
   */
  constructor(ctx: Context, config: ResolvedAuthConfig) {
    this.ctx = ctx
    this.config = config
    this.limiter = new LoginRateLimiter(config)
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
    this.limiter.assertAllowed(input.email, input.ip)
    const user = findUserByEmail(this.ctx, input.email)
    const valid = user !== undefined && user.active && (await verifyPassword(input.password, user.passwordHash))
    if (user === undefined || !valid) {
      throw new AdminError('AUTH_REQUIRED', 'email or password is incorrect')
    }
    const issued = await issueSession(this.ctx, this.config, user)
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
    const resolve = (user: UserRecord): Promise<AdminIdentity> => this.identityOf(user)
    if (credential.sessionId !== undefined) return authenticateSession(this.ctx, this.config, credential.sessionId, resolve)
    if (credential.bearer !== undefined) return authenticateToken(this.ctx, credential.bearer, resolve)
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
    await this.assertPasswordChange(id, patch.password)
    await updateUser(this.ctx, { minLength: this.config.passwordMinLength }, id, patch)
    return (await listUsers(this.ctx)).find((view) => view.id === id) as AdminUserView
  }

  /**
   * Refuse a password reset that would store the same password again.
   *
   * The rule lives here rather than in the user table helpers because it needs
   * the stored hash: a reset that changes nothing is almost always a form
   * mistake, and telling the operator beats a silent no-op. The policy itself
   * (minimum length) stays in one place, shared with user creation.
   *
   * 拒绝把密码重置成同一个值。
   *
   * 规则放在这里而不是用户表辅助函数里，因为它需要已存哈希：什么都没改的重置几乎总是
   * 表单笔误，明确告知操作者优于静默无操作。口令策略（最小长度）仍只有一份，与创建
   * 用户共用。
   *
   * @param id - target user 目标用户
   * @param password - requested password, when supplied 请求的新口令（若提供）
   * @throws AdminError `NOT_FOUND` for an unknown user, `VALIDATION_FAILED` with
   *   `details.reason === 'UNCHANGED'` when the password already matches
   */
  private async assertPasswordChange(id: string, password: string | undefined): Promise<void> {
    if (password === undefined) return
    const current = userTable(this.ctx).find(id)
    if (current === undefined) {
      throw new AdminError('NOT_FOUND', `user '${id}' does not exist`, { userId: id })
    }
    if (await verifyPassword(password, current.passwordHash)) {
      throw new AdminError('VALIDATION_FAILED', 'the new password must differ from the current password', {
        field: 'password',
        reason: 'UNCHANGED',
      })
    }
  }

  /**
   * Change the signed-in user's own password after proving the current one.
   *
   * The session that made the request survives (an operator who just proved the
   * old password should not be thrown out), while every other session of that
   * user is revoked: a password change is exactly the moment a stolen cookie
   * must stop working. Minimum length and the `UNCHANGED` rule are the same
   * ones the admin reset uses.
   *
   * 在证明当前口令后修改当前登录用户自己的密码。
   *
   * 发起请求的会话保留（刚证明过旧口令的操作者不该被踢出），该用户的其它会话全部吊销：
   * 改密正是被盗 Cookie 必须失效的时刻。最小长度与 `UNCHANGED` 规则与管理员重置一致。
   *
   * @param userId - the signed-in user 当前登录用户
   * @param input - current password, new password and the session to keep 旧口令、新口令与要保留的会话
   * @returns how many other sessions were revoked 被吊销的其它会话数
   * @throws AdminError `NOT_FOUND` for an unknown user, `VALIDATION_FAILED` with
   *   `details.reason` of `WRONG_PASSWORD`, `TOO_SHORT` or `UNCHANGED`
   */
  async changePassword(
    userId: string,
    input: { readonly currentPassword: string; readonly newPassword: string; readonly keepSessionId?: string },
  ): Promise<{ readonly revokedSessions: number }> {
    const user = userTable(this.ctx).find(userId)
    if (user === undefined) {
      throw new AdminError('NOT_FOUND', `user '${userId}' does not exist`, { userId })
    }
    if (!(await verifyPassword(input.currentPassword, user.passwordHash))) {
      throw new AdminError('VALIDATION_FAILED', 'the current password is incorrect', {
        field: 'currentPassword',
        reason: 'WRONG_PASSWORD',
      })
    }
    if (input.newPassword.length < this.config.passwordMinLength) {
      throw new AdminError(
        'VALIDATION_FAILED',
        `the new password must be at least ${this.config.passwordMinLength} characters`,
        { field: 'newPassword', minLength: this.config.passwordMinLength, reason: 'TOO_SHORT' },
      )
    }
    await this.assertPasswordChange(userId, input.newPassword)
    await updateUser(this.ctx, { minLength: this.config.passwordMinLength }, userId, { password: input.newPassword })
    return { revokedSessions: await revokeSessionsExcept(this.ctx, userId, input.keepSessionId) }
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
}
