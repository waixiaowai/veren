/**
 * 无人值守分级门（docs/unattended-page-contract.cn.md §1）：sub2api 的真破坏性
 * /对外动作（退款、删套餐、删码）单列 L2——本回合没有人类消息时拒绝（稳定
 * code，fail-closed），有人在场（本回合有 `kind:'user'` 消息）才放行；L0/L1
 * 动作全部自主执行，完成后按 §3 带证据回报。
 * The unattended level gate (docs/unattended-page-contract.md §1): sub2api's
 * truly destructive/external actions (refund, plan delete, code deletion) are
 * L2 — refused with a stable code when the current turn carries no human
 * message (fail-closed), allowed when a human is present (a `kind:'user'`
 * message this turn); L0/L1 actions run autonomously and report evidence per §3.
 *
 * 信号面：`session.deriveMessages()`（被认可的投影读面；ownEvents 等同步历史
 * 读已被 DSH 决策 2026-09-09 禁止新调用）。会话面缺席 = 无人 = 拒绝。
 * Signal face: `session.deriveMessages()` (the sanctioned projection read;
 * synchronous history reads such as ownEvents are barred from new calls by DSH
 * decision 2026-09-09). A missing session face reads as unattended = refuse.
 * @module @veren/sub2api-admin/unattended
 */
import type { Message } from '@deepseek-ai/dsh-llm'
import type { GateExec } from './client.ts'

/** L2 拒绝稳定码 / the stable L2 refusal code */
export const UNATTENDED_L2_REFUSED = 'unattended/l2-refused'

/**
 * L2 结构化拒绝：带稳定 code；模型能据此改走可逆替代或向用户转述，而不是
 * 反复重试同一动作。
 * The structured L2 refusal: a stable code the model can act on — switch to a
 * reversible alternative or relay to the user, not retry the same action.
 */
export class UnattendedRefusal extends Error {
  readonly code = UNATTENDED_L2_REFUSED

  constructor(tool: string, action: string) {
    super(`[${UNATTENDED_L2_REFUSED}] ${tool}.${action} 是破坏性/对外动作（L2）：本回合没有人类消息，无人值守路径拒绝执行。`
      + '如确需执行，请由用户在本页会话里明确要求后再试；或改用可逆替代（如 order_cancel、先暂停再观察）。')
  }
}

/**
 * L2 动作闭集（docs/unattended-page-contract.cn.md §5 行 12–13）：资金外流
 * （退款）与不可逆删除（套餐/兑换码/优惠码）。渠道与分组的 delete 是可重建
 * 的下架/重建（L1，任务矩阵裁定）；账号运维全是可逆状态翻转（L1）。
 * The closed L2 set (docs/unattended-page-contract.md §5 rows 12–13): money
 * leaving (refund) and irreversible deletions (plan/redeem/promo codes).
 * Channel/group deletes are rebuildable takedowns (L1 by the matrix); account
 * ops are reversible status flips (L1).
 */
const L2_ACTIONS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['payment', new Set(['order_refund', 'plan_delete'])],
  ['redeem_codes', new Set(['delete', 'batch_delete'])],
  ['promo_codes', new Set(['delete'])],
])

/**
 * 本回合（最后一条 assistant 消息之后的切片）是否有人类消息。
 * Whether the current turn (the slice after the last assistant message) carries
 * a human message.
 */
export function userConsentThisTurn(messages: readonly Message[]): boolean {
  let lastAssistant = -1
  for (let index = 0; index < messages.length; index += 1) {
    if (messages[index]?.role === 'assistant') lastAssistant = index
  }
  const turn = lastAssistant >= 0 ? messages.slice(lastAssistant + 1) : messages
  return turn.some((message) => message.role === 'user' && message.source.kind === 'user')
}

/** L2 门：动作不在闭集 → 直通；在闭集 → 有人在场放行，否则结构化拒绝 / the L2 gate */
export function assertAllowedUnattended(tool: string, action: string, exec: GateExec): void {
  if (L2_ACTIONS.get(tool)?.has(action) !== true) return
  if (hasHumanConsent(exec)) return
  throw new UnattendedRefusal(tool, action)
}

/** raw 透传的 L2 门：非 GET 在无人值守时同样拒绝（透传可达任意端点）/ the raw-passthrough L2 gate */
export function assertRawAllowedUnattended(method: string, exec: GateExec): void {
  if (method === 'GET') return
  if (hasHumanConsent(exec)) return
  throw new UnattendedRefusal('request', method)
}

/** 会话投影里读本回合人类消息；面缺席 = 无人（fail-closed）/ read the turn's human messages off the session projection; absent face = unattended */
function hasHumanConsent(exec: GateExec): boolean {
  const messages = exec.agent?.session?.deriveMessages?.() ?? []
  return userConsentThisTurn(messages)
}
