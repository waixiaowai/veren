// 共享类型与结构化错误：八个会话维护工具的参数、返回值和带稳定 code 的错误。
// Shared types and structured errors: arguments, results, and stable-code
// errors for the eight session maintenance tools.
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { Scoped } from '@deepseek-ai/dsh-scope'

/**
 * 新会话的位置：显式工作区或普通目录，二选一。
 * Where a new session lives: an explicit workspace or a plain directory, never both.
 */
export interface SessionLocationArgs {
  /** 挂靠的工作区 id（与 cwd 二选一）。The workspace to attach (mutually exclusive with cwd). */
  workspaceId?: string
  /** 新会话的工作目录（与 workspaceId 二选一）。The working directory (mutually exclusive with workspaceId). */
  cwd?: string
}

/** `session_create` 的模型参数。Model-facing arguments of `session_create`. */
export interface SessionCreateArgs extends SessionLocationArgs {
  /** 新会话的显示标题（可省略，交给自动标题）。The new session's display title (optional; auto-title when omitted). */
  title?: string
  /** 预设 id（省略时用部署默认）。The preset id (deployment default when omitted). */
  presetId?: string
  /** 提供方 id（与 model 成对给出）。The provider id (paired with model). */
  provider?: string
  /** 模型 id（与 provider 成对给出）。The model id (paired with provider). */
  model?: string
}

/**
 * `session_create` 的返回值。必须是 type 别名而不是 interface：JsonValue 的
 * object 分支要求隐式 index signature，interface 不参与隐式索引兼容。
 * The `session_create` result value. Must be a type alias, not an interface:
 * JsonValue's object branch requires an implicit index signature, which
 * interfaces do not participate in.
 */
export type SessionCreateResult = {
  sessionId: SessionId
  agentPreset?: string
  selected?: { readonly provider: string, readonly model: string }
  title?: string
}

/** `session_rename` / `session_fork` 共用的最小参数形状。 */
/** The minimal argument shape shared by `session_rename` / `session_fork`. */
export interface SessionTargetArgs {
  /** 目标会话 id。The target session id. */
  sessionId: SessionId
}

/** `session_rename` 的完整参数。Full arguments of `session_rename`. */
export interface SessionRenameArgs extends SessionTargetArgs {
  /** 新标题（去空白后非空）。The new title (non-empty after trim). */
  title: string
}

/** `session_fork` 的完整参数。Full arguments of `session_fork`. */
export interface SessionForkArgs extends SessionTargetArgs {
  /** 精确包含式切点 seq；省略时取最近一个已完成轮次前缀。Exact inclusive cut seq; latest completed-turn prefix when omitted. */
  atSeq?: number
}

/** `session_archive` 的完整参数。Full arguments of `session_archive`. */
export interface SessionArchiveArgs extends SessionTargetArgs {
  /** 有运行中工作时停止而不是拒绝（默认 false）。Stop running work instead of refusing (default false). */
  stopActivity?: boolean
}

/** `session_dispatch` 的完整参数。Full arguments of `session_dispatch`. */
export interface SessionDispatchArgs {
  /** 已有目标会话 id（与 newSession 二选一）；模型给出的就是字符串。The existing target session id (exclusive with newSession); the model supplies a plain string. */
  sessionId?: string
  /** 新建会话的参数（与 sessionId 二选一）。New-session parameters (exclusive with sessionId). */
  newSession?: NewSessionArgs
  /** 交付给目标会话的提示文本（原样作为一个 text 块）。The prompt, sent verbatim as one text block. */
  prompt: string
  /** 是否回报结算，默认 true；false 为纯派发。Whether to report settlement (default true; false is fire-and-forget). */
  report?: boolean
}

/** 新建目标会话的参数。Parameters for creating the target session. */
export interface NewSessionArgs extends SessionLocationArgs {
  /** 新会话运行的 Agent 预设。The Agent preset the new session runs. */
  agentPreset?: string
}

/**
 * `session_dispatch` 的返回值：已接受的派发收据，不含任何等待结果。
 * type 别名（理由同 SessionCreateResult）。
 * The `session_dispatch` result: the accepted-dispatch receipt, which carries no
 * waiting outcome. Type alias (same reason as SessionCreateResult).
 */
export type SessionDispatchResult = {
  /** id 在这里就是跨模型边界的字符串，因此不带 brand。Plain ids: they cross the model boundary. */
  sessionId: string
  /** 已入队的用户消息身份。Identity of the enqueued user message. */
  messageId: string
  /** 看守句柄；纯派发（report=false）时为 null。The watch handle, or null for a fire-and-forget dispatch. */
  watchId: string | null
  /** 是否会回报结算。Whether a settlement notice will be sent back. */
  reporting: boolean
}

/**
 * 一次派发结算的结束原因。词汇与官方 `SubagentStopReason` 一致，便于模型在两种派活
 * 之间读到同一套说法；`target-gone` 是本插件特有的（被看护的 Agent 离开注册表）。
 * 一个非 `completed` 的原因意味着收尾输出可能是残缺的。
 * Why one dispatch settlement ended. The vocabulary matches the official
 * `SubagentStopReason` so the model reads the same words across both delegation
 * routes; `target-gone` is specific to this plugin (the watched Agent left the
 * registry). A non-`completed` reason means the closing output may be partial.
 */
export type SessionDispatchOutcome =
  | 'completed'
  | 'aborted'
  | 'max-tokens'
  | 'refusal'
  | 'error'
  | 'target-gone'

/**
 * 一次派发的标识信息，随开始事件发出。字段与官方 `SubagentRunInfo` 对齐
 * （`runId` 在这里是看守句柄），使宿主与界面用同一套词汇观察两种派活。
 * Identity of one dispatch, carried by the start event. The fields mirror the
 * official `SubagentRunInfo` (its `runId` is this plugin's watch handle), so a
 * host or UI observes both delegation routes with the same vocabulary.
 */
export interface SessionDispatchRunInfo {
  /** 看守句柄，也是收据里的 `watchId`；纯派发（report=false）时为 null。The watch handle, also the receipt's `watchId`; null for a fire-and-forget dispatch. */
  readonly watchId: string | null
  /** 接收提示的会话。The session that received the prompt. */
  readonly targetSessionId: SessionId
  /** 发起派发的会话。The session that dispatched. */
  readonly callerSessionId: SessionId
}

/**
 * 一次派发的终局信息，随结束事件发出；与开始事件按 `watchId` 配对。
 * 字段与官方 `SubagentRunEndInfo` 对齐。
 * Terminal detail for one dispatch, carried by the end event and paired with its
 * start event by `watchId`. The fields mirror the official `SubagentRunEndInfo`.
 */
export interface SessionDispatchRunEndInfo extends SessionDispatchRunInfo {
  /** 看守句柄；结束事件只在有看守时发出，因此这里必定存在。The watch handle; an end event exists only when a watch did. */
  readonly watchId: string
  /** 终局原因。The terminal outcome. */
  readonly outcome: SessionDispatchOutcome
  /** 目标的收尾输出；没产出时缺省。The target's closing output; absent when it produced none. */
  readonly lastAssistantMessage?: readonly ContentBlock[]
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * 一次派发被接受。与 `session-dispatch/end` 按 `watchId` 配对，供宿主与界面观察
     * "已派出、进行中"，而不必读会话日志。
     * One dispatch was accepted. Paired with `session-dispatch/end` by `watchId`,
     * so a host or UI can observe "dispatched, in flight" without reading Session logs.
     * @param payload.watchId - 看守句柄。The watch handle.
     * @param payload.targetSessionId - 接收提示的会话。The session that received the prompt.
     * @param payload.callerSessionId - 发起派发的会话。The session that dispatched.
     * @param payload.agent - 发起派发的 Agent（作用域载体与主体）。The dispatching Agent.
     * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): listeners on the caller receive only its own dispatches.
     * @mode emit
     */
    'session-dispatch/start'(this: Scoped<Agent>, payload: SessionDispatchRunInfo & { agent: Agent }): void
    /**
     * 一次派发结算且通知已投递。终局信息与开始事件配对。
     * One dispatch settled and its notice was delivered. The terminal detail pairs
     * with its start event.
     * @param payload.watchId - 看守句柄。The watch handle.
     * @param payload.targetSessionId - 接收提示的会话。The session that received the prompt.
     * @param payload.callerSessionId - 发起派发的会话。The session that dispatched.
     * @param payload.outcome - 终局原因。The terminal outcome.
     * @param payload.lastAssistantMessage - 目标的收尾输出，没产出时缺省。The target's closing output.
     * @param payload.agent - 发起派发的 Agent（作用域载体与主体）。The dispatching Agent.
     * Scope-filtered dispatch (`@deepseek-ai/dsh-scope`): listeners on the caller receive only its own dispatches.
     * @mode emit
     */
    'session-dispatch/end'(this: Scoped<Agent>, payload: SessionDispatchRunEndInfo & { agent: Agent }): void
  }
}

/** 工具层稳定错误码。Stable tool-layer error codes. */
export type SessionToolErrorCode =
  | 'SESSION_TITLE_EMPTY'
  | 'SESSION_CREATE_LOCATION_CONFLICT'
  | 'SESSION_MODEL_SELECTION_INCOMPLETE'
  | 'SESSION_DISPATCH_NO_CALLER'
  | 'SESSION_DISPATCH_PROMPT_EMPTY'
  | 'SESSION_DISPATCH_TARGET_MISSING'
  | 'SESSION_DISPATCH_TARGET_CONFLICT'
  | 'SESSION_DISPATCH_TARGET_NOT_FOUND'
  | 'SESSION_DISPATCH_CREATE_FAILED'
  | 'SESSION_DISPATCH_CAPACITY_REACHED'
  | 'SESSION_DISPATCH_WATCH_BUSY'

/** 带稳定 code 与机器可读字段的结构化错误（misconfiguration fails loud）。 */
/** A structured error with a stable code and machine-readable fields (misconfiguration fails loud). */
export class SessionToolError extends Error {
  readonly code: SessionToolErrorCode
  readonly fields: Record<string, unknown>

  constructor(code: SessionToolErrorCode, message: string, fields: Record<string, unknown>) {
    super(message)
    this.name = 'SessionToolError'
    this.code = code
    this.fields = fields
  }
}

/**
 * 校验标题：去空白后必须非空。Title validation: non-empty after trimming.
 * @param title - 原始输入。The raw input.
 * @returns 去空白后的标题。The trimmed title.
 */
export function requireTitle(title: string): string {
  const trimmed = title.trim()
  if (trimmed === '') {
    throw new SessionToolError('SESSION_TITLE_EMPTY', 'title must be a non-empty string', { title })
  }
  return trimmed
}

/**
 * 校验模型选择：provider 与 model 必须成对出现或同时省略。
 * Validate a model selection: provider and model must come paired or both omitted.
 * @param args - 创建参数。The create arguments.
 * @returns 成对的选择，或 undefined。The paired selection, or undefined.
 */
export function optionalModelSelection(
  args: Pick<SessionCreateArgs, 'provider' | 'model'>,
): { provider: string, model: string } | undefined {
  // 内联判断而非缓存布尔量：让 TS 直接收窄 args 的两个字段。
  // Inline checks instead of cached booleans: TS then narrows the two fields
  // directly.
  if (args.provider !== undefined && args.model !== undefined) {
    return { provider: args.provider, model: args.model }
  }
  if (args.provider === undefined && args.model === undefined) return undefined
  throw new SessionToolError(
    'SESSION_MODEL_SELECTION_INCOMPLETE',
    'provider and model must be given together',
    { provider: args.provider, model: args.model },
  )
}
