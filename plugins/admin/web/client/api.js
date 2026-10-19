/**
 * Same-origin API client of the admin SPA.
 *
 * One `request` function owns cookies, the JSON envelope and error mapping, so
 * views never touch `fetch` and never guess a status code. Unsafe methods carry
 * the double-submit CSRF header read from the `admin_csrf` cookie; the value the
 * sign-in response returns is kept as a fallback because a cookie write can be
 * delayed or blocked by browser privacy settings.
 *
 * 后台 SPA 的同源 API 客户端。所有 Cookie、JSON 信封与错误映射都集中在一个 `request`
 * 函数里，视图因此不碰 `fetch`、也不猜状态码。非安全方法携带从 `admin_csrf` Cookie 读取的
 * 双提交 CSRF 头；登录响应返回的值作为兜底保留，因为浏览器隐私设置可能延迟或阻止 Cookie
 * 写入。
 *
 * All paths are site-absolute and same-origin: the SPA never talks to a second
 * host, which is what the content security policy promises.
 *
 * 所有路径都是站点绝对、同源的：SPA 从不访问第二个主机，这正是内容安全策略所承诺的。
 *
 * @module @veren/admin-web/client/api.js
 */

/** Admin audience prefix. 管理受众前缀。 */
const ADMIN = '/api/admin/v1'

/** Public audience prefix. 公开受众前缀。 */
const PUBLIC = '/api/public/v1'

/** Methods that never change state and therefore skip CSRF. 从不改变状态、因此跳过 CSRF 的方法。 */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/** CSRF token returned by sign-in, used when the cookie is not readable yet. 登录返回的 CSRF token，Cookie 尚不可读时使用。 */
let csrfFallback = null

/**
 * Read one cookie by name.
 *
 * @param name - cookie name Cookie 名
 * @returns the decoded value, or `null` 解码值或 `null`
 */
export function readCookie(name) {
  for (const part of document.cookie.split(';')) {
    const separator = part.indexOf('=')
    if (separator < 0) continue
    if (part.slice(0, separator).trim() !== name) continue
    try {
      return decodeURIComponent(part.slice(separator + 1).trim())
    } catch {
      return part.slice(separator + 1).trim()
    }
  }
  return null
}

/**
 * Remember the CSRF token a sign-in response returned.
 *
 * @param token - token from the response 响应中的 token
 */
export function setCsrfToken(token) {
  csrfFallback = typeof token === 'string' && token !== '' ? token : null
}

/**
 * Current CSRF token: the cookie first, the sign-in fallback second.
 * 当前 CSRF token：先取 Cookie，再取登录兜底值。
 *
 * @returns the token, or `null` token 或 `null`
 */
function csrfToken() {
  const cookie = readCookie('admin_csrf')
  return cookie === null || cookie === '' ? csrfFallback : cookie
}

/**
 * Serialize a query object, dropping empty values.
 *
 * @param query - query values 查询值
 * @returns `?a=1&b=2`, or an empty string `?a=1&b=2` 或空串
 */
function queryString(query) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === '') continue
    search.set(key, String(value))
  }
  const text = search.toString()
  return text === '' ? '' : `?${text}`
}

/**
 * Turn a failed response into the platform's error shape.
 *
 * @param response - the failed response 失败的响应
 * @param payload - parsed body, when it was JSON 已解析的体（若为 JSON）
 * @returns `{ code, message, details, status }` 错误对象
 */
function failureOf(response, payload) {
  const envelope = payload !== null && typeof payload === 'object' ? payload : {}
  const body = envelope.error !== null && typeof envelope.error === 'object' ? envelope.error : envelope
  return {
    code: typeof body.code === 'string' ? body.code : `HTTP_${response.status}`,
    message: typeof body.message === 'string' && body.message !== '' ? body.message : response.statusText,
    details: body.details,
    status: response.status,
  }
}

/**
 * Perform one same-origin JSON request.
 *
 * @param method - HTTP method HTTP 方法
 * @param path - site-absolute API path 站点绝对 API 路径
 * @param body - JSON body for unsafe methods 非安全方法的 JSON 体
 * @returns the parsed payload 解析后的载荷
 * @throws `{ code, message, details, status }` on a non-2xx response 非 2xx 时抛出
 */
export async function request(method, path, body) {
  const headers = { accept: 'application/json' }
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (!SAFE_METHODS.has(method)) {
    const token = csrfToken()
    if (token !== null) headers['x-csrf-token'] = token
  }
  const response = await fetch(path, {
    method,
    headers,
    credentials: 'same-origin',
    cache: 'no-store',
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  let payload = null
  if (text !== '') {
    try {
      payload = JSON.parse(text)
    } catch {
      payload = null
    }
  }
  if (!response.ok) throw failureOf(response, payload)
  return payload
}

/** First-run status. 首次运行状态。 */
export const getSetup = () => request('GET', `${PUBLIC}/setup`)

/** Create the first administrator. 创建首个管理员。 */
export const setup = (input) => request('POST', `${PUBLIC}/setup`, input)

/** Verify credentials and open a session. 校验凭据并开启会话。 */
export const login = (input) => request('POST', `${PUBLIC}/login`, input)

/** Close the current session. 关闭当前会话。 */
export const logout = () => request('POST', `${ADMIN}/logout`)

/** Identity, permissions, navigation and feature flags. 身份、权限、导航与功能开关。 */
export const bootstrap = () => request('GET', `${ADMIN}/bootstrap`)

/** Every user. 全部用户。 */
export const listUsers = () => request('GET', `${ADMIN}/users`)

/** Create one user. 创建一个用户。 */
export const createUser = (input) => request('POST', `${ADMIN}/users`, input)

/** Update one user. 更新一个用户。 */
export const updateUser = (id, patch) => request('PATCH', `${ADMIN}/users/${encodeURIComponent(id)}`, patch)

/** Delete one user. 删除一个用户。 */
export const deleteUser = (id) => request('DELETE', `${ADMIN}/users/${encodeURIComponent(id)}`)

/** Every role. 全部角色。 */
export const listRoles = () => request('GET', `${ADMIN}/roles`)

/** One page of audit entries. 一页审计记录。 */
export const listAudit = (query) => request('GET', `${ADMIN}/audit${queryString(query)}`)

/** The live capability catalog. 实时能力目录。 */
export const capabilities = () => request('GET', `${ADMIN}/capabilities`)

/** UI packs available before sign-in. 登录前可用的 UI 包。 */
export const publicManifest = () => request('GET', `${PUBLIC}/ui-manifest`)

/** UI packs available after sign-in. 登录后可用的 UI 包。 */
export const adminManifest = () => request('GET', `${ADMIN}/ui-manifest`)
