/**
 * The auth assembly: @veren/auth-core wired to this deployment's facts — the
 * signing secret from the credential store, `baseURL`/`trustedOrigins` from
 * the listener origin, the cookie `Secure` flag from the listener protocol
 * only, and durable session rows in the sqlite database. Restarts keep users
 * logged in.
 * 认证装配：把 @veren/auth-core 接到本部署的事实——签名秘密来自凭据存储，
 * `baseURL`/`trustedOrigins` 来自监听器 origin，Cookie 的 `Secure` 标志仅由
 * 监听器协议决定，会话行持久化在 sqlite 数据库里（重启后仍保持登录）。
 * @module src/auth-kit
 */

import { createAuth, createOrmAdapter, getAuthTables, loopbackOriginAliases } from '@veren/auth-core'
import type { Auth } from '@veren/auth-core'
import type { DataSource } from '@veren/orm'

/** Everything {@link buildAuthKit} needs. {@link buildAuthKit} 所需的全部输入。 */
export interface AuthKitInputs {
  /** The opened auth database. 已打开的认证数据库。 */
  dataSource: DataSource
  /** Signing secret from the credential store. 来自凭据存储的签名秘密。 */
  secret: string
  /** Listener origin from `webServer.getOrigin()`, e.g. `http://127.0.0.1:3080`. 监听器 origin。 */
  origin: string
  /** Whether the listener serves TLS; the only input to the cookie `Secure` flag. 监听器是否 TLS；Cookie `Secure` 的唯一依据。 */
  secure: boolean
  /** Session lifetime in days. 会话时长（天）。 */
  expiresInDays: number
  /**
   * Sign-in rate limit (brute-force protection): `max` failures per `window`
   * seconds. `false` disables it — only tests should do that.
   * 登录限流策略（暴力尝试防护）。`false` 关闭——仅测试应这样做。
   */
  rateLimit?: { window: number, max: number } | false
}

/** Optional first-run administrator seed. 可选的首次运行管理员种子。 */
export interface AdminSeed {
  email: string
  password: string
  name: string
}

/** The auth table set (mirrors database.ts's deployment decision). 认证表集合（与 database.ts 的部署决策一致）。 */
const TABLES = getAuthTables({ rateLimitStorage: 'memory' })

/**
 * Build the auth instance: email+password sign-in, Strict same-site cookies,
 * an in-memory rate limiter as brute-force protection, and the @veren/orm
 * adapter as its database. Assembly failures fail the plugin load loudly.
 * 构建 auth 实例：邮箱+密码登录、Strict 同站 Cookie、内存限流器作为暴力尝试
 * 防护、@veren/orm 适配器作为数据库。装配失败让插件加载显式失败。
 * @param inputs - Resolved inputs, see {@link AuthKitInputs}.
 * @returns the ready auth instance.
 */
export async function buildAuthKit(inputs: AuthKitInputs): Promise<Auth> {
  const rateLimit = inputs.rateLimit === false
    ? { enabled: false }
    : { enabled: true, window: inputs.rateLimit?.window ?? 60, max: inputs.rateLimit?.max ?? 10 }
  return createAuth({
    adapter: createOrmAdapter(inputs.dataSource, TABLES),
    options: {
      appName: 'dsh-web-login-gate',
      // The plugin serves the framework under the free `/auth` prefix route.
      // 插件把框架挂在空闲的 `/auth` 前缀路由下。
      basePath: '/auth',
      baseURL: inputs.origin,
      secret: inputs.secret,
      trustedOrigins: loopbackOriginAliases(inputs.origin),
      emailAndPassword: { enabled: true, minPasswordLength: 8 },
      session: { expiresIn: inputs.expiresInDays * 24 * 60 * 60, updateAge: 24 * 60 * 60 },
      rateLimit,
      advanced: {
        cookiePrefix: 'dsh-login',
        // The listener protocol is the only input to the Secure flag — never
        // publicUrl or forwarded headers.
        // 监听器协议是 Secure 标志的唯一依据——绝不使用 publicUrl 或转发头。
        useSecureCookies: inputs.secure,
        cookieSameSite: 'strict',
      },
    },
  })
}

/**
 * Create the bootstrap administrator when no user carries the email yet.
 * The password is consumed once — the stored account is the scrypt hash the
 * framework wrote, so later restarts never read the config value.
 * 当还没有用户持有该邮箱时创建引导管理员。口令只消费一次——落库的是框架写入
 * 的 scrypt 哈希，之后的重启不再读取该配置值。
 * @param auth - The assembled auth instance.
 * @param seed - The configured admin seed.
 */
export async function bootstrapAdmin(auth: Auth, seed: AdminSeed): Promise<void> {
  // Scan the durable user table directly: the check must not depend on any
  // admin API (this gate ships no admin extension).
  // 直接扫描持久 user 表：该检查不依赖任何管理 API（本门禁不安装管理扩展）。
  const existing = await auth.context.adapter.findMany({
    model: 'user',
    where: [{ field: 'email', value: seed.email.toLowerCase() }],
  })
  if (existing.length > 0) return
  await auth.api.signUpEmail({
    body: { email: seed.email, password: seed.password, name: seed.name },
  })
}
