/**
 * 推理档位探测：判定上游验不验 `reasoning_effort`，验的话收哪些档位。
 * The reasoning-effort probe: does the upstream validate `reasoning_effort`,
 * and if so which canonical values does it accept.
 *
 * 顺序即语义，不是优化：baseline（无 effort）证明请求路径通；sentinel（随机
 * 不可能值）回答"验不验"——收下不可能值的模型对**所有**值都答 200，逐档结
 * 果全是假阳性；只有 sentinel 被拒后档位结果才有意义。中途不决答案 ⇒ 整轮
 * unknown（部分清单不是发现）。`off` 永不探测（关思考是目录声明的事）。
 * The order is semantics: baseline proves the path; the sentinel answers "does
 * it validate" (a model accepting an impossible value answers 200 to
 * everything); levels mean something only after the sentinel was refused. A
 * non-decisive mid-sweep answer ⇒ the whole run is unknown. `off` is never
 * probed.
 *
 * 探测消耗真实积分：调用方（客户端卡片）必须带双确认。
 * Probes consume real credits: the caller (the client card) must double-confirm.
 *
 * 证据：docs/workbuddy-protocol.cn.md §7；卷宗 probe.ts。
 * Evidence: docs/workbuddy-protocol.md §7; dossier probe.ts.
 *
 * @module @veren/workbuddy-protocol/probe
 */

import { randomBytes } from 'node:crypto'
import type { WorkBuddyEffort } from './catalog-types.ts'

/** 探测的档位候选（固定顺序）。The probed candidates, in a fixed order. */
export const PROBE_EFFORT_CANDIDATES: readonly WorkBuddyEffort[] = ['low', 'medium', 'high', 'xhigh', 'max'] as const

/** 单请求天花板：一个挂死的探测不得拖住队列。Per-request ceiling: one hung probe must not stall the queue. */
export const PROBE_REQUEST_TIMEOUT_MS = 30_000

/** 一次探测的结论。The outcome of one probe. */
export type ProbeOutcome =
  | { readonly validation: 'validating'; readonly efforts: readonly WorkBuddyEffort[]; readonly requests: number }
  | { readonly validation: 'non-validating'; readonly efforts: readonly []; readonly requests: number }
  | { readonly validation: 'unknown'; readonly efforts: readonly []; readonly requests: number; readonly reason: string }

/** 一次尝试的观测（探测器眼里的唯一区分）。One attempt's observation (the only distinctions the attribution rule needs). */
export interface ProbeObservation {
  readonly status: number
  readonly streamed: boolean
  readonly errorCode?: string
}

/** 怎么发一次尝试；凭据与 HTTP 由调用方持有。How one attempt is sent; credentials and HTTP stay with the caller. */
export type ProbeSender = (effort: string | undefined, signal: AbortSignal) => Promise<ProbeObservation>

/**
 * 各端点实测过的"档位值不支持"错误码。集合按端点分开：一个码只为实测到它的
 * 端点扩宽归因——把通用码加给 CN 会把归因撑到没观测过的地方。
 * The measured "this effort value is not supported" codes, per endpoint. The
 * sets stay separate so a code only widens attribution for the endpoint it was
 * measured on.
 */
const INVALID_EFFORT_CODES: Readonly<Record<'cn' | 'global', ReadonlySet<string>>> = {
  cn: new Set(['invalid_reasoning_effort']),
  global: new Set(['invalid_reasoning_effort', 'model_param_invalid']),
}

/** 是否一次归因明确的档位拒绝。Whether an attempt is an attributable rejection of the effort value. */
function isEffortRejection(attempt: ProbeObservation, region: 'cn' | 'global'): boolean {
  return attempt.status === 400 && attempt.errorCode !== undefined
    && INVALID_EFFORT_CODES[region].has(attempt.errorCode)
}

/** 是否一次"上游收下并真的在流"的接受。Whether the upstream accepted and really streamed. */
function isAcceptance(attempt: ProbeObservation): boolean {
  return attempt.status === 200 && attempt.streamed
}

/** 探测一个模型。`candidates` 仅供测试缩短；生产恒用全表。Probe one model; `candidates` is a test seam. */
export async function probeModel(options: {
  readonly send: ProbeSender
  readonly region: 'cn' | 'global'
  readonly sentinel?: () => string
  readonly candidates?: readonly WorkBuddyEffort[]
  readonly timeoutMs?: number
}): Promise<ProbeOutcome> {
  const sentinel = options.sentinel ?? (() => `probe_sentinel_${randomBytes(12).toString('hex')}`)
  const candidates = options.candidates ?? PROBE_EFFORT_CANDIDATES
  let requests = 0
  const attempt = async (effort: string | undefined): Promise<ProbeObservation> => {
    requests += 1
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? PROBE_REQUEST_TIMEOUT_MS)
    try {
      return await options.send(effort, controller.signal)
    } catch {
      return { status: 0, streamed: false }
    } finally {
      clearTimeout(timer)
    }
  }

  // 1. 基线：没有它，sentinel 上的 400 也可能只是无关的请求问题。
  // 1. Baseline: without it a 400 on the sentinel could just be an unrelated request problem.
  const baseline = await attempt(undefined)
  if (!isAcceptance(baseline)) {
    return { validation: 'unknown', efforts: [], requests, reason: `baseline status ${baseline.status}` }
  }

  // 2. sentinel：唯一能区分"验证该字段"与"来者不拒"的一步。
  // 2. Sentinel: the only step distinguishing "validates the field" from "accepts anything".
  const sentinelAttempt = await attempt(sentinel())
  if (isAcceptance(sentinelAttempt)) {
    return { validation: 'non-validating', efforts: [], requests }
  }
  if (!isEffortRejection(sentinelAttempt, options.region)) {
    return { validation: 'unknown', efforts: [], requests, reason: `sentinel status ${sentinelAttempt.status} ${sentinelAttempt.errorCode ?? ''}` }
  }

  // 3. 档位：只在 sentinel 被拒之后才有意义。
  // 3. Levels: meaningful only because the sentinel was refused.
  const accepted: WorkBuddyEffort[] = []
  for (const effort of candidates) {
    const levelAttempt = await attempt(effort)
    if (isAcceptance(levelAttempt)) {
      accepted.push(effort)
      continue
    }
    if (isEffortRejection(levelAttempt, options.region)) continue
    return { validation: 'unknown', efforts: [], requests, reason: `level ${effort} status ${levelAttempt.status}` }
  }
  return { validation: 'validating', efforts: accepted, requests }
}
