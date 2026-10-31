/**
 * The `auth` capability: first-run setup, sign-in, sessions, users and API
 * tokens, plus the account views and inputs those calls exchange.
 *
 * It answers "who is this"; authorization is the `access` capability.
 *
 * `auth` 能力：首次初始化、登录、会话、用户与 API token，以及这些调用交换的账号
 * 视图与输入。它回答"这是谁"；授权由 `access` 能力回答。
 *
 * @module @veren/admin-contract/auth
 */

import type { HealthReport } from './index.ts'
import type { AdminIdentity, AuthenticatedPrincipal } from './identity.ts'

/** A user as the admin UI sees it. 管理界面看到的用户。 */
export interface AdminUserView {
  /** User id. 用户 id。 */
  readonly id: string
  /** Sign-in email. 登录邮箱。 */
  readonly email: string
  /** Display name. 显示名。 */
  readonly name: string
  /** Whether the account may sign in. 账号是否可登录。 */
  readonly active: boolean
  /** Bound role ids. 已绑定角色 id。 */
  readonly roles: readonly string[]
  /** Creation instant, ISO-8601 UTC. 创建时刻，ISO-8601 UTC。 */
  readonly createdAt: string
  /** Last successful sign-in instant. 最近成功登录时刻。 */
  readonly lastLoginAt?: string
}

/** A browser session as the admin UI sees it. 管理界面看到的浏览器会话。 */
export interface AdminSessionView {
  /** Session id. 会话 id。 */
  readonly id: string
  /** Owning user id. 所属用户 id。 */
  readonly userId: string
  /** Creation instant. 创建时刻。 */
  readonly createdAt: string
  /** Expiry instant. 过期时刻。 */
  readonly expiresAt: string
}

/** An API token as the admin UI sees it; the secret is never included. 管理界面看到的 API token；绝不包含密钥。 */
export interface AdminTokenView {
  /** Token id. Token id。 */
  readonly id: string
  /** Owning user id. 所属用户 id。 */
  readonly userId: string
  /** Operator-supplied label. 运营方填写的标签。 */
  readonly name: string
  /** Visible, non-secret prefix for identification. 可见的非密钥前缀，用于辨识。 */
  readonly prefix: string
  /** Granted scopes. 授予的 scope。 */
  readonly scopes: readonly string[]
  /** Creation instant. 创建时刻。 */
  readonly createdAt: string
  /** Revocation instant, when revoked. 撤销时刻（如已撤销）。 */
  readonly revokedAt?: string
}

/** First-run administrator input. 首次运行管理员输入。 */
export interface AdminSetupInput {
  /** Sign-in email. 登录邮箱。 */
  readonly email: string
  /** Initial password, at least 8 characters. 初始密码，至少 8 字符。 */
  readonly password: string
  /** Display name. 显示名。 */
  readonly name: string
}

/** Sign-in input. 登录输入。 */
export interface AdminLoginInput {
  /** Sign-in email. 登录邮箱。 */
  readonly email: string
  /** Password. 密码。 */
  readonly password: string
  /** Peer address, recorded for audit. 对端地址，用于审计。 */
  readonly ip?: string
  /** User agent, recorded for audit. 用户代理，用于审计。 */
  readonly userAgent?: string
}

/** Successful sign-in material. 登录成功后的材料。 */
export interface AdminLoginResult {
  /** Resolved principal with permissions. 带权限的已解析主体。 */
  readonly principal: AuthenticatedPrincipal
  /** The created session. 新建的会话。 */
  readonly session: AdminSessionView
  /** Double-submit CSRF token for subsequent unsafe requests. 后续非安全请求使用的双提交 CSRF token。 */
  readonly csrfToken: string
  /** Opaque session token to place in the session cookie. 放入会话 Cookie 的不透明会话令牌。 */
  readonly sessionToken: string
}

/**
 * The `auth` capability: first-run setup, sign-in, sessions, users and API
 * tokens. It answers "who is this"; authorization is the `access` capability.
 *
 * `auth` 能力：首次初始化、登录、会话、用户与 API token。它回答“这是谁”；授权由
 * `access` 能力回答。
 */
export interface AdminAuth {
  /**
   * Whether the deployment still needs its first administrator.
   * @returns true when no user exists yet 尚无用户时为 true
   */
  setupRequired(): Promise<boolean>

  /**
   * Create the first administrator and sign it in.
   * @param input - first administrator input 首个管理员输入
   * @returns sign-in material 登录材料
   */
  setup(input: AdminSetupInput): Promise<AdminLoginResult>

  /**
   * Verify credentials and open a session.
   * @param input - sign-in input 登录输入
   * @returns sign-in material 登录材料
   */
  login(input: AdminLoginInput): Promise<AdminLoginResult>

  /**
   * Close one session.
   * @param sessionId - session id 会话 id
   */
  logout(sessionId: string): Promise<void>

  /**
   * Resolve an identity from a session id or a bearer token.
   * @param credential - the presented credentials 提交的凭据
   * @returns the identity, or `undefined` when invalid 身份；无效时为 `undefined`
   */
  authenticate(credential: {
    /** Browser session id. 浏览器会话 id。 */
    readonly sessionId?: string
    /** API token secret. API token 密钥。 */
    readonly bearer?: string
  }): Promise<AdminIdentity | undefined>

  /**
   * Read the user directory.
   * @returns every user 全部用户
   */
  listUsers(): Promise<readonly AdminUserView[]>

  /**
   * Create one user.
   * @param input - user input 用户输入
   * @returns the created user 创建的用户
   */
  createUser(input: {
    /** Sign-in email. 登录邮箱。 */
    readonly email: string
    /** Initial password. 初始密码。 */
    readonly password: string
    /** Display name. 显示名。 */
    readonly name: string
    /** Initial role ids. 初始角色 id。 */
    readonly roles?: readonly string[]
  }): Promise<AdminUserView>

  /**
   * Update one user.
   * @param id - user id 用户 id
   * @param patch - changed fields 变更字段
   * @returns the updated user 更新后的用户
   */
  updateUser(
    id: string,
    patch: {
      /** Display name. 显示名。 */
      readonly name?: string
      /** Whether the account may sign in. 账号是否可登录。 */
      readonly active?: boolean
      /** Replacement password. 新密码。 */
      readonly password?: string
    },
  ): Promise<AdminUserView>

  /**
   * Delete one user.
   * @param id - user id 用户 id
   */
  deleteUser(id: string): Promise<void>

  /**
   * List a user's API tokens.
   * @param userId - owning user id 所属用户 id
   * @returns token views without secrets 不含密钥的 token 视图
   */
  listTokens(userId: string): Promise<readonly AdminTokenView[]>

  /**
   * Mint one API token. The plaintext secret is returned once and never stored.
   * @param input - token input Token 输入
   * @returns the plaintext secret and its view 明文密钥及其视图
   */
  createToken(input: {
    /** Owning user id. 所属用户 id。 */
    readonly userId: string
    /** Operator-supplied label. 运营方标签。 */
    readonly name: string
    /** Granted scopes. 授予的 scope。 */
    readonly scopes: readonly string[]
  }): Promise<{ readonly token: string; readonly view: AdminTokenView }>

  /**
   * Revoke one API token.
   * @param tokenId - token id Token id
   */
  revokeToken(tokenId: string): Promise<void>

  /**
   * Probe the provider.
   * @returns the health verdict 健康结论
   */
  health?(): Promise<HealthReport>
}
