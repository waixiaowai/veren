/**
 * 分叉请求的纯函数层：参数校验归一、事件日志边界推断与有效模型选择。
 * Pure-function layer of a fork request: argument validation, event-log
 * boundary inference, and effective model selection.
 *
 * @module fork-request
 */
import type { Context } from '@deepseek-ai/cordis'
// 类型-only：拉取 `model/selection` 事件类型的 declaration merge。
// Type-only: pull the `model/selection` event type declaration merging.
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ForkRequest, ModelSelectionView } from './types.js'

/** 面向模型的工具名；与官方 `session_fork` 刻意区分。
 * Model-facing tool name; deliberately distinct from the shipped `session_fork`. */
export const TOOL_NAME = 'session_fork_with_options'

/** 本工具接受的参数键集合。
 * The argument keys this tool accepts. */
const ARGUMENT_KEYS: ReadonlySet<string> = new Set([
  'sessionId', 'atSeq', 'presetId', 'provider', 'model', 'reasoningEffort',
])

/** 需要非空字符串校验的可选参数键。The optional keys validated as non-empty strings. */
const OPTIONAL_STRING_KEYS = ['presetId', 'provider', 'model', 'reasoningEffort'] as const

/**
 * 读取最近一个已完成轮次的前缀边界，包含轮次结束之后的独立事件。
 * 与宿主 Session 控制器的实现保持一致。
 * Read the latest completed-turn prefix boundary, including standalone events
 * that follow the last turn end. Mirrors the host Session controller.
 * @param events - 完整的源事件日志。The complete source log.
 * @returns 含边界 seq；没有已完成轮次时返回 undefined。
 *   The inclusive boundary seq, or undefined when no turn completed.
 */
export function latestCompletedPrefixBoundary(events: readonly SessionEvent[]): number | undefined {
  const lastTurnEnd = events.findLast(event => event.type === 'turn/end')
  if (lastTurnEnd === undefined) return undefined
  let boundary = lastTurnEnd.seq
  for (const next of events.slice(boundary + 1)) {
    if (next.type === 'turn/start'
      || (next.type === 'user/message' && next.surfaceOp === 'append')
      || next.type === 'agent/inbox/spliced') break
    boundary = next.seq
  }
  return boundary
}

/** 判断两个模型选择是否指向同一路由与推理强度。
 * Whether two model selections name the same route and effort. */
export function sameSelection(
  left: ModelSelectionView | undefined,
  right: ModelSelectionView | undefined,
): boolean {
  return left !== undefined && right !== undefined
    && left.provider === right.provider
    && left.model === right.model
    && left.reasoningEffort === right.reasoningEffort
}

/**
 * 把一个已存储的选择值投影到本工具关注的字段上。effort 只接受可字符串化的
 * 值，其余视为缺席。
 * Project one stored selection value onto the fields this tool tracks. The
 * effort is admitted only when stringifiable; anything else counts as absent.
 * @param value - 任意来源的已存储选择值。A stored selection value from any source.
 */
export function selectionOf(value: { provider: string; model: string; reasoningEffort?: unknown }): ModelSelectionView {
  const { reasoningEffort } = value
  return {
    provider: value.provider,
    model: value.model,
    ...(reasoningEffort === undefined ? {} : { reasoningEffort: String(reasoningEffort) }),
  }
}

/**
 * 按官方分叉规则解析会话下一轮请求将使用的模型：优先取挂起的
 * `model/selection`，其次取日志中最后一条 `request/header` 路由，
 * 最后回落到部署默认模型。
 * Resolve the model a session's next request would use under the shipped
 * fork rules: a pending `model/selection`, else the last logged
 * `request/header` route, else the deployment default.
 * @param ctx - 携带 `agentDefaultModel` 的宿主上下文。
 *   The host context carrying `agentDefaultModel`.
 * @param events - 完整的源事件日志。The complete source log.
 */
export function effectiveSelection(ctx: Context, events: readonly SessionEvent[]): ModelSelectionView {
  let pending: ModelSelectionView | undefined
  let last: ModelSelectionView | undefined
  for (const event of events) {
    if (event.type === 'model/selection') {
      pending = selectionOf(event.data)
    } else if (event.type === 'request/header') {
      const config = event.data.header.config
      const adapterDefaulted = event.data.header.adapterDefaults?.reasoningEffort === true
      last = {
        provider: config.provider,
        model: config.model,
        ...(adapterDefaulted || config.reasoningEffort === undefined
          ? {}
          : { reasoningEffort: String(config.reasoningEffort) }),
      }
      if (sameSelection(pending, last)) pending = undefined
    }
  }
  if (pending !== undefined) return pending
  if (last !== undefined) return last
  return selectionOf(ctx.agentDefaultModel.currentSelection())
}

/**
 * 校验并归一模型生成的参数。工具注册表不会为手工构造的工具定义校验参数，
 * 所以这里必须自己把关。
 * Validate and normalize model-generated arguments. The tool registry does not
 * validate arguments for directly constructed tool definitions, so this layer
 * has to.
 * @param args - 模型给出的原始参数。The raw model arguments.
 * @returns 归一化后的请求。The normalized request.
 * @throws {Error} 每个非法输入都抛出面向模型的诊断错误。
 *   Throws a model-facing diagnostic for every invalid input.
 */
export function normalizeArguments(args: unknown): ForkRequest {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) {
    throw new Error(`${TOOL_NAME}: arguments must be an object`)
  }
  const record = args as Record<string, unknown>
  for (const key of Object.keys(record)) {
    if (!ARGUMENT_KEYS.has(key)) throw new Error(`${TOOL_NAME}: unknown argument ${JSON.stringify(key)}`)
  }
  const sessionId = record.sessionId
  if (typeof sessionId !== 'string' || sessionId.trim() === '') {
    throw new Error(`${TOOL_NAME}: sessionId must be a non-empty string`)
  }
  if (record.atSeq !== undefined && (!Number.isSafeInteger(record.atSeq) || (record.atSeq as number) < 0)) {
    throw new Error(`${TOOL_NAME}: atSeq must be a non-negative integer`)
  }
  for (const key of OPTIONAL_STRING_KEYS) {
    const value = record[key]
    if (value !== undefined && (typeof value !== 'string' || value === '')) {
      throw new Error(`${TOOL_NAME}: ${key} must be a non-empty string when present`)
    }
  }
  const provider = record.provider as string | undefined
  const model = record.model as string | undefined
  const reasoningEffort = record.reasoningEffort as string | undefined
  if ((provider === undefined) !== (model === undefined)) {
    throw new Error(`${TOOL_NAME}: provider and model must be supplied together`)
  }
  if (reasoningEffort !== undefined && provider === undefined) {
    throw new Error(`${TOOL_NAME}: reasoningEffort requires provider and model`)
  }
  return {
    sessionId,
    ...(record.atSeq === undefined ? {} : { atSeq: record.atSeq as number }),
    ...(record.presetId === undefined ? {} : { presetId: record.presetId as string }),
    ...(provider === undefined
      ? {}
      : { provider, model: model as string, ...(reasoningEffort === undefined ? {} : { reasoningEffort }) }),
  }
}
