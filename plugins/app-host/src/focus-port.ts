/**
 * focus 接缝：宿主侧不碰 DOM，切界面只能由客户端完成——这里只定义接缝与
 * 两个实现（真实发事件 / 测试记日志）。
 * The focus seam: the host side never touches the DOM — only the client can
 * switch the view. This file defines the seam and its two implementations
 * (emit the real event / log in tests).
 * @module @veren/app-host/focus-port
 */
import type { Context } from '@deepseek-ai/cordis'

/** focus 接缝：把界面切到某会话 / the focus seam: bring a session to the GUI front */
export interface FocusPort {
  focus(sessionId: string): Promise<void>
}

/** focus 事件载荷：GUI 侧伴生插件监听后调 uiWorkspace.openSession / focus payload for the GUI companion plugin */
export interface FocusEventPayload {
  readonly sessionId: string
}

/**
 * 真实 focus 实现：发一条宿主 emit 事件，Web 端伴生插件经 Remote 载体收到后
 * 执行真正的界面切换（uiWorkspace.openSession）。宿主侧没有 DOM，切界面只能
 * 由客户端完成——这条事件就是 H 的 focus 通道。
 * The real focus implementation: emit one host event; the Web-side companion
 * plugin receives it through the Remote carrier and performs the actual switch
 * (uiWorkspace.openSession). The host has no DOM — only the client can switch,
 * so this event is the focus channel.
 */
export function eventFocus(ctx: Context): FocusPort {
  return {
    focus: async (sessionId) => { ctx.emit('app-host/focus', { sessionId } satisfies FocusEventPayload) },
  }
}

/** 日志 focus 实现（测试替身用；生产默认走 {@link eventFocus}） */
export function loggingFocus(logger: { info(message: string): void }): FocusPort {
  return {
    focus: async (sessionId) => { logger.info(`app-host: focus session ${sessionId} (GUI focus lands with the toolbar app dropdown)`) },
  }
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * 把某条会话切到 GUI 前台的请求（focus 端口的真实实现发出；Web 伴生插件
     * 经 Remote 载体接收后调 uiWorkspace.openSession）。纯通知，无拦截面。
     * 载荷类型必须与客户端伴生插件（@veren/app-host-ui）的再声明逐字相同——
     * interface merging 要求两次声明同一类型。
     * @mode emit
     * Request to bring one session to the GUI front (emitted by the real focus
     * port; the Web companion plugin calls uiWorkspace.openSession on receipt
     * through the Remote carrier). Pure notification, no interception. The
     * payload type must stay verbatim-identical to the companion plugin's
     * redeclaration (@veren/app-host-ui) — interface merging demands the same
     * type twice.
     */
    'app-host/focus': (payload: { readonly sessionId: string }) => void
  }
}
