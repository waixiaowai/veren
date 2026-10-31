/**
 * Identity facts of the admin platform.
 *
 * An identity is "who is calling"; a principal is that identity enriched with
 * the resolved permission strings. Everything downstream (routes, audit rows,
 * data scoping) reads only these shapes.
 *
 * 后台平台的身份事实。身份回答"调用者是谁"；主体是附上已解析权限串的身份。
 * 下游一切（路由、审计行、数据范围）只读这两个形状。
 *
 * @module @veren/admin-contract/identity
 */

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
