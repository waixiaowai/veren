/**
 * 类型定义（只放类型）/ Type definitions (types only)
 *
 * 页面运行时的形状：一页 = 一个会话；页面经 PageRegistry 以唯一 URL 注册。
 * 静态面（系统提示词/工具/skills）归 DSH preset；本包只管动态上下文与生命周期钩子。
 */
import type { PromptElement } from '@veren/prompt-core'
import type { MessageHost } from '@veren/prompt-host-messages'

/** URL 参数：路径参数 + query 合并（path 优先）/ path params + query (path wins) */
export type PageParams = Record<string, string>

/** 页面的动态 preset 声明（系统提示词等静态面）/ dynamic preset declaration (static face) */
export interface PagePresetSpec {
  /** 系统提示词（→ persona.prefix）/ system prompt (→ persona.prefix) */
  readonly systemPrompt: string
  /** 客户端选择器排序 / roster order */
  readonly order?: number
}

/** 事件处理器形状 / event handler shape */
export type PageEventHandler = (payload: unknown, io: import('./events.ts').PageIO) => void

/** 页面的事件监听声明形状 / event-listener map shape */
export type PageEventMap = Readonly<Record<string, PageEventHandler>>

/**
 * 页面定义（瘦身后）：
 * - 静态面经 preset 字段动态声明（DSH preset 注册，参考 person-agent-preset），不用 yml
 * - events 声明页面级事件监听（按钮 → 事件 → 改上下文/导航）
 * - 本定义负责唯一 URL、描述、组件树、生命周期钩子
 */
export interface PageDefinition<S> {
  /** 页面唯一名（preset 约定：page.<name>）/ unique page name (preset convention: page.<name>) */
  readonly name: string
  /** 唯一 URL 模式：/xx/:param（仅路径段，查询串属于实际 URL）/ unique url pattern (path only) */
  readonly url: string
  /** 面向目录/入口的描述 / catalog-facing description */
  readonly description: string
  /** 动态 preset 声明 / dynamic preset declaration */
  readonly preset?: PagePresetSpec
  /** 事件监听：按钮/领域事件 → 改上下文或导航 / event listeners */
  readonly events?: Readonly<Record<string, (payload: unknown, io: import('./events.ts').PageIO) => void>>
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
