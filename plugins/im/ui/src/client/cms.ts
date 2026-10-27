/**
 * Browser-side client for the CMS user plane (`/v1/im/user/*`).
 *
 * Credentials never touch the Host: the panel exchanges email+password for a
 * Bearer JWT at `POST /v1/auth/jwt` (T22 facility) and keeps it in
 * sessionStorage — the credential tracks stay separated (device key on the
 * device plane inside the Host config; user JWT here only).
 *
 * 浏览器侧 CMS 用户面客户端。
 *
 * 凭据不经宿主：面板以邮箱+密码在 `POST /v1/auth/jwt`（T22 既有设施）换 Bearer JWT，
 * 存 sessionStorage——凭据分轨（设备 Key 留在宿主 config 走设备面；用户 JWT 只在这里）。
 *
 * @module @veren/im-ui/client/cms
 */

/** One person row as the user plane returns it. */
export interface CmsPerson {
  readonly id: string
  readonly owner_id: string
  readonly display_name: string
  readonly claimed_name: string
  readonly identity_status: string
  readonly note: string
  readonly updated_at: number
}

/** One address binding row. */
export interface CmsAddress {
  readonly person_id: string
  readonly provider: string
  readonly external_id: string
  readonly display_name: string
  readonly updated_at: number
}

/** GET /v1/im/user/overview projection. */
export interface CmsOverview {
  readonly session_authorized: boolean
  readonly bot_id: string
  readonly owner_id: string
  readonly messages: number
  readonly people: number
}

/** The signed-in session: origin + token (sessionStorage-backed). */
export interface CmsSession {
  readonly origin: string
  readonly token: string
}

const storageKey = (origin: string) => `im-cms-token:${origin}`

/** Restore a stored token for this origin, if any. */
export function restoreSession(origin: string): CmsSession | undefined {
  try {
    const token = sessionStorage.getItem(storageKey(origin))
    return token === null ? undefined : { origin, token }
  } catch {
    return undefined
  }
}

export function forgetSession(origin: string): void {
  try {
    sessionStorage.removeItem(storageKey(origin))
  } catch {
    // sessionStorage 不可用（隐私模式）即无处可恢复 / nothing to restore without sessionStorage
  }
}

/** Exchange email+password for a Bearer JWT and remember it. */
export async function login(origin: string, email: string, password: string): Promise<CmsSession> {
  const response = await fetch(`${origin.replace(/\/+$/, '')}/v1/auth/jwt`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const body = await response.json() as { code: number; message?: string; data?: { access_token?: string } }
  if (body.code !== 0 || body.data?.access_token === undefined) {
    throw new Error(body.message ?? `登录失败（${body.code}）`)
  }
  const session = { origin: origin.replace(/\/+$/, ''), token: body.data.access_token }
  try {
    sessionStorage.setItem(storageKey(session.origin), session.token)
  } catch {
    // 存不了就只在内存里用到页面关闭 / memory-only when storage is unavailable
  }
  return session
}

/** CMS 平台信封的窄投影。 */
interface Envelope<T> {
  code: number
  message?: string
  data?: T
}

async function call<T>(session: CmsSession, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${session.origin}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${session.token}`, 'content-type': 'application/json', ...init?.headers },
  })
  const body = await response.json() as Envelope<T>
  // 401/1003 = 登录过期：标记在错误对象上，视图据此回流登录卡（常规态非异常）。
  // 401/1003 means an expired sign-in: flagged on the error so the view flows
  // back to the sign-in card as a normal state, not an exception.
  if (response.status === 401 || body.code === 1003) {
    throw Object.assign(new Error(body.message ?? '登录已过期'), { expired: true })
  }
  // 404 = 该 CMS 实例还没有 imhub 用户面（2.3.0 未部署）：与普通失败分开标记，
  // 视图据此给解释性状态（部署指引）而非裸错误。
  // 404 means this CMS instance lacks the imhub user plane (2.3.0 not deployed):
  // flagged distinctly so the view explains the deployment gap instead of a bare error.
  if (response.status === 404 || body.code === 404) {
    throw Object.assign(new Error(body.message ?? '资源不存在'), { notFound: true })
  }
  // 3003 = RBAC 权限不足（RequirePermission 拒绝）：授权漏斗据此区分
  // 「缺管理权限」与普通失败。
  // 3003 = RBAC permission denied: the funnel separates a missing manage
  // permission from an ordinary failure.
  if (response.status === 403 || body.code === 3003) {
    throw Object.assign(new Error(body.message ?? 'permission denied'), { forbidden: true })
  }
  if (body.code !== 0 || body.data === undefined) {
    throw new Error(body.message ?? `CMS ${path} 失败（${body.code}）`)
  }
  return body.data
}

/** 401/expired check: call() flags the expired shape on the error object. 401/过期判定：call() 把过期形态标记在错误对象上。 */
export function isExpired(cause: unknown): boolean {
  return (cause as { expired?: boolean } | undefined)?.expired === true
}

/** 404 check: the target CMS instance has no imhub user plane. 404 判定：目标 CMS 实例没有 imhub 用户面。 */
export function isNotFound(cause: unknown): boolean {
  return (cause as { notFound?: boolean } | undefined)?.notFound === true
}

/** 403 check: the signed-in account lacks imhub:manage. 403 判定：账号缺 imhub:manage。 */
export function isForbidden(cause: unknown): boolean {
  return (cause as { forbidden?: boolean } | undefined)?.forbidden === true
}

/** One authorize-attempt projection (the manage-guarded user-plane delegate). 授权尝试投影（管理面权限经用户面代理）。 */
export interface CmsAuthorizeState {
  readonly active: boolean
  readonly status: string // wait | scaned | need_verifycode | confirmed | expired | verify_code_blocked | failed
  readonly qr_url: string
  readonly session_authorized: boolean
}

/** 发起一次 QR 授权（转管理面权限 imhub:manage）。 */
export function authorizeStart(session: CmsSession): Promise<CmsAuthorizeState> {
  return call<CmsAuthorizeState>(session, '/v1/im/user/authorize', { method: 'POST' })
}

/** 读当前授权尝试状态（含会话态）。 */
export function authorizeStatus(session: CmsSession): Promise<CmsAuthorizeState> {
  return call<CmsAuthorizeState>(session, '/v1/im/hub/authorize/status')
}

/** 提交手机验证码到当前授权尝试。 */
export function authorizeVerify(session: CmsSession, code: string): Promise<void> {
  return call(session, '/v1/im/hub/authorize/verify', {
    method: 'POST',
    body: JSON.stringify({ code }),
  }).then(() => undefined)
}

/** 用户面概览：会话存活 + 消息/人员计数。 */
export function overview(session: CmsSession): Promise<CmsOverview> {
  return call<CmsOverview>(session, '/v1/im/user/overview')
}

/** 人员目录（含地址绑定）；Go 的 nil 切片序列化为 null，统一归一成空数组。 */
export async function people(session: CmsSession): Promise<{ people: CmsPerson[]; addresses: Record<string, CmsAddress[]> }> {
  const data = await call<{ people?: CmsPerson[] | null; addresses?: Record<string, CmsAddress[]> | null }>(
    session, '/v1/im/user/people',
  )
  return { people: data.people ?? [], addresses: data.addresses ?? {} }
}

/** 改名/备注（空串 = 保持原值）。 */
export function patchPerson(session: CmsSession, personId: string, patch: { displayName?: string; note?: string }): Promise<void> {
  return call(session, `/v1/im/user/people/${encodeURIComponent(personId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ display_name: patch.displayName ?? '', note: patch.note ?? '' }),
  }).then(() => undefined)
}
