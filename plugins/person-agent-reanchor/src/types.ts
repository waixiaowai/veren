// 类型只放这里：日志读取视图、分析判定参数、一次「连续自干」的事实。
// Types only: the log-read view, the analysis policy, and the facts of one
// self-work run.
import type { Session, SessionSeq } from '@deepseek-ai/dsh-session'

/**
 * The read-only slice of a session this plugin needs. `Session` satisfies it
 * structurally, so call sites pass `agent.session` with no conversion.
 * 本插件需要的会话只读切片。`Session` 在结构上天然满足它，调用处直接传
 * `agent.session`，无需转换。
 */
export interface SessionLogView {
  /** Number of events currently in the log. 当前日志事件数。 */
  readonly seq: number
  /** Read one log event by sequence. 按序号读取一条日志事件。 */
  eventAt(seq: SessionSeq): ReturnType<Session['eventAt']>
}

/**
 * Which tool names count as analysis and which count as handing work off.
 * 哪些工具名算分析、哪些算把活派出去。
 */
export interface AnalysisPolicy {
  /** Calls that only inspect or analyze. 只做检查或分析的工具调用。 */
  readonly analysisTools: readonly string[]
  /** Calls that hand the task to another session. 把任务交给其他会话的工具调用。 */
  readonly dispatchTools: readonly string[]
}

/**
 * Facts read from the session log at pre-step. Everything is derived from the
 * log, so a process restart changes nothing.
 * pre-step 时从会话日志读出的事实。所有值都从日志推导，进程重启不受影响。
 */
export interface AnalysisRun {
  /** Consecutive completed analysis-only steps, counted back from the tail. 从尾部向前数的连续纯分析步数。 */
  readonly steps: number
  /** Tool calls inside those steps. 这些步骤里的工具调用数。 */
  readonly calls: number
  /** Distinct files those calls touched. 这些调用涉及的不同文件数。 */
  readonly files: number
  /** Dispatch calls anywhere in this session. 本会话任何位置的派活调用数。 */
  readonly dispatches: number
  /** Re-anchor notices already in this session (drives wording rotation). 本会话已有的重锚提醒数（用于轮换措辞）。 */
  readonly anchors: number
  /** Whether this turn already dispatched work. 本回合是否已经派过活。 */
  readonly currentTurnDispatched: boolean
}
