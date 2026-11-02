/** @jsxRuntime automatic @jsxImportSource @veren/prompt-core */
/**
 * 页面共享基建：URL 前缀、双语文案、工具全名、页面消息。
 *
 * 组件体只从这里取词与取工具名，不碰 ctx、不 import 服务类——它要什么，由
 * 装配期穿一根参数下来（见 `runtime.ts`）。
 *
 * The pages' shared infrastructure: the url prefix, the bilingual strings, the
 * full tool names, and the page messages.
 *
 * A component body reads only words and tool names from here — it never
 * touches ctx and never imports a service class; whatever it needs arrives as a
 * parameter from the assembly (see `runtime.ts`).
 *
 * @module @veren/zhihu-ops/pages
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { TOOL_PREFIX } from './app.ts'

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

/** 支持的语言 / supported languages */
export type Lang = 'zh' | 'en'

/** 当前包默认语言（页面树取词）/ the package default language for page trees */
const DEFAULT_LANG: Lang = 'zh'

/** 应用内 URL 前缀 / the app-scoped url prefix */
export const URL_PREFIX = '/apps/zhihu-ops'

/** 工具对外名：`<toolPrefix>__<本地名>` / the external tool name */
export const externalName = (localName: string): string => `${TOOL_PREFIX}__${localName}`

/** 双语文案 / the bilingual strings */
export const STRINGS = {
  snapshot: {
    zh: '正文是打开时刻的首屏快照；采集与报告的真身以工具返回与后续消息为准。',
    en: 'The body is the open-time snapshot; the pulls and the reports are what the tools return and what the later messages deliver.',
  },
  empty: {
    zh: '窗口内没有数据，先跑一次采集。',
    en: 'No data in the window yet — run a pull first.',
  },
  credentials: {
    zh: 'Access Secret 未配置，采集会失败。',
    en: 'No access secret is stored, so a pull will fail.',
  },
} as const

/** 取词函数（一个文案一个具名函数，零泛型魔法）/ one named resolver per string — no generic indirection */
export const tSnapshot = (lang: Lang = DEFAULT_LANG) => STRINGS.snapshot[lang]
export const tEmpty = (lang: Lang = DEFAULT_LANG) => STRINGS.empty[lang]
export const tCredentials = (lang: Lang = DEFAULT_LANG) => STRINGS.credentials[lang]

/** 页面自推消息（source = app/page；宿主装配的 PAGE 块同源）/ push one page message (source = app/page) */
export function followupText(agent: Agent, text: string): void {
  agent.followup(createUserMessage({ content: [{ type: 'text', text }] as ContentBlock[], source: { kind: 'app/page' } }))
}
