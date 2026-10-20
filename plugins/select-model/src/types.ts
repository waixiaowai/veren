/**
 * `select_model` 工具的共享类型：参数、返回值与带稳定 code 的结构化错误。
 * 本文件只放类型（错误类是唯一例外：它需要携带机器可读字段）。
 * Shared types of the `select_model` tool: arguments, results, and the
 * structured error with a stable code. Types only (the error class is the one
 * exception: it must carry machine-readable fields).
 *
 * @module types
 */

/**
 * `select_model` 的模型参数。provider 与 model 成对必填；sessionId 缺省时
 * 表示"当前调用方会话"。
 * The model-facing arguments of `select_model`. provider and model are
 * required as a pair; an omitted sessionId means "the calling session".
 */
export interface SelectModelArgs {
  /** 目标会话 id；省略时取调用方会话。The target session id; the calling session when omitted. */
  readonly sessionId?: string
  /** Provider 路由 id（与 model 成对必填）。The provider route id (required together with model). */
  readonly provider: string
  /** 模型 id（与 provider 成对必填）。The model id (required together with provider). */
  readonly model: string
  /** 该路由的可选推理强度。The optional reasoning effort for that route. */
  readonly reasoningEffort?: string
}

/**
 * `select_model` 的返回值。必须是 type 别名而不是 interface：JsonValue 的
 * object 分支要求隐式 index signature，interface 不参与隐式索引兼容。
 * The `select_model` result value. Must be a type alias, not an interface:
 * JsonValue's object branch requires an implicit index signature, which
 * interfaces do not participate in.
 */
export type SelectModelResult = {
  /** 实际完成切换的会话 id。The session id whose model was actually switched. */
  readonly sessionId: string
  /** 宿主解析后的 provider 路由。The provider route resolved by the host. */
  readonly provider: string
  /** 宿主解析后的模型 id。The model id resolved by the host. */
  readonly model: string
  /** 生效的推理强度；宿主未返回时缺省。The effective reasoning effort; absent when the host returns none. */
  readonly reasoningEffort?: string
}

/** 工具层稳定错误码。Stable tool-layer error codes. */
export type SelectModelErrorCode =
  | 'SELECT_MODEL_INVALID_ARGUMENT'
  | 'SELECT_MODEL_PROVIDER_MODEL_REQUIRED'
  | 'SELECT_MODEL_NO_CALLER'

/**
 * 带稳定 code 与机器可读字段的结构化错误（misconfiguration fails loud）。
 * A structured error with a stable code and machine-readable fields
 * (misconfiguration fails loud).
 */
export class SelectModelToolError extends Error {
  readonly code: SelectModelErrorCode
  readonly fields: Record<string, unknown>

  constructor(code: SelectModelErrorCode, message: string, fields: Record<string, unknown>) {
    super(message)
    this.name = 'SelectModelToolError'
    this.code = code
    this.fields = fields
  }
}
