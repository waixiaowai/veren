/**
 * 测试装配助手：sqlite 内存库 + @veren/orm 适配器 + 完整 auth 实例。
 * 每个用例独立数据源，互不共享状态（并发安全）。
 *
 * The test assembly helper: an in-memory sqlite database, the @veren/orm
 * adapter and a full auth instance. Every case gets its own data source;
 * no state is shared (concurrency-safe).
 *
 * @module tests/helpers
 */

import { DataSource } from '@veren/orm'
import '@veren/orm/driver/sqlite'
import type { Auth } from '../src/index.ts'
import { createAuth, createAuthEntities, createOrmAdapter, getAuthTables } from '../src/index.ts'
import type { AuthOptions } from '../src/index.ts'

/** 建一个隔离的认证实例（内存 sqlite）。 / Build an isolated auth instance (in-memory sqlite). */
export async function buildAuth(options: AuthOptions = {}): Promise<Auth> {
  const tables = getAuthTables({ rateLimitStorage: options.rateLimit?.storage ?? 'memory' })
  const dataSource = new DataSource({ type: 'sqlite', entities: createAuthEntities(tables), synchronize: true })
  await dataSource.initialize()
  return createAuth({
    adapter: createOrmAdapter(dataSource, tables),
    options: {
      baseURL: 'http://127.0.0.1:3080',
      basePath: '/auth',
      secret: 'test-secret-that-is-long-enough-1234567890',
      trustedOrigins: ['http://localhost:3080'],
      ...options,
    },
  })
}

/** 带邮箱口令的默认装配（baseURL 由 buildAuth 兜底）。 / The default assembly with email+password enabled (baseURL falls back in buildAuth). */
export async function buildPasswordAuth(options: Omit<AuthOptions, 'baseURL'> = {}): Promise<Auth> {
  return buildAuth({ emailAndPassword: { enabled: true }, ...options })
}

/** 发一个 HTTP 请求穿过完整管线。 / Fire one HTTP request through the full pipeline. */
export function call(auth: Auth, path: string, init?: RequestInit): Promise<Response> {
  return auth.handler(new Request(`http://127.0.0.1:3080${path}`, init))
}

/** JSON POST 快捷方式（带受信 origin）。 / JSON POST shortcut (with a trusted origin). */
export function post(auth: Auth, path: string, body: unknown, origin = 'http://127.0.0.1:3080'): Promise<Response> {
  return call(auth, path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify(body),
  })
}

/** 从响应收集 Set-Cookie。 / Collect Set-Cookie values from a response. */
export function cookiesOf(response: Response): Record<string, string> {
  const jar: Record<string, string> = {}
  for (const cookie of response.headers.getSetCookie()) {
    const [pair] = cookie.split(';')
    const index = pair.indexOf('=')
    if (index > 0) jar[pair.slice(0, index)] = pair.slice(index + 1)
  }
  return jar
}

/** 用 Set-Cookie 构造带凭据的请求头。 / Build a cookie header from the jar. */
export function cookieHeader(jar: Record<string, string>): string {
  return Object.entries(jar).map(([name, value]) => `${name}=${value}`).join('; ')
}

/** 注册一名用户并返回其会话 Cookie。 / Register a user and answer the session cookie jar. */
export async function signUpUser(auth: Auth, email = 'ada@example.com', password = 'sup3r-secret-pw'): Promise<Response> {
  return post(auth, '/auth/sign-up/email', { name: 'Ada', email, password })
}
