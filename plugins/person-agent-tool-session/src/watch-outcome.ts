// 结束原因与收尾输出的纯派生：只读订阅以来目标会话的事件后缀，不碰注册表状态。
// Pure derivations of the stop reason and the closing output: they read only the
// target session's event suffix since subscription and never touch registry state.
import { foldConsumedWork } from '@deepseek-ai/dsh-agent'
import { joinAssistantStreamText } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { SessionDispatchOutcome } from './types.js'

/**
 * 从目标自己的事件后缀派生结束原因。
 * Derive the stop reason from the target's own event suffix.
 *
 * 归因用官方 `foldConsumedWork`（`@deepseek-ai/dsh-agent`，运行时可直接解析）：
 * 只有它能把「跑完了」与「认领了输入却被拒/被停/出错」分开——单看轮次边界，
 * 一个在第一步之前停下的轮次与一个平衡的空转轮次形状完全相同，孤立读轮次不是把
 * 被截断的活记成完成，就是把每个空转都定罪。分支本身照抄官方 `epochStopReason`
 * （在 `@deepseek-ai/dsh-subagent` 的 lifecycle.ts；该包在本工作区不可解析，
 * 且让会话工具依赖派活子系统是不该有的依赖边）。
 * The accounting reuses the official `foldConsumedWork` (`@deepseek-ai/dsh-agent`,
 * resolvable at runtime): only it separates "finished" from "claimed input then
 * was rejected/stopped/errored", because a turn stopping before its first step
 * has exactly the shape of a balanced no-op turn, so reading turns in isolation
 * either credits cut-short work as finished or convicts every no-op. The switch
 * mirrors the official `epochStopReason` (in `@deepseek-ai/dsh-subagent`'s
 * lifecycle.ts, which is not resolvable in this workspace and whose subsystem a
 * session tool should not depend on).
 * @param events - 订阅以来的目标事件。The target events since subscription.
 * @param failureAt - 尚未被后续轮次取代的失败位置。The failure position not yet superseded by a later turn.
 * @returns 结束原因。The stop reason.
 */
export function stopReasonOf(events: SessionEvent[], failureAt: number | undefined): SessionDispatchOutcome {
  // 已记录的失败优先于取消（官方 captureLocalResult 的同一判据）。
  // A recorded failure wins over a cancellation (the official captureLocalResult rule).
  if (failureAt !== undefined) return 'error'
  const { end, droppedUnrun } = foldConsumedWork(events)
  switch (end?.data.reason.kind) {
    case 'max-tokens': return 'max-tokens'
    case 'aborted':
    case 'interrupted': return 'aborted'
    case 'error': return 'error'
    // pre-step 拒绝（hook 拒绝、策略插件）丢弃了这个 epoch 已认领的输入：那是被拒绝，不是做完了。
    // A pre-step rejection (a hook deny, a policy plugin) discarded input this
    // epoch had claimed: the work was declined, not done.
    case 'blocked': return 'refusal'
    // 干净结束与「根本没有计账轮次」同规则：没有取消留下的未跑输入就算做完了。
    // A clean ending and no accounting turn share one rule: the epoch finished
    // what it was given unless a cancelled queue says otherwise.
    case undefined:
    case 'completed': return droppedUnrun ? 'aborted' : 'completed'
    default:
      // TurnEndReason 可扩展：无法命名的结束按失败汇报，而不是当成成功。
      // Merge-extensible: an unnameable ending is reported as a failure, never
      // as success.
      return 'error'
  }
}

/**
 * 折叠目标的收尾输出。规则与官方 `AssistantOutputFold` 一致：最后一条**非空**
 * assistant 消息（空内容消息，例如只带 usage 的，不替换更早的输出）；没有任何消息时
 * 回退到累积的流文本。该官方类来自不可解析的 `@deepseek-ai/dsh-subagent`，所以这里
 * 按其语义就地实现，并复用官方的 `joinAssistantStreamText` 处理流片段。
 * Fold the target's closing output. The rule matches the official
 * `AssistantOutputFold`: the last non-empty assistant message (an empty-content
 * message, such as a usage-only one, never replaces earlier output), falling
 * back to the accumulated stream text when no message exists. That official
 * class lives in the unresolvable `@deepseek-ai/dsh-subagent`, so its semantics
 * are implemented here and the official `joinAssistantStreamText` handles the
 * stream pieces.
 * @param events - 订阅以来的目标事件。The target events since subscription.
 * @returns 收尾内容块。The closing content blocks.
 */
export function closingText(events: SessionEvent[]): readonly ContentBlock[] {
  let message: readonly ContentBlock[] | undefined
  const partial: string[] = []
  for (const event of events) {
    if (event.type === 'assistant/message') {
      const content = event.data.message.content
      if (content.length > 0) message = content
    }
    if (event.type === 'assistant/message' || event.type === 'assistant/attempt') {
      partial.push(joinAssistantStreamText(event.data.stream))
    }
  }
  if (message !== undefined) return message
  const text = partial.join('')
  return text.length > 0 ? [{ type: 'text', text }] : []
}
