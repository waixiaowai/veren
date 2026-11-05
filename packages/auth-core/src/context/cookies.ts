/**
 * Cookie 契约（设计文档 modules/03-session.md §3.2）。
 * 会话凭据命名与前缀、属性（httpOnly/sameSite/secure/maxAge）与
 * Set-Cookie 序列化在此统一；签发/清除是会话域的职责。
 *
 * The cookie contract (design modules/03-session.md §3.2). Session
 * credential names, prefixes, attributes (httpOnly/sameSite/secure/maxAge)
 * and Set-Cookie serialization unify here; issuing and clearing belong to
 * the session domain.
 *
 * @module @veren/auth-core/context/cookies
 */

/** 单枚 Cookie 的属性。 / One cookie's attributes. */
export interface CookieAttributes {
  /** 逻辑名（与前缀无关）。 / The logical name (prefix-free). */
  name: string
  httpOnly: boolean
  sameSite: 'strict' | 'lax' | 'none'
  secure: boolean
  path: string
  /** 未设置 = 会话级 Cookie。 / Unset = a session-scoped cookie. */
  maxAge?: number
}

/** Cookie 面：名称与属性生成器。 / The cookie face: names and the attribute builder. */
export interface AuthCookies {
  /** 前缀。 / The prefix. */
  prefix: string
  /** 会话凭据 Cookie 名。 / The session-credential cookie name. */
  sessionToken: string
  /** 不记住我标记 Cookie 名。 / The don't-remember marker cookie name. */
  dontRemember: string
  /** 跨站导航状态 Cookie 名。 / The cross-site state cookie name. */
  csrfState: string
  /** 构造属性。 / Build attributes. */
  attributes: (name: string, override?: Partial<CookieAttributes>) => CookieAttributes
}

/** 是否为安全的 base URL（https）。 / Whether the base URL is secure (https). */
function secureFromBaseURL(baseURL: string): boolean {
  try {
    return new URL(baseURL).protocol === 'https:'
  } catch {
    return false
  }
}

/** 装配 Cookie 面：前缀 + Secure（显式开关优先，否则跟随 baseURL 协议）。 / Assemble the cookie face: prefix + Secure (explicit switch wins, else baseURL protocol). */
export function createAuthCookies(options: {
  baseURL: string
  prefix?: string
  sameSite?: 'strict' | 'lax' | 'none'
  useSecureCookies?: boolean
}): AuthCookies {
  const prefix = options.prefix ?? 'auth'
  const secure = options.useSecureCookies ?? secureFromBaseURL(options.baseURL)
  const sameSite = options.sameSite ?? 'lax'
  return {
    prefix,
    sessionToken: `${prefix}.session_token`,
    dontRemember: `${prefix}.dont_remember`,
    csrfState: `${prefix}.csrf_state`,
    attributes: (name, override) => ({
      name,
      httpOnly: true,
      sameSite,
      secure,
      path: '/',
      ...override,
    }),
  }
}

/** 序列化一条 Set-Cookie。 / Serialize one Set-Cookie value. */
export function serializeCookie(value: string, attributes: CookieAttributes, action: 'set' | 'delete'): string {
  if (action === 'delete') {
    return `${attributes.name}=; Path=${attributes.path}; HttpOnly; SameSite=${capitalize(attributes.sameSite)}; Max-Age=0`
  }
  const parts = [
    `${attributes.name}=${value}`,
    `Path=${attributes.path}`,
    `HttpOnly`,
    `SameSite=${capitalize(attributes.sameSite)}`,
  ]
  if (attributes.secure) parts.push('Secure')
  if (attributes.maxAge !== undefined) parts.push(`Max-Age=${String(Math.floor(attributes.maxAge))}`)
  return parts.join('; ')
}

/** sameSite 首字母大写。 / Capitalize the sameSite value. */
function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

/** 从请求头读取全部 Cookie 的键值对。 / Parse all cookie key-values from a request header. */
export function parseCookieHeader(header: string | undefined | null): Record<string, string> {
  const jar: Record<string, string> = {}
  if (header === undefined || header === null || header === '') return jar
  for (const part of header.split(';')) {
    const index = part.indexOf('=')
    if (index <= 0) continue
    const name = part.slice(0, index).trim()
    const value = part.slice(index + 1).trim()
    if (name !== '') jar[name] = decodeURIComponent(value)
  }
  return jar
}
