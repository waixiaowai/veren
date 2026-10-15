// 共享类型与结构化错误：七个会话维护工具的参数、返回值和带稳定 code 的错误。
// Shared types and structured errors: arguments, results, and stable-code
// errors for the seven session maintenance tools.
import type { SessionId } from '@deepseek-ai/dsh-session'

/** `session_create` 的模型参数。Model-facing arguments of `session_create`. */
export interface SessionCreateArgs {
  /** 新会话的显示标题（可省略，交给自动标题）。The new session's display title (optional; auto-title when omitted). */
  title?: string
  /** 预设 id（省略时用部署默认）。The preset id (deployment default when omitted). */
  presetId?: string
  /** 提供方 id（与 model 成对给出）。The provider id (paired with model). */
  provider?: string
  /** 模型 id（与 provider 成对给出）。The model id (paired with provider). */
  model?: string
  /** 挂靠的工作区 id（与 cwd 二选一）。The workspace to attach (mutually exclusive with cwd). */
  workspaceId?: string
  /** 新会话的工作目录（与 workspaceId 二选一）。The working directory (mutually exclusive with workspaceId). */
  cwd?: string
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

/** 工具层稳定错误码。Stable tool-layer error codes. */
export type SessionToolErrorCode =
  | 'SESSION_TITLE_EMPTY'
  | 'SESSION_CREATE_LOCATION_CONFLICT'
  | 'SESSION_MODEL_SELECTION_INCOMPLETE'

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
