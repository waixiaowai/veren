/**
 * `select_model` 的纯函数层：参数校验归一与目标会话解析。此层不触宿主，
 * 可以独立单测。
 * The pure-function layer of `select_model`: argument validation and target
 * resolution. It never touches the host, so it unit-tests in isolation.
 *
 * @module select-request
 */
import { SelectModelToolError } from './types.js'
import type { SelectModelArgs } from './types.js'

/** 面向模型的工具名。The model-facing tool name. */
export const TOOL_NAME = 'select_model'

/** 本工具接受的参数键集合。The argument keys this tool accepts. */
const ARGUMENT_KEYS: ReadonlySet<string> = new Set(['sessionId', 'provider', 'model', 'reasoningEffort'])

/**
 * 校验并归一模型给出的参数。schema 只做形状检查，这里的自检保证错误信息
 * 带稳定 code，且拒绝未知键（与 session-fork-enhanced 的口径一致）。
 * Validate and normalize model arguments. The schema checks shapes; this
 * second gate gives every failure a stable code and rejects unknown keys
 * (matching the session-fork-enhanced conventions).
 * @param args - 模型给出的原始参数。The raw model arguments.
 * @returns 归一化后的参数。The normalized arguments.
 * @throws {SelectModelToolError} 每个非法输入都抛出带 code 的错误。
 *   Throws a coded error for every invalid input.
 */
export function normalizeSelectArguments(args: unknown): SelectModelArgs {
  const record = assertArgumentObject(args)
  assertKnownKeys(record)
  // 成对必填：provider 与 model 缺一不可（两者都缺也算"不成对"），给出
  // 明确的补参提示；通过存在性检查后再做非空字符串校验。
  // Paired required: both provider and model are mandatory (missing both
  // counts as unpaired too); non-empty-string validation runs after the
  // presence check.
  if (typeof record.provider !== 'string' || typeof record.model !== 'string') {
    throw new SelectModelToolError(
      'SELECT_MODEL_PROVIDER_MODEL_REQUIRED',
      `${TOOL_NAME}: provider and model are required together`,
      { provider: record.provider, model: record.model },
    )
  }
  const provider = requireNonEmptyString(record.provider, 'provider')
  const model = requireNonEmptyString(record.model, 'model')
  return {
    provider,
    model,
    ...(record.sessionId === undefined ? {} : { sessionId: requireNonEmptyString(record.sessionId, 'sessionId') }),
    ...(record.reasoningEffort === undefined
      ? {}
      : { reasoningEffort: requireNonEmptyString(record.reasoningEffort, 'reasoningEffort') }),
  }
}

/** 断言参数是普通对象并收窄；其余形状一律抛带 code 的错误。Assert the arguments are a plain object and narrow; any other shape throws a coded error. */
function assertArgumentObject(args: unknown): Record<string, unknown> {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) {
    throw new SelectModelToolError(
      'SELECT_MODEL_INVALID_ARGUMENT',
      `${TOOL_NAME}: arguments must be an object`,
      { args },
    )
  }
  return args as Record<string, unknown>
}

/** 拒绝未知参数键：错误信息带稳定 code，并列出全部合法键。Reject unknown argument keys: the error carries a stable code and lists every accepted key. */
function assertKnownKeys(record: Record<string, unknown>): void {
  for (const key of Object.keys(record)) {
    if (ARGUMENT_KEYS.has(key)) continue
    throw new SelectModelToolError(
      'SELECT_MODEL_INVALID_ARGUMENT',
      `${TOOL_NAME}: unknown argument ${JSON.stringify(key)}; accepted keys are ${[...ARGUMENT_KEYS].join(', ')}`,
      { key },
    )
  }
}

/**
 * 读取一个非空字符串参数，非法时抛带 code 的错误。
 * Read one non-empty-string argument, throwing a coded error when invalid.
 * @param value - 原始值。The raw value.
 * @param key - 参数名，用于诊断。The argument name, for diagnostics.
 */
function requireNonEmptyString(value: unknown, key: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new SelectModelToolError(
      'SELECT_MODEL_INVALID_ARGUMENT',
      `${TOOL_NAME}: ${key} must be a non-empty string`,
      { key, value },
    )
  }
  return value
}

/**
 * 解析目标会话：显式 sessionId 优先；缺省时继承调用方会话——默认只切
 * 自己的模型。两者都拿不到时显性失败，绝不猜一个会话。
 * Resolve the target session: an explicit sessionId wins; otherwise inherit
 * the calling session — by default a tool call switches only its own model.
 * Failing loud when neither exists; never guessing a session.
 * @param requested - 模型显式给出的 sessionId。The explicit sessionId, when supplied.
 * @param callerSessionId - 调用方会话 id；未知时为 undefined。The calling session id, or undefined.
 * @returns 目标会话 id。The target session id.
 */
export function resolveTargetSessionId(requested: string | undefined, callerSessionId: string | undefined): string {
  if (requested !== undefined) return requested
  if (callerSessionId !== undefined) return callerSessionId
  throw new SelectModelToolError(
    'SELECT_MODEL_NO_CALLER',
    `${TOOL_NAME}: no calling session is associated with this tool call; pass sessionId explicitly`,
    {},
  )
}
