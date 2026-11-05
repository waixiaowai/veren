/**
 * 插件域契约（设计文档 modules/09-plugin.md 与 architecture.md §1.8）。
 * 扩展只允许做四件事：注册端点、贡献表模型、挂载钩子、声明限流规则；
 * 不得直接改写会话记录与主体档案——核心域对这些实体的写入权是排他的。
 * init 返回的上下文/选项补丁由上下文装配域按固定顺序合并。
 *
 * The plugin contract (design modules/09-plugin.md and architecture.md §1.8).
 * Extensions may only: register endpoints, contribute table models, mount
 * hooks and declare rate-limit rules; they must never write session rows or
 * user profiles directly — the core domains own those exclusively. Context
 * and option patches returned from init merge through the context domain in
 * a fixed order.
 *
 * @module @veren/auth-core/plugin/plugin-types
 */

import type { DBSchema } from '../storage/adapter.ts'
import type { AuthContext } from '../context/auth-context.ts'
import type { AuthHook, EndpointDefinition, Middleware } from '../endpoint/endpoint-types.ts'
import type { InternalAdapterHooks } from '../identity/internal-adapter.ts'

/** 插件专属限流规则：路径匹配器 + 窗口/上限。 / A plugin rate-limit rule: path matcher plus window/cap. */
export interface PluginRateLimitRule {
  /** 路径前缀或通配（如 `/sign-in*`）。 / A path prefix or glob (e.g. `/sign-in*`). */
  pathPattern: string
  /** 窗口秒数。 / Window seconds. */
  window: number
  /** 窗口上限。 / Window cap. */
  max: number
}

/** 插件声明的路由级中间件：自带路径匹配器。 / A plugin route middleware with its own path matcher. */
export interface PluginMiddleware {
  /** 匹配器：命中才执行。 / The matcher; only hits run. */
  matcher: (path: string) => boolean
  middleware: Middleware
}

/**
 * 扩展契约。init 允许同步或异步；init 抛错即装配整体失败（响亮失败）。
 * / The extension contract. init may be sync or async; a throw fails the
 * whole assembly (fails loud).
 */
export interface AuthPlugin {
  /** 全局唯一标识。 / The globally unique id. */
  id: string
  version?: string
  /** 装配期初始化：返回上下文/选项补丁。 / Assembly-time init returning context/option patches. */
  init?: (ctx: AuthContext) => Promise<{ context?: Partial<AuthContext>, options?: Record<string, unknown> } | void>
  /** 贡献端点（按键合并，后声明覆盖先声明）。 / Contributed endpoints (key-merged; later declarations win). */
  endpoints?: Record<string, EndpointDefinition & { handler: (ctx: import('../endpoint/endpoint-types.ts').EndpointContext) => Promise<unknown> }>
  /** 路由级中间件。 / Route-level middlewares. */
  middlewares?: PluginMiddleware[]
  /** 请求级钩子。 / Request-level hooks. */
  hooks?: { before?: AuthHook[], after?: AuthHook[] }
  /** 贡献表模型（同名字段后者覆盖）。 / Contributed table models (later same-name fields win). */
  schema?: DBSchema
  /** 数据钩子（与用户级钩子合并，用户级在后）。 / Database hooks (merged with user hooks, user last). */
  databaseHooks?: InternalAdapterHooks
  /** 专属限流规则（优先级高于框架专属规则）。 / Plugin rate-limit rules (above the framework's own). */
  rateLimit?: PluginRateLimitRule[]
}

/** 请求头形态引用（类型面完整性）。 / Keep the header type surface complete. */
export type { Middleware, AuthHook }
