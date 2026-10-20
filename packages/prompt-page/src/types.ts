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

/**
 * 页面定义（瘦身后）：
 * - 静态系统提示词/工具/skills 由 DSH preset 提供（persona.prefix + 工具插件）
 * - 本定义只负责唯一 URL、描述、组件树、生命周期钩子
 */
export interface PageDefinition<S> {
  /** 页面唯一名（preset 约定：page.<name>）/ unique page name (preset convention: page.<name>) */
  readonly name: string
  /** 唯一 URL 模式：/xx/:param（仅路径段，查询串属于实际 URL）/ unique url pattern (path only) */
  readonly url: string
  /** 面向目录/入口的描述 / catalog-facing description */
  readonly description: string
  /** 组件树：params = 路径参数+query，state = 权威 store 状态 / component tree */
  readonly tree: (params: PageParams, state: S) => PromptElement[]
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
