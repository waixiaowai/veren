/**
 * Coordination's public types: the triage verdict, the wake request, and the
 * freshness verdict — the decisions and refusals this module produces (design
 * §4). Coordination produces decisions only; content is never made here.
 *
 * 协调的公开类型：分流判定、唤醒请求与新鲜度判定——本模块产出的决策与拒绝（设计 §4）。
 * 协调只产出判定；内容绝不在这里产生。
 *
 * @module @veren/im-coordination/types
 */

/** Why one agent is being woken. */
/** 一个智能体被唤醒的原因。 */
export type WakeReason = 'message.new' | 'manual'

/** Why triage decided the way it did; a stable audit token, not prose. */
/** 分流如此判决的原因；稳定的审计记号，不是散文。 */
export type TriageSource =
  | 'self-authored'
  | 'direct-human'
  | 'mentioned'
  | 'group-quiet'
  | 'agent-quiet'
  | 'budget-exhausted'
  | 'already-claimed'

/** One triage verdict. */
/** 一条分流判定。 */
export interface TriageVerdict {
  /** Whether the agent should run a turn. */
  /** 该智能体是否应该跑一个回合。 */
  readonly actionable: boolean
  /** The deterministic reason behind the decision. */
  /** 决策背后的确定性原因。 */
  readonly source: TriageSource
}

/** One wake request handed to the turn module. Only coordination emits these. */
/** 交给回合模块的一条唤醒请求。只有协调发出它们。 */
export interface ImWakeRequest {
  readonly agentParticipantId: string
  readonly roomId: string
  readonly reason: WakeReason
  /** The message that triggered the wake; the turn's inbox anchor. */
  /** 触发唤醒的消息；回合收件箱的锚点。 */
  readonly triggerMessageId: string
}

/** Which gate refused a draft. */
/** 是哪道闸门拒绝了草稿。 */
export type HoldKind = 'freshness' | 'verbatim'

/** One unseen message, excerpted for the refusing verdict (max 8, per design). */
/** 一条未看到的消息，摘录进拒绝判定（按设计最多 8 条）。 */
export interface HoldLine {
  readonly sequence: number
  readonly authorId: string
  readonly excerpt: string
}

/** One preflight verdict for a draft reply. */
/** 一条草稿回复的预检判定。 */
export interface FreshnessVerdict {
  /** True when the draft must not be posted as-is. */
  /** 为真时草稿不得原样发出。 */
  readonly hold: boolean
  readonly kind?: HoldKind
  /** The messages the author has not seen (freshness holds only). */
  /** 作者尚未看到的消息（仅新鲜度拒绝携带）。 */
  readonly newer: readonly HoldLine[]
  /** How many holds this turn has already suffered. */
  /** 本回合至今已被拒的次数。 */
  readonly attempts: number
}

/** One seen-watermark row's public shape. */
/** 一条已见水位的公开形状。 */
export interface WatermarkView {
  readonly agentParticipantId: string
  readonly roomId: string
  readonly watermark: number
  readonly updatedAt: number
}
