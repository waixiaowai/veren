/**
 * 两页共用的装配常量与小工具：应用内 URL 前缀、工具对外全名化、页面自推消息的
 * source kind（含 dsh-llm 的类型合并扩充）与首屏文本送达路径。不渲染、不读服务。
 * Assembly constants and small helpers shared by the two pages: the app-scoped
 * url prefix, tool full-naming, the page-pushed message's source kind (with the
 * dsh-llm type-merge extension), and the first-screen text delivery path. No
 * rendering, no service reads.
 * @module @veren/person-agent-app
 */
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'

/** 应用内 URL 前缀 / the app-scoped url prefix */
export const URL_PREFIX = '/apps/person-agent'

/** 工具对外名：`person_agent__<本地名>`（§3.4.3）/ the external tool name */
export const externalName = (localName: string): string => `person_agent__${localName}`

/** 页面自推消息的 source kind（宿主装配的 PAGE 块同源；wire 值协议常量）
 * / the source kind of a page-pushed message (same source as the host assembly's PAGE block; a wire-value protocol constant) */
export const PAGE_SOURCE = 'app/page' as const

// 类型合并扩充：复用宿主的 app/page 消息源。形状必须与 app-host 的声明逐字
// 一致——TS 接口合并规则下两处同键成员类型不同会直接报错，漂移无处藏身。
// Type-merge extension: reuse the host's app/page message source. The shape
// must match app-host's declaration verbatim — under TS interface merging,
// same-key members with different types are a hard error, so the two cannot
// drift apart.
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** A page session's PAGE block (app-host) and the page body's own followups. @persistenceSource user */
    'app/page': { kind: 'app/page' }
  }
}

/** 把一条首屏文本作为新消息推进上下文（页面自己的送达路径）/ push one first-screen text into the context as a new message (the page's own delivery path) */
export function followupText(agent: Agent, text: string): void {
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: PAGE_SOURCE } }))
}
