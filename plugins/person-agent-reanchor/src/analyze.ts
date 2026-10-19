// 会话日志分析：把「最近是不是一直自己在读代码」变成一个可数的事实。
// Session-log analysis: turns "has it been reading code on its own" into a
// countable fact.
//
// 只读日志、不存内存状态：阈值判定不依赖进程存活，重启后同一份日志得到同一
// 答案，也不会泄漏 WeakMap 一类按 Agent 累积的状态。
// Log-only and stateless: the verdict survives a restart because it is derived
// from the same log, and there is no per-Agent WeakMap to leak.
import { SessionSeq } from '@deepseek-ai/dsh-session'
import type { AnalysisPolicy, AnalysisRun, SessionLogView } from './types.js'

/** Message source kind stamped on every re-anchor notice. 每条重锚提醒的消息来源标识。 */
export const SOURCE = 'person-agent-reanchor' as const

/** One step's calls while walking backwards. 倒序扫描时的一步调用集合。 */
interface StepGroup {
  readonly turn: number
  readonly step: number
  allAnalysis: boolean
  calls: number
  readonly files: Set<string>
}

/**
 * Read the current self-work run from the log tail.
 *
 * Counting stops at the first completed step that contained a non-analysis call,
 * at human input, or at the previous re-anchor notice. Dispatch counts keep
 * scanning the whole log because the notice quotes session-wide numbers.
 * 从日志尾部读出当前的自干连续段。
 *
 * 遇到第一个含非分析调用的完整步骤、人类输入或上一条重锚提醒时停止计数；
 * 派活次数仍扫描整份日志，因为提醒要引用全会话的数字。
 * @param session - read-only session log. 只读会话日志。
 * @param policy - analysis and dispatch tool names. 分析与派活的工具名。
 * @param currentTurn - the turn about to start. 即将开始的回合号。
 * @returns the counted facts. 统计出的事实。
 */
export function readAnalysisRun(session: SessionLogView, policy: AnalysisPolicy, currentTurn: number): AnalysisRun {
  const analysisTools = new Set(policy.analysisTools)
  const dispatchTools = new Set(policy.dispatchTools)
  const files = new Set<string>()
  let steps = 0
  let calls = 0
  let dispatches = 0
  let anchors = 0
  let currentTurnDispatched = false
  // 计数只覆盖从尾部连续成立的那一段；断开后仍继续扫描，只为统计派活与提醒数。
  // Counting covers only the run that is contiguous from the tail; after the
  // break the scan continues solely to count dispatches and notices.
  let counting = true
  let group: StepGroup | undefined

  /** Close the current step group and fold it into the run. 结束当前步分组并并入连续段。 */
  const closeGroup = (): void => {
    if (group === undefined) return
    if (group.allAnalysis) {
      steps += 1
      calls += group.calls
      for (const file of group.files) files.add(file)
    } else {
      counting = false
    }
    group = undefined
  }

  for (let index = Number(session.seq) - 1; index >= 0; index -= 1) {
    const event = session.eventAt(SessionSeq(index))
    if (event === undefined) continue
    if (event.type === 'user/message') {
      const kind = event.data.source.kind
      if (kind === SOURCE) {
        anchors += 1
        if (!counting) continue
        closeGroup()
        counting = false
      } else if (counting && (kind === undefined || kind === 'user')) {
        closeGroup()
        counting = false
      }
      continue
    }
    if (event.type !== 'tool/call') continue
    const call = event.data
    if (dispatchTools.has(call.name)) {
      dispatches += 1
      if (call.turn === currentTurn) currentTurnDispatched = true
    }
    if (!counting) continue
    // 步骤边界：上一步已经完整，先结账再开新组。
    // Step boundary: the previous step is complete, fold it before opening
    // the next group.
    if (group !== undefined && (group.turn !== call.turn || group.step !== call.step)) closeGroup()
    if (!counting) continue
    group ??= { turn: call.turn, step: call.step, allAnalysis: true, calls: 0, files: new Set<string>() }
    group.calls += 1
    if (!analysisTools.has(call.name)) {
      group.allAnalysis = false
      continue
    }
    const file = filePathOf(call.arguments)
    if (file !== undefined) group.files.add(file)
  }
  closeGroup()
  return { steps, calls, files: files.size, dispatches, anchors, currentTurnDispatched }
}

/**
 * Pull a file path out of a logged tool call's raw JSON arguments. Only
 * `file_path` counts: `grep`/`glob` also take a `path` that is usually a
 * directory, and counting directories as files inflates the number the notice
 * quotes. Tool arguments are a model/JSON boundary, so parsing is defensive; a
 * malformed call simply contributes no file.
 * 从已记录的工具调用原始 JSON 参数里取出文件路径。只认 `file_path`：
 * `grep`/`glob` 的 `path` 通常是目录，把目录算成文件会虚增提醒引用的数字。
 * 工具参数是模型/JSON 边界，因此解析采取防御姿态；参数畸形时这次调用只是不
 * 贡献文件。
 * @param raw - raw arguments string. 原始参数字符串。
 * @returns the path, or undefined when absent/unparseable. 路径；缺失或无法解析时为 undefined。
 */
function filePathOf(raw: string): string | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (parsed === null || typeof parsed !== 'object') return undefined
  const value = (parsed as { file_path?: unknown }).file_path
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * Whether this step should carry a re-anchor notice.
 * 本步是否应该附带一条重锚提醒。
 * @param run - facts read from the log. 从日志读出的事实。
 * @param threshold - consecutive analysis-only steps required. 所需连续纯分析步数。
 * @returns true when the notice should be appended. 应追加提醒时为 true。
 */
export function shouldReanchor(run: AnalysisRun, threshold: number): boolean {
  // 同一回合派过活就不再提醒：刚交代完工作又收到「你在自干」只会制造噪声。
  // No reminder after a dispatch in the same turn: telling a bridge that just
  // handed work off that it is self-working is pure noise.
  if (run.currentTurnDispatched) return false
  return run.steps >= threshold
}
