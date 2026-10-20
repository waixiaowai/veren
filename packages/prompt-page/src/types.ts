/**
 * 类型定义（只放类型）/ Type definitions (types only)
 *
 * 页面运行时的形状：一页 = 一个会话；页面经应用作用域注册表以唯一 URL 注册。
 * 页面不再绑定预设；应用/实例/工具契约见 contract.ts 与两个插件的 types.ts。
 */
import type { PromptElement } from '@veren/prompt-core'
import type { MessageHost } from '@veren/prompt-host-messages'

/** URL 参数：路径参数 + query 合并（path 优先）/ path params + query (path wins) */
export type PageParams = Record<string, string>

/**
 * @deprecated 页面不再绑定预设（页面 = 用户自选会话上的动态层）。
 * 本类型仅为 page-sync-bench 等迁移期消费方的 `buildPagePreset` 保留；
 * 新代码禁止使用（应用说明走 `ApplicationDefinition.instructions`，
 * 页面说明走 `PageDefinition.instructions`，都不是系统提示词）。
 * Legacy preset spec kept only for migration-era `buildPagePreset` callers.
 */
export interface PagePresetSpec {
  /** 系统提示词（→ persona.prefix）/ system prompt (→ persona.prefix) */
  readonly systemPrompt: string
  /** 客户端选择器排序 / roster order */
  readonly order?: number
}

/**
 * 事件处理器的 IO 面：改上下文（append）/ 导航（navigate）。
 * 事件系统本身用宿主自带的 cordis 事件（ctx.emit / ctx.on，declaration merging），
 * 本包不另造总线；这里只定义页面声明处理器时拿到的 IO 形状。
 */
export interface PageIO {
  /** 改上下文：追加一条消息（host 结构化 append）/ append one note to the context */
  append(text: string): void
  /** 打开另一个页面（新会话 + 指针）/ open another page session */
  navigate(url: string): void
}

/** 事件处理器形状 / event handler shape */
export type PageEventHandler = (payload: unknown, io: PageIO) => void

/** 页面的事件监听声明形状 / event-listener map shape（键名 = cordis 事件名）*/
export type PageEventMap = Readonly<Record<string, PageEventHandler>>

/**
 * 页面定义（应用作用域）：
 * - **preset 字段已删除**：页面不再绑定预设，静态面归用户自选的会话配置（§2.2）
 * - 新增 tools/instructions/instanceTitle/pageRevision（§3.1）；
 *   `tools` 写应用工具目录里的本地名，最终名在挂载时拼前缀（§3.4.3）
 * - 应用作用域注册时 URL 必须是 `/apps/<appId>/...` 形态（见 contract.ts 的校验器）
 */
export interface PageDefinition<S> {
  /** 页面唯一名（应用内唯一；全局页面键为 `appId/name`）/ unique page name */
  readonly name: string
  /** 唯一 URL 模式：/apps/<appId>/xx/:param（仅路径段，查询串属于实际 URL）/ unique url pattern */
  readonly url: string
  /** 面向目录/入口的描述 / catalog-facing description */
  readonly description: string
  /** 本页挂载的工具（应用工具目录的本地名）/ local tool names from the app tool catalog */
  readonly tools?: readonly string[]
  /** 本页给模型的说明；随 PAGE 块附上，不是系统提示词 / page note, not a system prompt */
  readonly instructions?: string
  /** 实例标题函数；缺省用 description 兜底（§3.6.1）/ instance title, falls back to description */
  readonly instanceTitle?: (params: PageParams) => string
  /** 页面契约版本：URL/参数/工具名/说明不兼容变化时 +1；缺省按 1（§7.3）/ page contract revision */
  readonly pageRevision?: number
  /** 事件监听：键名 = cordis 事件名（ctx.emit 触发）/ listeners keyed by cordis event name */
  readonly events?: PageEventMap
  /** 组件树：params = 路径参数+query，state = 权威 store 状态 / component tree */
  readonly tree: (params: PageParams, state: S) => import('@veren/prompt-core').ElementInput
  /** 生命周期：挂载后调用（预留：首帧上下文装载）/ called after mount */
  readonly onLoad?: (params: PageParams) => void
  /** 生命周期：由消费方征询以决定是否归档会话 / consulted to decide session archive */
  readonly onComplete?: (params: PageParams) => boolean
}

/** 一个已挂载的页面会话 / one mounted page-session */
export interface PageSession<S> {
  readonly page: PageDefinition<S>
  readonly params: PageParams
  readonly host: MessageHost
  /** 打开指针注入文本（新会话第一条 user 消息）/ pointer message injected at open */
  readonly pointerMessage: string
  get version(): number
  /** 渲染 cursor 之后的同步文本 / sync text after the given cursor */
  syncText(cursor?: number): string
  /** 解除 store 订阅（会话结束）/ detach from the store */
  unsubscribe(): void
}
