/**
 * The mail domain's failure vocabulary: stable codes, their retryability, and
 * the one error class every module throws.
 *
 * The design's error chapter defines the codes as `NOVU_*`. This plugin is a
 * DSH host extension rather than the Novu service itself, so the codes keep
 * their meaning but carry a `MAIL_` prefix — the same names, one namespace.
 * Retryability is part of the code, not a per-call judgement: a caller reads
 * `retryable` and knows whether to try again.
 *
 * 邮件领域的失败词汇：稳定错误码、可重试性，以及每个模块抛出的唯一错误类。
 *
 * 设计文档的错误章把错误码写作 `NOVU_*`。本插件是 DSH 宿主扩展而非 Novu 服务本身，
 * 因此错误码保留原义但改用 `MAIL_` 前缀——同样的名字，一个命名空间。可重试性是错误码
 * 的一部分而非逐次判断：调用方读 `retryable` 即知能否重试。
 *
 * @module @veren/mail/errors
 */

/**
 * Every stable error code this plugin raises. The set is closed: a new
 * failure mode gets a new code rather than reusing a close one.
 *
 * 本插件抛出的全部稳定错误码。该集合是封闭的：新的失败形态要新增错误码，而不是复用相近的。
 */
export type MailErrorCode =
  | 'MAIL_AUTH_FORBIDDEN'
  | 'MAIL_RATE_LIMITED'
  | 'MAIL_TRIGGER_WORKFLOW_NOT_FOUND'
  | 'MAIL_TRIGGER_WORKFLOW_INACTIVE'
  | 'MAIL_TRIGGER_PAYLOAD_INVALID'
  | 'MAIL_TRIGGER_RECIPIENT_INVALID'
  | 'MAIL_TRIGGER_TRANSACTION_CONFLICT'
  | 'MAIL_TRIGGER_CONTEXT_UNRESOLVED'
  | 'MAIL_TRIGGER_BRIDGE_UNREACHABLE'
  | 'MAIL_TRIGGER_NOT_ACCEPTING'
  | 'MAIL_WORKFLOW_INVALID_STEP'
  | 'MAIL_WORKFLOW_VERSION_CONFLICT'
  | 'MAIL_WORKFLOW_IN_USE'
  | 'MAIL_DISPATCH_JOB_NOT_CLAIMABLE'
  | 'MAIL_DISPATCH_CHAIN_BROKEN'
  | 'MAIL_DISPATCH_DIGEST_WINDOW_INVALID'
  | 'MAIL_DELIVER_INTEGRATION_MISSING'
  | 'MAIL_DELIVER_RECIPIENT_CHANNEL_MISSING'
  | 'MAIL_DELIVER_PROVIDER_REJECTED'
  | 'MAIL_DELIVER_PROVIDER_TIMEOUT'
  | 'MAIL_DELIVER_TEMPLATE_RENDER_FAILED'
  | 'MAIL_DELIVER_CONTENT_BLOCKED'
  | 'MAIL_INTEGRATION_NOT_CONFIGURED'
  | 'MAIL_INTEGRATION_CREDENTIAL_INVALID'
  | 'MAIL_CONVERSATION_NOT_FOUND'
  | 'MAIL_CONVERSATION_CLOSED'
  | 'MAIL_CONVERSATION_EVENT_DUPLICATE'
  | 'MAIL_AGENT_NOT_FOUND'
  | 'MAIL_SUBSCRIBER_NOT_FOUND'
  | 'MAIL_SUBSCRIBER_CONFLICT'
  | 'MAIL_TOPIC_NOT_FOUND'
  | 'MAIL_TOPIC_KEY_CONFLICT'
  | 'MAIL_SUBSCRIPTION_NOT_FOUND'
  | 'MAIL_PREFERENCE_READ_ONLY'
  | 'MAIL_CONTEXT_NOT_FOUND'
  | 'MAIL_INTERNAL'

/**
 * Whether a code may be retried by the caller. Retryable codes describe a
 * transient condition; the rest describe input, credentials, or content that
 * is wrong, and retrying only repeats the failure.
 *
 * 某错误码是否可由调用方重试。可重试的码描述瞬时状态；其余描述输入、凭据或内容本身有问题，
 * 重试只会重复失败。
 */
const RETRYABLE: ReadonlySet<MailErrorCode> = new Set<MailErrorCode>([
  'MAIL_RATE_LIMITED',
  'MAIL_TRIGGER_BRIDGE_UNREACHABLE',
  'MAIL_TRIGGER_NOT_ACCEPTING',
  'MAIL_DISPATCH_CHAIN_BROKEN',
  'MAIL_DELIVER_PROVIDER_TIMEOUT',
  'MAIL_INTERNAL',
])

/** Whether the given code may be retried. / 给定错误码是否可重试。 */
export function isRetryable(code: MailErrorCode): boolean {
  return RETRYABLE.has(code)
}

/**
 * One structured failure. The code is the stable contract; `details` carries
 * machine-readable field conclusions without leaking payload values.
 *
 * 一个结构化失败。错误码是稳定契约；`details` 携带机器可读的字段结论，且不泄漏载荷内容。
 */
export class MailError extends Error {
  /** The stable error code. / 稳定错误码。 */
  readonly code: MailErrorCode
  /** Whether the caller may retry. / 调用方是否可重试。 */
  readonly retryable: boolean
  /** Machine-readable field conclusions. / 机器可读的字段结论。 */
  readonly details: Readonly<Record<string, unknown>>

  /**
   * @param code - the stable error code / 稳定错误码
   * @param message - a developer-facing English sentence / 面向开发者的英文说明
   * @param details - machine-readable field conclusions / 机器可读的字段结论
   */
  constructor(code: MailErrorCode, message: string, details: Record<string, unknown> = {}) {
    super(message)
    this.name = 'MailError'
    this.code = code
    this.retryable = isRetryable(code)
    this.details = details
  }
}

/**
 * Build a structured failure.
 * @param code - the stable error code / 稳定错误码
 * @param message - a developer-facing English sentence / 面向开发者的英文说明
 * @param details - machine-readable field conclusions / 机器可读的字段结论
 * @returns the failure to throw / 待抛出的失败
 */
export function mailError(code: MailErrorCode, message: string, details?: Record<string, unknown>): MailError {
  return new MailError(code, message, details ?? {})
}

/**
 * Narrow an unknown thrown value to a `MailError`, wrapping anything else as
 * an internal failure so no raw provider error escapes to a caller.
 *
 * 把未知的抛出值收窄为 `MailError`；其余一律包成内部失败，避免原始提供方错误漏给调用方。
 *
 * @param error - the thrown value / 抛出的值
 * @returns the narrowed failure / 收窄后的失败
 */
export function asMailError(error: unknown): MailError {
  if (error instanceof MailError) return error
  const detail = error instanceof Error ? error.message : String(error)
  return new MailError('MAIL_INTERNAL', `mail: unexpected failure: ${detail}`)
}
