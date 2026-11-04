/** @jsxRuntime automatic @jsxImportSource @veren/prompt-core */
/**
 * 页面共享基建：URL 前缀、页面消息、工具全名折法。
 * The pages' shared infrastructure: the url prefix, the page messages, and
 * the full tool-name folding.
 *
 * 组件体只从这里取词与取工具名，不碰 ctx、不 import 服务类。
 * A component body reads only words and tool names from here — it never
 * touches ctx and never imports a service class.
 *
 * @module @veren/crawler/pages
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'

// 类型合并扩展：复用宿主的 app/page 消息源；形状必须与 app-host 的声明逐字一致。
// Type-merge extension: reuse the host's app/page message source; the shape
// must match app-host's declaration verbatim.
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** A page session's PAGE block (app-host) and the page body's own followups. @persistenceSource user */
    'app/page': { kind: 'app/page' }
  }
}

/** 应用内 URL 前缀 / the app-scoped url prefix */
export const URL_PREFIX = '/apps/crawler'

/** 工具对外全名（唯一折法住在本插件 tools.ts 的端口约定）/ the external tool name (the one folding per the tools port) */
export const externalName = (localName: string): string => `crawler__${localName}`

/** 页面自推消息（source = app/page；宿主装配的 PAGE 块同源）/ push one page message (source = app/page) */
export function followupText(agent: Agent, text: string): void {
  agent.followup(createUserMessage({ content: [{ type: 'text', text }] as ContentBlock[], source: { kind: 'app/page' } }))
}
