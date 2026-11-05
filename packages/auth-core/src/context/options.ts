import type { AuthPlugin } from '../plugin/plugin-types.ts'

/**
 * 顶层配置与归一（设计文档 modules/01-context.md）。
 * 归一是本域三件事之一：`basePath` 补默认、会话参数补默认、限流参数补默认、
 * 口令能力补默认。缺省值与设计 §1.2 的能力清单一致。
 *
 * Top-level options and normalization (design modules/01-context.md).
 * Normalization is one of the domain's three duties: fill `basePath`,
 * session parameters, rate-limit parameters and the password capability
 * defaults, matching the §1.2 capability inventory.
 *
 * @module @veren/auth-core/context/options
 */

/** 会话参数（秒）。 / Session parameters (seconds). */
export interface SessionOptions {
  /** 强制会话落库（二级存储承载时仍落库）。 / Force session rows into the database. */
  storeSessionInDatabase?: boolean
  /** 默认 604800（7 天）。 / Default 604800 (7 days). */
  expiresIn?: number
  /** 续期节流，默认 86400；0 表示每次都续期。 / Refresh throttle, default 86400; 0 refreshes every time. */
  updateAge?: number
  /** 新鲜度窗口，默认 86400；0 关闭检查。 / Freshness window, default 86400; 0 disables. */
  freshAge?: number
  /** 敏感端点吊销口令重置的全部会话，默认否。 / Revoke all sessions on password reset, default false. */
  revokeSessionsOnPasswordReset?: boolean
}

/** 限流参数。 / Rate-limit parameters. */
export interface RateLimitOptions {
  /** 默认跟随生产环境判定。 / Default follows the production flag. */
  enabled?: boolean
  /** 窗口秒数，默认 10。 / Window seconds, default 10. */
  window?: number
  /** 窗口上限，默认 100。 / Window cap, default 100. */
  max?: number
  /** 计数存储，默认 memory。 / Counter storage, default memory. */
  storage?: 'memory' | 'database'
}

/** 口令能力配置。 / Password capability config. */
export interface PasswordOptions {
  /** 注册与登录开关。 / The sign-up/sign-in switch. */
  enabled?: boolean
  /** 最小长度，默认 8。 / Minimum length, default 8. */
  minPasswordLength?: number
  /** 最大长度，默认 128。 / Maximum length, default 128. */
  maxPasswordLength?: number
  /** 注册后自动登录，默认 true。 / Auto sign-in after sign-up, default true. */
  autoSignIn?: boolean
  /** 注册查重命中是否透明返回（防枚举），默认 false。 / Transparent duplicate-sign-up response (anti-enumeration), default false. */
  transparentSignUp?: boolean
  /** 口令重置发信回调；未配置时重置端点报错。 / The reset-mail callback; reset endpoints fail without it. */
  sendResetPassword?: (input: { user: { email: string }, url: string, token: string }) => Promise<void>
  /** 重置成功后的回调。 / The post-reset callback. */
  onPasswordReset?: (input: { user: { id: string, email: string } }) => Promise<void>
  /** 重置令牌有效期（秒），默认 3600。 / Reset token lifetime (seconds), default 3600. */
  resetPasswordTokenExpiresIn?: number
}

/** 邮箱校验配置。 / Email-verification config. */
export interface EmailVerificationOptions {
  /** 发信回调；未配置时相关端点报 VERIFICATION_EMAIL_NOT_ENABLED。 / The send callback; endpoints fail with VERIFICATION_EMAIL_NOT_ENABLED without it. */
  sendVerificationEmail?: (input: { user: { email: string }, url: string, token: string }) => Promise<void>
  /** 登录是否强制已验证，默认 false。 / Require verification at sign-in, default false. */
  require?: boolean
  /** 校验通过后自动登录，默认 false。 / Auto sign-in after verification, default false. */
  autoSignInAfterVerification?: boolean
  /** 校验链接回跳，默认 "/"。 / Verification callback path, default "/". */
  callbackURL?: string
}

/** 主体档案配置。 / User-model config. */
export interface UserModelOptions {
  /** 注册/更新允许写入的附加字段白名单。 / The writable additional-field whitelist for sign-up/update. */
  additionalFields?: Record<string, { type: 'string' | 'number' | 'boolean', input: boolean, returned?: boolean }>
}

/** 高级开关。 / Advanced switches. */
export interface AdvancedOptions {
  /** Cookie 前缀，默认 `auth`。 / Cookie prefix, default `auth`. */
  cookiePrefix?: string
  /** Cookie Secure 标志；缺省由 baseURL 协议推导。 / Cookie Secure flag; derived from baseURL protocol by default. */
  useSecureCookies?: boolean
  /** sameSite 策略，默认 lax。 / sameSite policy, default lax. */
  cookieSameSite?: 'strict' | 'lax' | 'none'
  /** 关闭来源校验（布尔或按路径豁免）。 / Disable the origin check (boolean or per-path exemptions). */
  disableOriginCheck?: boolean | string[]
  /** 关闭 CSRF（跨站导航）校验。 / Disable the CSRF (cross-site navigation) check. */
  disableCSRFCheck?: boolean
}

/** 数据钩子：写入前后的观察与拦截点。 / Database hooks: observation and interception around writes. */
export interface DatabaseHooks {
  user?: {
    create?: { before?: (data: Record<string, unknown>) => Promise<Record<string, unknown> | void> }
    update?: { before?: (data: Record<string, unknown>) => Promise<Record<string, unknown> | void> }
  }
  session?: {
    create?: { before?: (session: Record<string, unknown>) => Promise<Record<string, unknown> | void> }
  }
}

/** 请求级钩子声明（用户级；时序为用户 before → 插件 before → 处理器 → 插件 after → 用户 after）。 / Request hook declarations (user level; timing: user before → plugin before → handler → plugin after → user after). */
export interface HooksOptions {
  before?: Array<{ matcher: (path: string) => boolean, handler: (ctx: unknown) => Promise<unknown> }>
  after?: Array<{ matcher: (path: string) => boolean, handler: (ctx: unknown) => Promise<unknown> }>
}

/** 顶层配置。 / The top-level options. */
export interface AuthOptions {
  /** 应用名，默认 `Auth`。 / App name, default `Auth`. */
  appName?: string
  /** 监听 origin（如 `http://127.0.0.1:3080`）。 / The listener origin. */
  baseURL: string
  /** 认证基路径，默认 `/api/auth`。 / The auth base path, default `/api/auth`. */
  basePath?: string
  /** 当前签名密钥。 / The signing secret. */
  secret?: string
  /** 多版本密钥（轮换期共存）。 / Versioned secrets (rotation coexistence). */
  secrets?: Array<{ version: number, value: string }>
  /** 旧格式裸密钥兼容位。 / The legacy bare-secret fallback. */
  legacySecret?: string
  /** 受信来源表（静态）。 / The trusted-origin list (static). */
  trustedOrigins?: string[]
  /** 生产环境判定；限流默认跟随。 / The production flag; rate limit follows by default. */
  isProduction?: boolean
  session?: SessionOptions
  rateLimit?: RateLimitOptions
  emailAndPassword?: PasswordOptions
  emailVerification?: EmailVerificationOptions
  user?: UserModelOptions
  advanced?: AdvancedOptions
  databaseHooks?: DatabaseHooks
  /** 请求级用户钩子。 / User-level request hooks. */
  hooks?: HooksOptions
  /** 禁用路径：命中即 404。 / Disabled paths: a hit answers 404. */
  disabledPaths?: string[]
  /** 扩展声明（装配域按声明顺序合并）。 / Extension declarations (merged in declaration order). */
  plugins?: AuthPlugin[]
}

/** 归一后的配置面：全部缺省已就位。 / The normalized option face: every default in place. */
export interface NormalizedOptions extends Required<Omit<
  AuthOptions,
  'secrets' | 'legacySecret' | 'session' | 'rateLimit' | 'emailAndPassword' | 'emailVerification' | 'user' | 'advanced' | 'databaseHooks' | 'hooks' | 'disabledPaths' | 'trustedOrigins' | 'isProduction' | 'plugins'
>> {
  secrets?: Array<{ version: number, value: string }>
  legacySecret?: string
  trustedOrigins: string[]
  isProduction: boolean
  session: Required<Pick<SessionOptions, 'expiresIn' | 'updateAge' | 'freshAge'>> & SessionOptions
  rateLimit: Required<Pick<RateLimitOptions, 'window' | 'max' | 'storage'>> & RateLimitOptions
  emailAndPassword: Required<Pick<PasswordOptions, 'enabled' | 'minPasswordLength' | 'maxPasswordLength' | 'autoSignIn' | 'transparentSignUp' | 'resetPasswordTokenExpiresIn'>> & PasswordOptions
  emailVerification: EmailVerificationOptions
  user: UserModelOptions
  advanced: Required<Pick<AdvancedOptions, 'cookiePrefix' | 'cookieSameSite'>> & AdvancedOptions
  databaseHooks?: DatabaseHooks
  hooks?: HooksOptions
  disabledPaths: string[]
}

/** 缺省常量（单位秒）。 / Default constants (seconds). */
export const DEFAULTS = {
  basePath: '/api/auth',
  sessionExpiresIn: 60 * 60 * 24 * 7,
  sessionUpdateAge: 24 * 60 * 60,
  sessionFreshAge: 24 * 60 * 60,
  rateWindow: 10,
  rateMax: 100,
  minPasswordLength: 8,
  maxPasswordLength: 128,
  resetTokenExpiresIn: 3600,
  verificationExpiresIn: 3600,
} as const

/**
 * 归一配置：装配期一次性完成，运行期只读取。
 * / Normalize options once at assembly; the runtime only reads the result.
 */
export function normalizeOptions(options: AuthOptions): NormalizedOptions {
  return {
    appName: options.appName ?? 'Auth',
    baseURL: options.baseURL,
    basePath: options.basePath ?? DEFAULTS.basePath,
    secret: options.secret ?? '',
    secrets: options.secrets,
    legacySecret: options.legacySecret,
    trustedOrigins: [...(options.trustedOrigins ?? [])],
    isProduction: options.isProduction ?? false,
    session: {
      expiresIn: options.session?.expiresIn ?? DEFAULTS.sessionExpiresIn,
      updateAge: options.session?.updateAge ?? DEFAULTS.sessionUpdateAge,
      freshAge: options.session?.freshAge ?? DEFAULTS.sessionFreshAge,
      revokeSessionsOnPasswordReset: options.session?.revokeSessionsOnPasswordReset ?? false,
    },
    rateLimit: {
      enabled: options.rateLimit?.enabled ?? (options.isProduction ?? false),
      window: options.rateLimit?.window ?? DEFAULTS.rateWindow,
      max: options.rateLimit?.max ?? DEFAULTS.rateMax,
      storage: options.rateLimit?.storage ?? 'memory',
    },
    emailAndPassword: {
      enabled: options.emailAndPassword?.enabled ?? false,
      minPasswordLength: options.emailAndPassword?.minPasswordLength ?? DEFAULTS.minPasswordLength,
      maxPasswordLength: options.emailAndPassword?.maxPasswordLength ?? DEFAULTS.maxPasswordLength,
      autoSignIn: options.emailAndPassword?.autoSignIn ?? true,
      transparentSignUp: options.emailAndPassword?.transparentSignUp ?? false,
      resetPasswordTokenExpiresIn: options.emailAndPassword?.resetPasswordTokenExpiresIn ?? DEFAULTS.resetTokenExpiresIn,
      sendResetPassword: options.emailAndPassword?.sendResetPassword,
    },
    emailVerification: options.emailVerification ?? {},
    user: options.user ?? {},
    advanced: {
      cookiePrefix: options.advanced?.cookiePrefix ?? 'auth',
      cookieSameSite: options.advanced?.cookieSameSite ?? 'lax',
      useSecureCookies: options.advanced?.useSecureCookies,
      disableOriginCheck: options.advanced?.disableOriginCheck,
      disableCSRFCheck: options.advanced?.disableCSRFCheck ?? false,
    },
    databaseHooks: options.databaseHooks,
    hooks: options.hooks,
    disabledPaths: [...(options.disabledPaths ?? [])],
  }
}
