// 共享类型：派发参数、规范返回值、看守结论与稳定错误码；并声明本插件产生的
// 消息来源 kind。本文件只放类型与 declaration merging，不放运行时值。
// Shared types: dispatch arguments, the canonical result value, watch outcomes,
// and stable error codes; plus the message-source kind this plugin produces.
// Types and declaration merging only - no runtime values live here.
import type { SessionId } from '@deepseek-ai/dsh-session'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** 会话派发插件的派发提示与完成回报。Prompts and completion reports produced by the session-dispatch plugin. */
    'session-dispatch': { kind: 'session-dispatch' }
  }
}

/** 一次派发看守的结束原因。Why one dispatch watch ended. */
export type WatchOutcome = 'settled' | 'target-gone'

/** 一次派发被拒绝时的稳定错误码（misconfiguration fails loud）。 */
/** Stable codes for one rejected dispatch (misconfiguration fails loud). */
export type SessionDispatchErrorCode =
  | 'SESSION_DISPATCH_NO_CALLER'
  | 'SESSION_DISPATCH_PROMPT_EMPTY'
  | 'SESSION_DISPATCH_TARGET_MISSING'
  | 'SESSION_DISPATCH_TARGET_CONFLICT'
  | 'SESSION_DISPATCH_TARGET_UNRESOLVED'
  | 'SESSION_DISPATCH_CREATE_FAILED'
  | 'SESSION_DISPATCH_CAPACITY_REACHED'

/**
 * `session_dispatch` 的规范返回值：已接受的派发收据，不含任何等待结果。
 * 必须是 type 别名而不是 interface：JsonValue 的 object 分支要求隐式 index
 * signature，interface 不参与隐式索引兼容。id 在这里就是跨模型边界的字符串。
 * The canonical `session_dispatch` result: the accepted-dispatch receipt, which
 * carries no waiting outcome. Must be a type alias, not an interface: JsonValue's
 * object branch requires an implicit index signature, which interfaces do not
 * participate in. Its ids are plain strings because they cross the model boundary.
 */
export type SessionDispatchResult = {
  /** 接收提示的目标会话。The session that received the prompt. */
  sessionId: string
  /** 已入队的用户消息身份。Identity of the enqueued user message. */
  messageId: string
  /** 看守句柄；纯派发（report=false）时为 null。The watch handle, or null for a fire-and-forget dispatch. */
  watchId: string | null
  /** 是否会回报完成。Whether a completion report will be sent back. */
  reporting: boolean
}

/** `session_dispatch` 的已校验参数（由 parameters schema 推断后落在执行侧）。 */
/** The validated `session_dispatch` arguments as the executor sees them. */
export interface DispatchArgs {
  /** 目标会话 id，与 newSession 二选一。The target session id, exclusive with newSession. */
  sessionId?: string
  /** 新建会话的参数，与 sessionId 二选一。New-session parameters, exclusive with sessionId. */
  newSession?: NewSessionArgs
  /** 交付给目标会话的提示文本。The prompt delivered to the target session. */
  prompt: string
  /** 是否回报完成，默认 true。Whether to report completion; defaults to true. */
  report?: boolean
}

/** 新建目标会话的参数。Parameters for creating the target session. */
export interface NewSessionArgs {
  /** 新会话拥有的工作目录。The directory the new session owns. */
  cwd?: string
  /** 新会话运行的 Agent 预设。The Agent preset the new session runs. */
  agentPreset?: string
}

/** 渲染一条回报正文的输入。Inputs for rendering one report body. */
export interface ReportContext {
  /** 目标会话 id。The target session id. */
  readonly targetSessionId: SessionId
  /** 看守句柄。The watch handle. */
  readonly watchId: string
  /** 看守的结束原因。Why the watch ended. */
  readonly outcome: WatchOutcome
  /** 从挂起看守到结束的墙钟毫秒数。Wall-clock milliseconds from arming to the outcome. */
  readonly waitedMs: number
}
