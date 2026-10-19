/**
 * Capability interfaces: identity, authentication, authorization, navigation,
 * audit, settings and documentation.
 *
 * These are the only capability surfaces consumers may depend on. Providers
 * implement them; the kernel exposes them behind stable façades so replacing an
 * implementation never changes a consumer.
 *
 * 能力接口：身份、认证、授权、导航、审计、设置与文档。消费方只可依赖这些能力面。
 * provider 实现它们，内核以稳定 façade 暴露，因此替换实现不会改变消费方。
 *
 * @module @veren/admin-contract/capabilities
 */

import type { CapabilityCatalog, HealthReport } from './index.ts'

/**
 * Data scope attached to an identity. `all` reads everything, `assigned` reads
 * rows assigned to the actor, `own` reads only rows the actor created.
 *
 * 身份携带的数据范围。`all` 读取全部，`assigned` 读取指派给该主体的行，`own` 只读取
 * 该主体创建的行。
 */
export interface AdminIdentity {
  /** Stable user id. 稳定用户 id。 */
  readonly userId: string
  /** Sign-in email. 登录邮箱。 */
  readonly email: string
  /** Display name. 显示名。 */
  readonly name: string
  /** Role ids bound to the user. 绑定到该用户的角色 id。 */
  readonly roles: readonly string[]
  /** Data scope for reads and writes. 读写的数据范围。 */
  readonly scope: 'all' | 'assigned' | 'own'
  /** Session id when the request authenticated with a browser session. 浏览器会话认证时的 session id。 */
  readonly sessionId?: string
  /** Token id when the request authenticated with an API token. API token 认证时的 token id。 */
  readonly tokenId?: string
  /** Scopes granted by the presented token; unused for session authentication. 所提交 token 授予的 scope；会话认证不使用。 */
  readonly scopes?: readonly string[]
}

/**
 * An identity enriched with resolved permissions. The gateway attaches this to
 * every authenticated request; handlers never resolve permissions themselves.
 *
 * 携带已解析权限的身份。网关把它附加到每个已认证请求；handler 不再自行解析权限。
 */
export interface AuthenticatedPrincipal extends AdminIdentity {
  /** Flat permission strings such as `admin.users.manage`. 形如 `admin.users.manage` 的扁平权限串。 */
  readonly permissions: readonly string[]
}

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

/** A role as the admin UI sees it. 管理界面看到的角色。 */
export interface AdminRoleView {
  /** Role id. 角色 id。 */
  readonly id: string
  /** Display label. 显示名。 */
  readonly label: string
  /** Granted permission strings. 授予的权限串。 */
  readonly permissions: readonly string[]
  /** Whether the role ships with the platform and cannot be deleted. 是否为平台内置、不可删除的角色。 */
  readonly builtIn: boolean
}

/**
 * The `access` capability: roles, permission resolution and role bindings.
 * Authorization is enforced server-side by the gateway, never by hiding UI.
 *
 * `access` 能力：角色、权限解析与角色绑定。授权由网关在服务端执行，绝不靠隐藏 UI。
 */
export interface AdminAccess {
  /**
   * The platform-wide permission catalog.
   * @returns every known permission string 全部已知权限串
   */
  permissions(): readonly string[]

  /**
   * Read the role directory.
   * @returns every role 全部角色
   */
  roles(): Promise<readonly AdminRoleView[]>

  /**
   * Resolve the permissions of one identity.
   * @param identity - the authenticated identity 已认证身份
   * @returns the effective permission strings 生效权限串
   */
  permissionsOf(identity: AdminIdentity): Promise<readonly string[]>

  /**
   * Resolve the role ids bound to one user.
   * @param userId - target user 目标用户
   * @returns the bound role ids 已绑定角色 id
   */
  rolesOf(userId: string): Promise<readonly string[]>

  /**
   * Bind one role to one user.
   * @param userId - target user 目标用户
   * @param roleId - role to bind 要绑定的角色
   */
  assignRole(userId: string, roleId: string): Promise<void>

  /**
   * Remove one role binding.
   * @param userId - target user 目标用户
   * @param roleId - role to remove 要移除的角色
   */
  revokeRole(userId: string, roleId: string): Promise<void>

  /**
   * Whether a principal holds one permission.
   * @param principal - the authenticated principal 已认证主体
   * @param permission - permission string 权限串
   * @returns true when permitted 有权限时为 true
   */
  can(principal: AuthenticatedPrincipal, permission: string): boolean

  /**
   * Probe the provider.
   * @returns the health verdict 健康结论
   */
  health?(): Promise<HealthReport>
}

/** One menu entry contributed by a module. 模块贡献的单条菜单项。 */
export interface AdminNavContribution {
  /** Unique contribution id. 唯一贡献 id。 */
  readonly id: string
  /** Locale key of the label. 标签的 i18n key。 */
  readonly labelKey: string
  /** SPA path. SPA 路径。 */
  readonly path: string
  /** Icon name resolved by the icon pack. 图标包解析的图标名。 */
  readonly icon?: string
  /** Permission required to see it. 可见所需权限。 */
  readonly permission?: string
  /** Grouping key; entries in one group render together. 分组键；同组条目一起渲染。 */
  readonly group?: string
  /** Sort order inside the group. 组内排序值。 */
  readonly order?: number
}

/** One rendered navigation node. 渲染出的导航节点。 */
export interface AdminNavNode {
  /** Source contribution id. 来源贡献 id。 */
  readonly id: string
  /** Locale key of the label. 标签的 i18n key。 */
  readonly labelKey: string
  /** SPA path. SPA 路径。 */
  readonly path: string
  /** Icon name. 图标名。 */
  readonly icon?: string
  /** Permission that admitted this node. 允许该节点的权限。 */
  readonly permission?: string
  /** Badge count, when the owning module has one. 所属模块有计数时的角标数字。 */
  readonly badge?: number
}

/** The `navigation` capability. `navigation` 能力。 */
export interface AdminNavigation {
  /**
   * Contribute one menu entry.
   * @param item - the contribution 贡献项
   * @returns the disposer removing it 移除它的 disposer
   */
  register(item: AdminNavContribution): () => void

  /**
   * Resolve the visible menu for one principal.
   * @param principal - the authenticated principal 已认证主体
   * @returns admitted nodes in render order 按渲染顺序的可见节点
   */
  tree(principal: AuthenticatedPrincipal): Promise<readonly AdminNavNode[]>

  /**
   * Probe the provider.
   * @returns the health verdict 健康结论
   */
  health?(): Promise<HealthReport>
}

/** Outcome recorded for one audited action. 单次审计动作记录的结果。 */
export type AdminAuditResult = 'intent' | 'success' | 'failure' | 'denied'

/** One append-only audit entry. 单条只追加审计记录。 */
export interface AdminAuditEntry {
  /** Entry id. 记录 id。 */
  readonly id: string
  /** Instant, ISO-8601 UTC. 时刻，ISO-8601 UTC。 */
  readonly at: string
  /** Acting user id, or `null` for anonymous attempts. 操作者用户 id；匿名尝试为 `null`。 */
  readonly actorId: string | null
  /** Acting user label captured at write time. 写入时记录的操作者标签。 */
  readonly actorLabel: string
  /** Action name such as `auth.login`. 形如 `auth.login` 的动作名。 */
  readonly action: string
  /** Outcome. 结果。 */
  readonly result: AdminAuditResult
  /** Affected resource reference. 受影响资源引用。 */
  readonly target?: string
  /** Structured context. 结构化上下文。 */
  readonly detail?: Readonly<Record<string, unknown>>
  /** Request correlation id. 请求关联 id。 */
  readonly requestId?: string
  /** Peer address. 对端地址。 */
  readonly ip?: string
}

/** Audit query filter. 审计查询过滤。 */
export interface AdminAuditQuery {
  /** Page size. 分页大小。 */
  readonly limit?: number
  /** Opaque cursor from the previous page. 上一页的不透明游标。 */
  readonly cursor?: string
  /** Filter by actor. 按操作者过滤。 */
  readonly actorId?: string
  /** Filter by action prefix. 按动作前缀过滤。 */
  readonly action?: string
  /** Filter by outcome. 按结果过滤。 */
  readonly result?: AdminAuditResult
  /** Lower time bound, inclusive. 时间下界（含）。 */
  readonly since?: string
  /** Upper time bound, inclusive. 时间上界（含）。 */
  readonly until?: string
}

/** The `audit` capability: append-only governance trail. `audit` 能力：只追加治理轨迹。 */
export interface AdminAudit {
  /**
   * Append one entry. Retention trimming must never drop a newer entry first.
   * @param entry - entry without id and timestamp 不含 id 与时间戳的记录
   */
  record(entry: Omit<AdminAuditEntry, 'id' | 'at'>): Promise<void>

  /**
   * Query entries, newest first.
   * @param query - filter and paging 过滤与分页
   * @returns one page of entries 一页记录
   */
  list(query: AdminAuditQuery): Promise<{
    /** Page items. 本页条目。 */
    readonly items: readonly AdminAuditEntry[]
    /** Cursor for the next page. 下一页游标。 */
    readonly nextCursor?: string
  }>

  /**
   * Probe the provider.
   * @returns the health verdict 健康结论
   */
  health?(): Promise<HealthReport>
}

/** The `settings` capability: module configuration with optimistic concurrency. `settings` 能力：带乐观并发的模块配置。 */
export interface AdminSettings {
  /**
   * Read one module's settings.
   * @param module - module id 模块 id
   * @returns the stored values and revision 已存值与版本号
   */
  read(module: string): Promise<{
    /** Stored values. 已存值。 */
    readonly values: Readonly<Record<string, unknown>>
    /** Monotonic revision. 单调版本号。 */
    readonly revision: number
  }>

  /**
   * Replace one module's settings.
   * @param module - module id 模块 id
   * @param values - the complete new values 完整新值
   * @param expectedRevision - required revision for optimistic concurrency 乐观并发要求的版本号
   * @returns the new revision 新版本号
   */
  write(
    module: string,
    values: Readonly<Record<string, unknown>>,
    expectedRevision?: number,
  ): Promise<{ readonly revision: number }>

  /**
   * Probe the provider.
   * @returns the health verdict 健康结论
   */
  health?(): Promise<HealthReport>
}

/** The `docs` capability: generated API and capability documentation. `docs` 能力：生成的 API 与能力文档。 */
export interface AdminDocs {
  /**
   * The live capability catalog.
   * @returns the catalog served to clients 提供给客户端的能力目录
   */
  catalog(): Promise<CapabilityCatalog>

  /**
   * The generated OpenAPI document.
   * @returns an OpenAPI 3.1 document OpenAPI 3.1 文档
   */
  openapi(): Promise<Record<string, unknown>>

  /**
   * Probe the provider.
   * @returns the health verdict 健康结论
   */
  health?(): Promise<HealthReport>
}
