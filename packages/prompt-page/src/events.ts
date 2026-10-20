/**
 * 页面事件总线 + 处理器 IO / page event bus + handler IO
 *
 * 用户设计：按钮点击触发事件，监听事件可以改上下文（append）或打开另一个页面（navigate）。
 * 事件源是领域 store（按钮语义），监听器声明在 definePage.events。
 */
import type { PageEventHandler } from './types.ts'

/** 事件处理器的 IO 面：改上下文 / 导航 */
export interface PageIO {
  /** 改上下文：追加一条消息（host 结构化 append）/ append one note to the context */
  append(text: string): void
  /** 打开另一个页面（新会话 + 指针）/ open another page session */
  navigate(url: string): void
}

/** 事件总线：同步分发；处理器异常不中断其它处理器 */
export class PageEventBus {
  private readonly handlers = new Map<string, Set<PageEventHandler>>()

  /** 订阅；返回取消订阅 / subscribe; returns the unsubscribe disposer */
  on(event: string, handler: PageEventHandler): () => void {
    let set = this.handlers.get(event)
    if (set === undefined) {
      set = new Set()
      this.handlers.set(event, set)
    }
    set.add(handler)
    return () => { set?.delete(handler) }
  }

  /** 分发：按订阅顺序同步调用 / dispatch synchronously in subscription order */
  emit(event: string, payload: unknown, io: PageIO): void {
    const set = this.handlers.get(event)
    if (set === undefined) return
    for (const handler of set) {
      try {
        handler(payload, io)
      } catch (error) {
        // 单个处理器失败不断链：记录后继续（调用方可见 console）
        console.error(`[PageEventBus] handler for "${event}" failed`, error)
      }
    }
  }
}
