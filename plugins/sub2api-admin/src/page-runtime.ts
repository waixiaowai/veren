/**
 * 页面会话的共享运行时：装配期绑定的模块级槽位（权威 store + 全名工具）、
 * 本页工具登记、store 直读，以及列表页共用的行投影助手。九个页面的组件体
 * 都从这里取同一套机制；装配（index.ts）在注册时调用 bindSub2ApiRuntime 一次。
 * The page sessions' shared runtime: the assembly-bound module slot (the
 * authoritative store + full-named tools), this page's tool registration, the
 * store's direct read, and the row-projection helper the list pages share. All
 * nine page bodies take this one machinery; the assembly (index.ts) calls
 * bindSub2ApiRuntime once at registration.
 *
 * @module @veren/sub2api-admin/page-runtime
 */
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { PageFC } from '@veren/prompt-page'
import { APP_ID } from './app-definition.ts'
import type { Sub2ApiState } from './store.ts'

/** 应用内 URL 前缀 / the app-scoped url prefix */
export const URL_PREFIX = `/apps/${APP_ID}`

/** 工具对外名：`sub2api_admin__<本地名>`（§3.4.3）——组件体直接以全名登记
 * / the external tool name — the body registers under the full name directly */
export const externalName = (localName: string): string => `sub2api_admin__${localName}`

/** 权威 store 的结构面（快照引用稳定）/ the structural face of the authoritative store (stable snapshots) */
export interface StoreFace {
  getSnapshot(): Sub2ApiState
}

/** 绑定的运行时形状 / the bound runtime's shape */
export interface BoundRuntime {
  readonly store: StoreFace
  readonly tools: readonly ToolDefinition[]
}

/**
 * 装配期绑定的模块级槽位：load（没有 agent 可用）与组件体的工具登记从这里取
 * 权威 store 与全名工具。注册一定先于任何页面打开。
 * The module-level slot bound at assembly time: the bodies' tool registrations
 * and store reads take their authoritative facts from here. Registration always
 * precedes any page open.
 */
let runtime: BoundRuntime | undefined

/** 装配时绑定（index.ts 的单入口注册调用一次）/ bind at assembly time (called once by index.ts's wiring) */
export function bindSub2ApiRuntime(store: StoreFace, tools: readonly ToolDefinition[]): void {
  runtime = { store, tools }
}

/** 取绑定的运行时；未绑定 = 装配错误 fail loud / read the bound runtime; unbound = assembly error, fail loud */
export function requireRuntime(): BoundRuntime {
  if (runtime === undefined) {
    throw new Error('[sub2api-admin] the sub2api runtime is not bound; the app wiring must run before pages open')
  }
  return runtime
}

/** 按本地名取全名工具定义 / look up a full-named tool definition by local name */
export function toolOf(localName: string): ToolDefinition {
  const name = externalName(localName)
  const found = requireRuntime().tools.find((tool) => tool.name === name)
  if (found === undefined) throw new Error(`[sub2api-admin] tool ${name} is not defined`)
  return found
}

/** 组件体的本页工具登记（跑一次，安全）/ the body's tool registration for this page (runs once, safe) */
export function registerTools(agent: Parameters<PageFC>[1], locals: readonly string[]): void {
  for (const local of locals) agent.ctx.tools.register(toolOf(local))
}

/** 正文直读权威 store 当前状态（同步内存面；一次性渲染内安全）
 * / the body's direct read of the authoritative store (a synchronous in-memory face; safe inside the one-shot render) */
export function readState(): Sub2ApiState {
  return requireRuntime().store.getSnapshot()
}

/** 把无 id 的原始行投影成带 id 行（index 兜底）/ project raw rows into id-carrying rows */
export function rowsOf(raw: readonly Record<string, unknown>[]): Array<Record<string, unknown> & { id: string }> {
  return raw.map((row, index) => ({ ...row, id: String(row.id ?? index) }))
}
