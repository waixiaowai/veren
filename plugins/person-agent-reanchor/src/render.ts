// 重锚文案：一条很短、带数字、只讲「关于它自己的事实」的提醒。
// Re-anchor copy: one short, numeric notice that states a fact about the
// session itself, never a restatement of the persona.
import type { AnalysisRun } from './types.js'

/** How many turns of phrasing exist; consecutive notices rotate through them. 措辞循环数；相邻提醒轮换使用。 */
const VARIANTS = 3

/**
 * The dispatch clause: this turn never dispatched, so quote the session-wide
 * count honestly.
 * 派活从句：本回合没有派活，因此如实引用全会话次数。
 * @param run - counted facts. 统计事实。
 * @returns one short clause. 一个短从句。
 */
function dispatchClause(run: AnalysisRun): string {
  if (run.dispatches === 0) return '本次会话派活 0 次'
  return `本回合派活 0 次（本次会话共 ${run.dispatches} 次）`
}

/**
 * Render the notice for one run. The variant rotates with the number of
 * notices already in the log, and every variant carries live counts, so two
 * consecutive notices are never the same text.
 * 为一段自干渲染提醒。措辞随日志里已有提醒数轮换，每个变体都带实时数字，
 * 因此相邻两条提醒的文字不会相同。
 * @param run - counted facts. 统计事实。
 * @param variantSeed - number of notices already recorded. 已记录提醒数。
 * @returns the model-facing notice text. 面向模型的提醒文本。
 */
export function renderReminder(run: AnalysisRun, variantSeed: number): string {
  const files = run.files === 0 ? '未打开文件' : `${run.files} 个文件`
  const variant = ((variantSeed % VARIANTS) + VARIANTS) % VARIANTS
  if (variant === 0) {
    return `自检：你已经连续 ${run.steps} 步、${run.calls} 次工具调用只在自己做分析（${files}），${dispatchClause(run)}。你正在自干。停手：把这项工作交给一个工作会话，第一条消息写清目标与验收；只有写给人读的文档才用 write。`
  }
  if (variant === 1) {
    return `事实：最近 ${run.steps} 步里你亲自调用了 ${run.calls} 次分析类工具（${files}），${dispatchClause(run)}。判据「连续多步只分析、未派活」已经满足——这是自干。下一步应是创建并派活，而不是再读一个文件。`
  }
  return `记录：连续 ${run.steps} 步分析、${run.calls} 次调用、${files}，${dispatchClause(run)}。你现在是在自己干活。现在停手，创建并派活；不要再打开第 ${run.files + 1} 个文件。`
}

/**
 * One-line account stored on the message source, shown without expanding it.
 * 存在消息来源上的一行陈述，UI 不必展开即可显示。
 * @param run - counted facts. 统计事实。
 * @returns the summary line. 摘要行。
 */
export function reminderSummary(run: AnalysisRun): string {
  return `连续 ${run.steps} 步只分析，未派活`
}
