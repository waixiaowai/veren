/**
 * 消息源 kind：页面会话日志里 app-host 追加的各类块的 source kind 白名单。
 * Message source kinds: the whitelist of source kinds for the blocks app-host
 * appends to a page session's log. The MessageSourceMap expansion lives at the
 * bottom of this file (declaration merging).
 * @module @veren/app-host/message-source
 */

/** 消息源 kind 常量（MessageSourceMap 的扩充点见文件尾 declaration merging） */
export const PAGE_MESSAGE_SOURCE = 'app/page' as const
export const TASK_MESSAGE_SOURCE = 'app/task' as const
export const NOTICE_MESSAGE_SOURCE = 'task-center/notice' as const
export const PAGE_SEND_MESSAGE_SOURCE = 'page/send' as const

/** 消息源 → MessageSourceMap kind 的白名单（declaration merging 见文件尾） */
type PageSourceKind = typeof PAGE_MESSAGE_SOURCE | typeof TASK_MESSAGE_SOURCE | typeof NOTICE_MESSAGE_SOURCE | typeof PAGE_SEND_MESSAGE_SOURCE

/**
 * 把端口面的 plain string source 收窄成白名单 kind：未列出的 source 一律归为
 * 页面 PAGE 块（app/page）——端口调用方传的字符串只是日志可读性标签，落盘
 * kind 必须是声明过的闭集成员。
 * Narrow a plain port source string into a whitelisted kind: anything unlisted
 * becomes the page PAGE block (app/page) — the caller's string is only a log
 * readability label, the persisted kind must be a member of the declared
 * closed set.
 */
export function sourceKind(source: string): PageSourceKind {
  switch (source) {
    case TASK_MESSAGE_SOURCE: return TASK_MESSAGE_SOURCE
    case NOTICE_MESSAGE_SOURCE: return NOTICE_MESSAGE_SOURCE
    case PAGE_SEND_MESSAGE_SOURCE: return PAGE_SEND_MESSAGE_SOURCE
    default: return PAGE_MESSAGE_SOURCE
  }
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** A page-session PAGE block (or TASK / task-center notice) appended by app-host. @persistenceSource user */
    'app/page': { kind: 'app/page' }
    /** A TASK block appended after a task take. @persistenceSource user */
    'app/task': { kind: 'app/task' }
    /** A task-center inbox notice pumped into a page session. @persistenceSource user */
    'task-center/notice': { kind: 'task-center/notice' }
    /** A page_send delivery message (wake or wake=false log-only). @persistenceSource user */
    'page/send': { kind: 'page/send' }
    /** A PAGE-RECEIPT: the target page session's final answer landing back in the sender's log (wake:false). @persistenceSource user */
    'page/receipt': { kind: 'page/receipt' }
  }
}
