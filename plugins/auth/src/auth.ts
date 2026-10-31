/**
 * Better Auth instance construction for the login gate: the signing secret
 * lives in the official `ctx.credentials` service (never in plain config),
 * `baseURL`/`trustedOrigins` come from `webServer.getOrigin()` at build time,
 * the `Secure` cookie flag follows the listener protocol only, and sessions
 * are durable rows in the domain (restarts keep users logged in).
 * 登录门禁的 Better Auth 实例构建：签名秘密保存在官方 `ctx.credentials` 服务中
 * （绝不写入明文配置），`baseURL`/`trustedOrigins` 在构建时经
 * `webServer.getOrigin()` 动态获取，Cookie 的 `Secure` 标志仅由监听器协议决定，
 * 会话是 domain 中的持久行（重启后仍保持登录）。
 * @module src/auth
 */

import { betterAuth } from 'better-auth'
import type { BetterAuthOptions } from 'better-auth'
import { kyselyAdapter } from '@better-auth/kysely-adapter'
import { randomBytes } from 'node:crypto'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { openDomainKysely } from '@veren/kysely-dsh-dialect'
import { LOGIN_GATE_MODELS } from './domain.js'
import type { LoginGateDomain } from './domain.js'

/** Credential record holding the Better Auth signing secret. 保存 Better Auth 签名秘密的凭据记录。 */
const SECRET_RECORD = credentialKey('web-login-gate', 'better-auth-secret')

const SECRET_BYTES = 32
/** Stored payload version; a mismatch fails the load instead of guessing. 存储载荷版本；不匹配则加载失败而非猜测。 */
const SECRET_VERSION = 1

/** Extract and validate the secret text from a credential record. 从凭据记录提取并校验秘密文本。 */
function secretOf(record: { kind: string, payload?: unknown } | undefined): string {
  if (record === undefined || record.kind !== 'grant') {
    throw new Error('web-login-gate: the Better Auth secret credential record has an unsupported kind')
  }
  const payload = record.payload as { version?: unknown, secret?: unknown }
  if (payload.version !== SECRET_VERSION || typeof payload.secret !== 'string'
    || payload.secret.length < SECRET_BYTES) {
    throw new Error('web-login-gate: the Better Auth secret credential record has an invalid payload')
  }
  return payload.secret
}

/**
 * Load the durable signing secret, minting one on first use.
 * @param credentials - The official credential provider of this harness home.
 * @returns the secret string for Better Auth's `secret` option.
 */
export async function loadAuthSecret(credentials: CredentialProvider): Promise<string> {
  const record = await credentials.modifyRecord(SECRET_RECORD, (current) => {
    if (current !== undefined) return Promise.resolve(undefined)
    return Promise.resolve({
      kind: 'grant',
      payload: { version: SECRET_VERSION, secret: randomBytes(SECRET_BYTES).toString('base64url') },
    })
  })
  return secretOf(record)
}

/** Everything {@link buildBetterAuth} needs. {@link buildBetterAuth} 所需的全部输入。 */
export interface BetterAuthInputs {
  /** The opened login-gate domain handle. 已打开的登录门禁 domain 句柄。 */
  domain: LoginGateDomain
  /** Signing secret from the credential store. 来自凭据存储的签名秘密。 */
  secret: string
  /** Listener origin from `webServer.getOrigin()`, e.g. `http://127.0.0.1:3080`. 监听器 origin。 */
  origin: string
  /** Whether the listener serves TLS; the only input to the cookie `Secure` flag. 监听器是否 TLS；Cookie `Secure` 的唯一依据。 */
  secure: boolean
  /** Session lifetime in days. 会话时长（天）。 */
  expiresInDays: number
  /**
   * Sign-in rate-limit policy (brute-force protection). `false` disables it —
   * only tests should do that.
   * 登录限流策略（暴力尝试防护）。`false` 关闭——仅测试应这样做。
   */
  rateLimit?: { window: number, max: number } | false
}

/** The configured Better Auth instance (server side). 配置完成的 Better Auth 实例（服务端）。 */
export type LoginGateAuth = ReturnType<typeof betterAuth<BetterAuthOptions>>

/**
 * Expand a loopback origin with its sibling loopback spellings (`127.0.0.1`
 * vs `localhost`): users reach the same listener through either host, and
 * Better Auth's origin check must admit both. Non-loopback origins keep
 * their exact spelling only.
 * 为 loopback origin 补齐孪生写法（`127.0.0.1` 与 `localhost`）：用户会经任意
 * 一种主机名访问同一监听器，Better Auth 的 origin 检查必须同时接受。非
 * loopback origin 保持原样。
 * @param origin - The listener origin, e.g. `http://127.0.0.1:3080`.
 * @returns the accepted origin list.
 */
export function loopbackOriginAliases(origin: string): string[] {
  let url: URL
  try {
    url = new URL(origin)
  } catch {
    return [origin]
  }
  const loopback = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])
  if (!loopback.has(url.hostname)) return [origin]
  const list = [origin.replace(/\/$/, '')]
  for (const host of ['127.0.0.1', 'localhost']) {
    const alias = new URL(origin)
    alias.hostname = host
    const text = alias.toString().replace(/\/$/, '')
    if (!list.includes(text)) list.push(text)
  }
  return list
}

/**
 * Open the domain-backed Kysely database Better Auth runs on.
 * 打开 Better Auth 所依赖的 domain 存储 Kysely 数据库。
 * @param domain - The opened login-gate domain handle. 已打开的登录门禁 domain 句柄。
 * @returns the Kysely database handle. Kysely 数据库句柄。
 */
function openAuthDatabase(domain: LoginGateDomain) {
  // The dialect turns Kysely queries into domain-table operations; sqlite is
  // the closest capability profile (dynamic types, no server transactions).
  // dialect 把 Kysely 查询变为 domain 表操作；sqlite 是最贴近的能力档案
  // （动态类型、无服务端事务）。
  return openDomainKysely(domain, LOGIN_GATE_MODELS)
}

/**
 * Session block of the Better Auth options: lifetime derived from the
 * configured days, refreshed daily, rows kept in the domain database.
 * Better Auth 选项的会话块：时长由配置天数推导，按天刷新，会话行持久化在
 * domain 数据库里。
 * @param expiresInDays - Session lifetime in days. 会话时长（天）。
 * @returns the `session` options section. `session` 选项段。
 */
function authSessionConfig(expiresInDays: number) {
  return {
    expiresIn: expiresInDays * 24 * 60 * 60,
    updateAge: 24 * 60 * 60,
    storeSessionInDatabase: true,
  }
}

/**
 * Advanced block of the Better Auth options: cookie flags and the schema
 * validation switch.
 * Better Auth 选项的高级块：Cookie 标志与 schema 校验开关。
 * @param secure - Whether the listener serves TLS. 监听器是否 TLS。
 * @returns the `advanced` options section. `advanced` 选项段。
 */
function authAdvancedConfig(secure: boolean) {
  return {
    useSecureCookies: secure,
    cookiePrefix: 'dsh-login',
    defaultCookieAttributes: { sameSite: 'strict', path: '/' } as const,
    // Domain storage is schema-loose by design (fields belong to Better Auth
    // and evolve with it; the domain spec versions the medium), so Better
    // Auth's SQL-flavored column diff does not apply here.
    // domain 存储本就是宽松 schema（字段集归 Better Auth 且随其演进；介质版本
    // 由 domain spec 管理），Better Auth 面向 SQL 的列比对在此不适用。
    database: { validateSchema: false },
  }
}

/**
 * Rate-limit block of the Better Auth options: either the explicit
 * brute-force window/limit or an explicit disable (tests only).
 * Better Auth 选项的限流块：显式的暴力尝试窗口/上限，或显式关闭（仅测试）。
 * @param rateLimit - The configured policy. 配置的限流策略。
 * @returns the `rateLimit` options section. `rateLimit` 选项段。
 */
function authRateLimitConfig(rateLimit: BetterAuthInputs['rateLimit']) {
  if (rateLimit === false) return { enabled: false, storage: 'memory' } as const
  return {
    enabled: true,
    window: rateLimit?.window ?? 60,
    max: rateLimit?.max ?? 10,
    storage: 'memory',
  } as const
}

/**
 * Build the Better Auth server instance: email+password sign-in, strict
 * same-site cookies, a memory rate limiter as brute-force protection, and
 * the domain-storage adapter as its database.
 * 构建 Better Auth 服务端实例：邮箱+密码登录、Strict 同站 Cookie、内存限流器
 * 作为暴力尝试防护，以及经 Kysely dialect 落在 domain 存储上的数据库。
 * @param inputs - Resolved inputs, see {@link BetterAuthInputs}.
 * @returns the ready Better Auth instance.
 */
export function buildBetterAuth(inputs: BetterAuthInputs): LoginGateAuth {
  const db = openAuthDatabase(inputs.domain)
  return betterAuth<BetterAuthOptions>({
    appName: 'dsh-web-login-gate',
    // The plugin serves Better Auth under the free `/auth` prefix route.
    // 插件把 Better Auth 挂在空闲的 `/auth` 前缀路由下。
    basePath: '/auth',
    baseURL: inputs.origin,
    trustedOrigins: loopbackOriginAliases(inputs.origin),
    secret: inputs.secret,
    database: kyselyAdapter(db, { type: 'sqlite', transaction: false }),
    emailAndPassword: { enabled: true, minPasswordLength: 8 },
    session: authSessionConfig(inputs.expiresInDays),
    advanced: authAdvancedConfig(inputs.secure),
    rateLimit: authRateLimitConfig(inputs.rateLimit),
  })
}

/** Optional first-run administrator seed. 可选的首次运行管理员种子。 */
export interface AdminSeed {
  email: string
  password: string
  name: string
}

/**
 * Create the bootstrap administrator when no user carries the email yet.
 * The password is consumed once — the stored account is the scrypt/argon2
 * hash Better Auth wrote, so later restarts never read the config value.
 * @param auth - The configured Better Auth instance.
 * @param seed - The configured admin seed.
 */
export async function bootstrapAdmin(auth: LoginGateAuth, domain: LoginGateDomain, seed: AdminSeed): Promise<void> {
  // Scan the durable user table directly: the check must not depend on any
  // Better Auth admin API (this gate ships no admin plugin).
  // 直接扫描持久 user 表：该检查不依赖任何 Better Auth 管理 API（本门禁不
  // 安装 admin 插件）。
  for (const [, record] of domain.table('user').entries()) {
    if (typeof record.email === 'string' && record.email.toLowerCase() === seed.email.toLowerCase()) return
  }
  await auth.api.signUpEmail({
    body: { email: seed.email, password: seed.password, name: seed.name },
  })
}
