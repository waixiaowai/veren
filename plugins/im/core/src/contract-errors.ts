/**
 * Structured IM failures: the stable error-code union and the one error class
 * every IM failure is carried by.
 *
 * 结构化 IM 失败：稳定的错误码联合与承载一切 IM 失败的唯一错误类。
 *
 * @module @veren/im/contract-errors
 */

/**
 * Stable error codes, in two segments.
 *
 * `IM_*` covers the channel scope: adapters, authorization, addressing, and
 * delivery. The unprefixed segment aligns the core loop (conversation,
 * coordination, turn) with the design document's global error-code table
 * (design §20.2) so every rejection carries one stable, never-reused code.
 *
 * 稳定错误码，两段式。
 *
 * `IM_*` 覆盖渠道范围：适配器、授权、寻址与投递。无前缀段让核心循环（会话、协调、回合）
 * 与设计文档的全局错误码表（设计 §20.2）对齐——每次拒绝都带一个稳定、不复用的码。
 */
export type ImErrorCode =
  // ---- channel scope: adapters, authorization, addressing, delivery ----
  // ---- 渠道范围：适配器、授权、寻址、投递 ----
  | 'IM_INVALID_REQUEST'
  | 'IM_UNSUPPORTED'
  | 'IM_AUTH_REQUIRED'
  | 'IM_BIND_PENDING'
  | 'IM_BIND_EXPIRED'
  | 'IM_NOT_FOUND'
  | 'IM_AMBIGUOUS'
  | 'IM_NO_ADDRESS'
  | 'IM_SEND_REJECTED'
  | 'IM_RATE_LIMITED'
  | 'IM_DELIVERY_UNCERTAIN'
  | 'IM_INTERNAL'
  // ---- core loop, aligned with design §20.2 ----
  // ---- 核心循环，对齐设计 §20.2 ----
  | 'INVALID_ARGUMENT'
  | 'RESOURCE_NOT_FOUND'
  | 'STATE_CONFLICT'
  | 'REQUEST_ID_CONFLICT'
  | 'CONVERSATION_NOT_FOUND'
  | 'CONVERSATION_ARCHIVED'
  | 'HELD_FRESHNESS'
  | 'HELD_VERBATIM'
  | 'TURN_PROTOCOL_VIOLATION'
  | 'TURN_BUDGET_EXHAUSTED'
  | 'TURN_COMPLETION_REJECTED'
  | 'RATE_LIMITED'
  | 'MODEL_QUOTA_EXHAUSTED'
  | 'DEPENDENCY_UNAVAILABLE'

/** One structured IM failure; callers branch on `code` only. */
/** 一个结构化 IM 失败；调用方只按 `code` 分支。 */
export class ImError extends Error {
  /** Stable machine-readable reason. */
  /** 稳定的机器可读原因。 */
  readonly code: ImErrorCode
  /** Whether an identical retry can succeed; a HELD refusal is never retryable as-is. */
  /** 原样重试能否成功；HELD 拒绝原样重试永远无效。 */
  readonly retryable: boolean
  /** Provider-native code, when the provider has one. */
  /** provider 原生码（若 provider 提供）。 */
  readonly providerCode?: string
  /** JSON-safe machine-readable fields (candidates, held facts, and so on). */
  /** JSON 安全的机器可读字段（候选、被拒新事实等）。 */
  readonly details?: Readonly<Record<string, unknown>>

  /**
   * @param code - stable machine-readable reason.
   * @param message - human-readable account of the failure.
   * @param options - optional cause, retryability, provider-native code, and structured details.
   */
  constructor(
    code: ImErrorCode,
    message: string,
    options: {
      cause?: unknown
      retryable?: boolean
      providerCode?: string
      details?: Record<string, unknown>
    } = {},
  ) {
    super(message, { cause: options.cause })
    this.name = 'ImError'
    this.code = code
    this.retryable = options.retryable ?? RETRYABLE_BY_CODE.get(code) ?? false
    if (options.providerCode !== undefined) this.providerCode = options.providerCode
    if (options.details !== undefined) this.details = options.details
  }
}

/**
 * Default retryability per design §20.3: transient conditions retry as-is,
 * HELD refusals require new content, everything else fails loud without a
 * retry. Codes absent from the table default to non-retryable.
 * 按 §20.3 的默认可重试性：暂时性条件可原样重试，HELD 拒绝须换内容，其余响亮失败
 * 不重试。表中缺失的码默认不可重试。
 */
const RETRYABLE_BY_CODE: ReadonlyMap<ImErrorCode, boolean> = new Map<ImErrorCode, boolean>([
  ['IM_DELIVERY_UNCERTAIN', true],
  ['IM_RATE_LIMITED', true],
  ['DEPENDENCY_UNAVAILABLE', true],
  ['RATE_LIMITED', true],
  ['MODEL_QUOTA_EXHAUSTED', true],
  ['HELD_FRESHNESS', false],
  ['HELD_VERBATIM', false],
])
