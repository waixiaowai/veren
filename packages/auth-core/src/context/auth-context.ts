/**
 * 上下文装配域：把配置、密钥、存储契约与扩展声明合并为单一共享上下文
 * （设计文档 modules/01-context.md §1.3 契约）。
 * 装配先行、读取单一：全部能力只从这里取依赖。插件 init 返回的上下文补丁
 * Object.assign 就地合并、选项补丁 defu 深合并、数据钩子收集后重建
 * internalAdapter（用户级永远最后）。
 *
 * The context assembly domain: config, secrets, the storage contract and
 * extension declarations merge into one shared context (design
 * modules/01-context.md §1.3). Assembly first, single read: every capability
 * takes dependencies from here. Plugin init patches Object.assign in place,
 * option patches merge defu-style, and database hooks collect before the
 * internalAdapter rebuild (user hooks always last).
 *
 * @module @veren/auth-core/context/auth-context
 */

import { randomUUID } from 'node:crypto'
import type { DBAdapter, DBSchema } from '../storage/adapter.ts'
import { getAuthTables } from '../storage/tables.ts'
import type { InternalAdapter, InternalAdapterHooks } from '../identity/internal-adapter.ts'
import { createInternalAdapter } from '../identity/internal-adapter.ts'
import type { SessionAuthority } from '../session/authority.ts'
import { createSessionAuthority } from '../session/authority.ts'
import type { PasswordCapability } from '../credential/password.ts'
import { createPasswordCapability } from '../credential/password.ts'
import { defu } from '../util/defu.ts'
import type { AuthPlugin } from '../plugin/plugin-types.ts'
import type { AuthCookies } from './cookies.ts'
import { createAuthCookies } from './cookies.ts'
import type { AuthOptions, NormalizedOptions } from './options.ts'
import { normalizeOptions } from './options.ts'
import type { ResolvedSecret } from './secret.ts'
import { resolveSecret } from './secret.ts'
import { isTrustedOrigin, mergeTrustedOrigins } from './trusted-origins.ts'

/** 共享装配上下文：请求期不得回写（决策 2），派生状态走克隆体。 / The shared auth context: no request-time writes (decision 2); derived state goes on clones. */
export interface AuthContext {
  /** 归一后的配置（单一事实来源）。 / The normalized options (single source of truth). */
  options: NormalizedOptions
  /** 核心表 + 插件表的合并模型。 / Core plus plugin table models. */
  tables: DBSchema
  /** 宿主提供的数据库适配器。 / The host database adapter. */
  adapter: DBAdapter
  /** 面向业务的内部适配层（身份域权威）。 / The business-facing internal adapter (identity authority). */
  internalAdapter: InternalAdapter
  /** 会话权威。 / The session authority. */
  sessionAuthority: SessionAuthority
  /** 口令能力。 / The password capability. */
  password: PasswordCapability
  /** Cookie 面。 / The cookie face. */
  authCookies: AuthCookies
  /** 密钥与多版本配置。 / The secret and its versioned config. */
  secret: string
  secretConfig: string | ResolvedSecret['config']
  /** 受信来源表与判定。 / The trusted-origin list and matcher. */
  trustedOrigins: string[]
  isTrustedOrigin: (url: string, settings?: { allowRelativePaths?: boolean }) => boolean
  /** 守卫开关。 / The guard switches. */
  skipOriginCheck: boolean | string[]
  skipCSRFCheck: boolean
  /** 基址（完整，含 basePath）。 / The full base URL (with basePath). */
  baseURL: string
  appName: string
  version: string
  /** 标识生成：返回 false 交由数据库生成。 / Id generation; false defers to the database. */
  generateId: (input: { model: string, size?: number }) => string | false
  /** 按插件 id 取回实例；未注册返回 null。 / Fetch a plugin by id; null when absent. */
  getPlugin: (pluginId: string) => AuthPlugin | null
  /** 按插件 id 判定是否启用。 / Whether a plugin id is registered. */
  hasPlugin: (pluginId: string) => boolean
  /** 已注册插件清单。 / The registered plugin list. */
  plugins: AuthPlugin[]
  /** 表结构校验：失败只记日志不阻断请求（§8.2）。 / Schema check: log-only, never request-blocking (§8.2). */
  checkSchema?: () => Promise<void>
  logger: { warn: (message: string) => void, error: (message: string) => void, debug: (message: string) => void }
}

/** 装配输入。 / The assembly input. */
export interface CreateAuthContextInput {
  /** 宿主数据库适配器。 / The host database adapter. */
  adapter: DBAdapter
  options: AuthOptions
  /** 静态日志器；缺省走 console。 / A static logger; console by default. */
  logger?: AuthContext['logger']
}

/** 生成器：uuid 为默认，false 交由数据库。 / The generator: uuid by default, false defers to the database. */
function defaultGenerateId(): string | false {
  return randomUUID()
}

/** 装配中间产物：helper 之间的传递面。 / The assembly intermediates passed between helpers. */
interface AssemblyDeps {
  options: NormalizedOptions
  adapter: DBAdapter
  logger: AuthContext['logger']
  plugins: AuthPlugin[]
  hooks: InternalAdapterHooks
  tables: DBSchema
}

/** 核心依赖段：权威与能力面。 / The core segment: authorities and capabilities. */
function contextCore(deps: AssemblyDeps, secret: ResolvedSecret): Pick<AuthContext,
  'options' | 'tables' | 'adapter' | 'internalAdapter' | 'sessionAuthority' | 'password'
  | 'secret' | 'secretConfig' | 'appName' | 'version' | 'generateId'> {
  const internalAdapter = createInternalAdapter(deps.adapter, { hooks: deps.hooks, tables: deps.tables })
  return {
    options: deps.options,
    tables: deps.tables,
    adapter: deps.adapter,
    internalAdapter,
    sessionAuthority: createSessionAuthority(deps.adapter, internalAdapter, {
      expiresIn: deps.options.session.expiresIn,
      updateAge: deps.options.session.updateAge,
      freshAge: deps.options.session.freshAge,
    }, deps.hooks),
    password: createPasswordCapability({
      minPasswordLength: deps.options.emailAndPassword.minPasswordLength,
      maxPasswordLength: deps.options.emailAndPassword.maxPasswordLength,
    }),
    secret: secret.secret,
    secretConfig: secret.config,
    appName: deps.options.appName,
    version: '1.0.0',
    generateId: () => randomUUID(),
  }
}

/** 信任与扩展段：Cookie、受信来源、守卫开关与插件面。 / The trust segment: cookies, trusted origins, guard switches and the plugin face. */
function contextGuards(deps: AssemblyDeps): Pick<AuthContext,
  'authCookies' | 'trustedOrigins' | 'skipOriginCheck' | 'skipCSRFCheck'
  | 'baseURL' | 'plugins' | 'logger'> {
  const trustedOrigins = mergeTrustedOrigins(deps.options.baseURL, deps.options.trustedOrigins)
  return {
    authCookies: createAuthCookies({
      baseURL: deps.options.baseURL,
      prefix: deps.options.advanced.cookiePrefix,
      sameSite: deps.options.advanced.cookieSameSite,
      useSecureCookies: deps.options.advanced.useSecureCookies,
    }),
    trustedOrigins,
    skipOriginCheck: deps.options.advanced.disableOriginCheck ?? false,
    skipCSRFCheck: deps.options.advanced.disableCSRFCheck ?? false,
    baseURL: joinBaseURL(deps.options.baseURL, deps.options.basePath),
    plugins: deps.plugins,
    logger: deps.logger,
  }
}

/** 装配共享上下文。 / Assemble the shared context. */
/** 静态日志器：缺省走 console。 / The static logger; console by default. */
function defaultLogger(input: CreateAuthContextInput): AuthContext['logger'] {
  return input.logger ?? {
    warn: (message: string) => console.warn(`[auth-core] ${message}`),
    error: (message: string) => console.error(`[auth-core] ${message}`),
    debug: (message: string) => console.debug(`[auth-core] ${message}`),
  }
}

export async function createAuthContext(input: CreateAuthContextInput): Promise<AuthContext> {
  const options = normalizeOptions(input.options)
  const secret = resolveSecret({
    secret: options.secret,
    secrets: options.secrets,
    legacySecret: options.legacySecret,
    isProduction: options.isProduction,
  })
  const plugins = [...(input.options.plugins ?? [])]
  const logger = defaultLogger(input)
  const deps: AssemblyDeps = {
    options,
    adapter: input.adapter,
    logger,
    plugins,
    hooks: collectHooks(options.databaseHooks, plugins, logger),
    tables: getAuthTables(tableOptionsOf(options), pluginSchemasOf(plugins)),
  }
  const core = contextCore(deps, secret)
  const guards = contextGuards(deps)
  const ctx: AuthContext = {
    ...core,
    ...guards,
    isTrustedOrigin: (url, settings) => isTrustedOrigin(url, guards.trustedOrigins, settings),
    getPlugin: (pluginId) => deps.plugins.find((plugin) => plugin.id === pluginId) ?? null,
    hasPlugin: (pluginId) => deps.plugins.some((plugin) => plugin.id === pluginId),
  }
  await runPluginInit(ctx)
  return ctx
}

/** 选项切片 → 表装配输入。 / The option slice → table assembly input. */
function tableOptionsOf(options: NormalizedOptions): Parameters<typeof getAuthTables>[0] {
  return {
    rateLimitStorage: options.rateLimit.storage,
    storeSessionInDatabase: options.session.storeSessionInDatabase,
    storeVerificationInDatabase: false,
  }
}

/** 插件贡献的表模型。 / The plugin-contributed table models. */
function pluginSchemasOf(plugins: readonly AuthPlugin[]): DBSchema[] {
  return plugins.map((plugin) => plugin.schema ?? {}).filter((schema) => Object.keys(schema).length > 0)
}

/** 收集数据钩子：插件级按声明顺序在前，用户级永远最后（§1.4）。 / Collect database hooks: plugin hooks in declaration order first, user hooks last (§1.4). */
function collectHooks(userHooks: AuthOptions['databaseHooks'], plugins: readonly AuthPlugin[], logger: AuthContext['logger']): InternalAdapterHooks {
  const merged: InternalAdapterHooks = {}
  for (const plugin of plugins) {
    if (plugin.databaseHooks === undefined) continue
    logger.debug(`database hooks contributed by plugin:${plugin.id}`)
    merged.user = { ...merged.user, ...plugin.databaseHooks.user }
    merged.session = { ...merged.session, ...plugin.databaseHooks.session }
  }
  return {
    user: { ...merged.user, ...userHooks?.user },
    session: { ...merged.session, ...userHooks?.session },
  }
}

/** 基址拼接：origin + basePath。 / Join the origin with the basePath. */
function joinBaseURL(origin: string, basePath: string): string {
  return `${origin.replace(/\/$/, '')}${basePath.startsWith('/') ? basePath : `/${basePath}`}`
}

/**
 * 插件初始化：init 抛错即终止装配（决策 4）；选项补丁 defu 合并，
 * context 补丁 Object.assign 就地合并。
 * / Plugin init: a throw aborts assembly (decision 4); option patches merge
 * defu-style, context patches Object.assign in place.
 */
async function runPluginInit(ctx: AuthContext): Promise<void> {
  let options = ctx.options as NormalizedOptions
  const pluginOrigins: string[] = []
  for (const plugin of ctx.plugins) {
    if (plugin.init === undefined) continue
    const result = await plugin.init(ctx)
    if (result === undefined || result === null) continue
    if (result.options !== undefined) {
      const { trustedOrigins, ...rest } = result.options as Record<string, unknown>
      // 特殊处理 2：插件信任来源不直接合并，收集后重新装配（§1.4）。
      // Special case 2: plugin trusted origins collect and reassemble (§1.4).
      if (Array.isArray(trustedOrigins)) pluginOrigins.push(...trustedOrigins.filter((entry): entry is string => typeof entry === 'string'))
      options = defu(options, rest)
    }
    if (result.context !== undefined) Object.assign(ctx, result.context)
  }
  ctx.options = options
  if (pluginOrigins.length > 0) {
    ctx.trustedOrigins = mergeTrustedOrigins(options.baseURL, [...options.trustedOrigins, ...pluginOrigins])
  }
}
