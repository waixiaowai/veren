/**
 * Configuration of the local auth provider.
 *
 * The raw config arrives from the plugin declaration; `resolveAuthConfig`
 * applies every default so the rest of the provider reads a fully resolved
 * value and never re-derives one.
 *
 * 本地认证 provider 的配置。原始配置来自插件声明；`resolveAuthConfig` 应用全部
 * 默认值，provider 其余部分只读已解析值，不再各自推导。
 *
 * @module @veren/admin-auth-local/config
 */

/** Raw plugin configuration. 原始插件配置。 */
export interface AuthConfig {
  /** Browser session lifetime in days. 浏览器会话时长（天）。 */
  sessionDays?: number
  /** Idle expiry in hours. 空闲过期（小时）。 */
  idleHours?: number
  /** Mark cookies `Secure`; enable behind TLS. 处于 TLS 后时给 Cookie 加 `Secure`。 */
  secureCookies?: boolean
  /** Minimum password length. 最小口令长度。 */
  passwordMinLength?: number
  /** Sign-in attempt budget. 登录尝试预算。 */
  loginRateLimit?: { window?: number; max?: number }
}

/** Configuration with every default applied. 已应用全部默认值的配置。 */
export interface ResolvedAuthConfig {
  /** Session lifetime in days. 会话时长（天）。 */
  readonly sessionDays: number
  /** Idle expiry in hours. 空闲过期（小时）。 */
  readonly idleHours: number
  /** Whether cookies carry `Secure`. Cookie 是否携带 `Secure`。 */
  readonly secureCookies: boolean
  /** Minimum password length. 最小口令长度。 */
  readonly passwordMinLength: number
  /** Sign-in attempt budget. 登录尝试预算。 */
  readonly loginRateLimit: { readonly window: number; readonly max: number }
}

/**
 * Apply defaults to a validated auth config.
 *
 * @param config - raw config 原始配置
 * @returns the resolved config 解析后的配置
 */
export function resolveAuthConfig(config: AuthConfig): ResolvedAuthConfig {
  return {
    sessionDays: config.sessionDays ?? 7,
    idleHours: config.idleHours ?? 12,
    secureCookies: config.secureCookies ?? false,
    passwordMinLength: config.passwordMinLength ?? 8,
    loginRateLimit: { window: config.loginRateLimit?.window ?? 60, max: config.loginRateLimit?.max ?? 10 },
  }
}
