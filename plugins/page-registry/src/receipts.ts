/**
 * `page_send` 回执台账：目标页面会话的唤醒回合结束时，把它的最终回答以一条
 * PAGE-RECEIPT 消息落回发送方会话日志（wake:false，只记账不唤醒——绝不引发
 * 自动回环）。
 * The `page_send` receipt ledger: when the target page session's woken turn
 * ends, its final answer lands back in the sender's session log as a
 * PAGE-RECEIPT message (wake:false — recorded only, never waking, so no
 * automatic reply loop can form).
 *
 * 真机反例（立项依据）：投递是"发完即忘"，发送方会话只能对用户说"结果在那个
 * 页面会话里，不会回传"——闭环断在回执一步。本模块补上最小回执：一次投递、
 * 一次回执，目标回合的最终文本原样带回。
 * Live counter-example (why this exists): delivery was fire-and-forget, so the
 * sending session could only tell the user "the answer lives in that page
 * session and never comes back" — the loop broke at the receipt. This adds the
 * minimal receipt: one delivery, one receipt, the target turn's final text
 * verbatim.
 *
 * 边界口径：
 * - 只对 wake !== false 的投递武装回执（wake:false 不产生回合，无回执可发）；
 * - 武装时若目标回合已在飞行中，那次 turn/end 属于旧回合——不点火，等武装后
 *   观察到的第一个 turn/start 的回合结束才发（回合边界判定）；
 * - 目标 agent 先销毁（无回合结束）→ 撤销武装，不发陈旧回执；
 * - 同目标多次投递：后投递的发送方覆盖前者（最新意图胜出）；
 * - 回执文本截断上限 4000 字符，超限如实标注。
 * Boundary rules:
 * - only wake !== false deliveries arm a receipt (wake:false produces no turn);
 * - if the target's turn is already in flight at arm time, that turn/end
 *   belongs to the old round — do not fire; fire at the end of the first turn
 *   whose turn/start was observed after arming (turn-boundary detection);
 * - the target agent disposing first (no turn end) disarms — no stale receipts;
 * - repeat deliveries to one target: the latest caller wins;
 * - receipt text caps at 4000 characters, marked honestly when truncated.
 *
 * @module @veren/page-registry/receipts
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'

/** 回执消息源（会话端口的 source）/ the receipt message source */
export const PAGE_RECEIPT_SOURCE = 'page/receipt'

/** 回执正文截断上限 / the receipt body cap */
const RECEIPT_TEXT_CAP = 4000

/** 一条已武装的回执 / one armed receipt */
interface ArmedReceipt {
  readonly callerSessionId: string
  readonly url: string
  /** 武装后是否观察到 turn/start（回合边界判定）/ whether a turn/start was seen after arming */
  turnStarted: boolean
  /** 本回合内最近一次非空 assistant 文本 / the latest non-empty assistant text this turn */
  lastText: string
}

/**
 * 回执台账：service 构造一次，deliverUrl 成功后武装，session/event 观察器驱动
 * 点火。监听器 global 注册——session/event 与 agent/disposed 都经 scopeTarget
 * 载体派发（本服务在根域，非 global 监听一个事件都收不到；与 app-host 的
 * agent/created 教训同源）。
 * The receipt ledger: built once by the service, armed after a successful
 * deliverUrl, fired by the session/event observer. Listeners register global —
 * session/event and agent/disposed both dispatch through scopeTarget carriers
 * (this service lives in the root realm; a non-global listener receives
 * nothing — same lesson as app-host's agent/created).
 */
export class DeliveryReceipts {
  private readonly armed = new Map<string, ArmedReceipt>()
  private readonly ctx: Context
  private readonly append: (sessionId: string, text: string, source: string, options?: { readonly wake?: boolean }) => Promise<void>
  private readonly warn: (message: string) => void

  constructor(options: {
    readonly ctx: Context
    readonly append: DeliveryReceipts['append']
    readonly warn: (message: string) => void
  }) {
    this.ctx = options.ctx
    this.append = options.append
    this.warn = options.warn
    // global 是硬要求（见类注释）/ global is a hard requirement (see the class doc)
    this.ctx.effect(() => this.ctx.on('session/event', this.onEvent, { global: true }), 'page-registry: receipt observer')
    this.ctx.effect(() => this.ctx.on('agent/disposed', this.onDisposed, { global: true }), 'page-registry: receipt disarm listener')
  }

  /**
   * 武装一条回执（wake 投递成功后由 deliverUrl 调用）。
   * Arm one receipt (called by deliverUrl after a successful wake delivery).
   */
  arm(targetSessionId: string, callerSessionId: string, url: string): void {
    this.armed.set(targetSessionId, { callerSessionId, url, turnStarted: false, lastText: '' })
  }

  /** 台账规模（测试断言面）/ the ledger size (an assertion surface for tests) */
  get size(): number {
    return this.armed.size
  }

  /** 逐事件驱动：记账 assistant 文本，回合边界判定后点火 / per-event bookkeeping and firing */
  private readonly onEvent = (session: Session, event: SessionEvent): void => {
    const target = session.id
    const entry = this.armed.get(target)
    if (entry === undefined) return
    if (event.type === 'turn/start') {
      entry.turnStarted = true
      entry.lastText = ''
      return
    }
    if (event.type === 'assistant/message') {
      const text = assistantTextOf(event)
      if (text !== '') entry.lastText = text
      return
    }
    if (event.type === 'turn/end') this.settle(target, entry)
  }

  /**
   * turn/end 的结算：武装前已飞行的旧回合收尾不点火（等真正的回应回合）；
   * 点火即清账，最终回答以 wake:false 落回发送方日志。
   * Settle a turn/end: the tail of a pre-arm round does not fire (wait for the
   * round that answers); firing clears the ledger and lands the final answer
   * back in the sender's log with wake:false.
   */
  private settle(target: string, entry: ArmedReceipt): void {
    // 旧回合的收尾（武装前已飞行）不点火，等真正的回应回合 / the tail of a
    // pre-arm round does not fire; wait for the round that answers
    if (!entry.turnStarted) {
      entry.lastText = ''
      return
    }
    this.armed.delete(target)
    const body = entry.lastText === ''
      ? '(the woken turn ended without a textual answer / 唤醒回合结束，无文本回答)'
      : capText(entry.lastText)
    const message = `PAGE-RECEIPT ${entry.url}（目标页面会话的最终回答 / the target page session's final answer）\n${body}`
    // wake:false 是防回环的硬约束：回执只落发送方日志，下一次回合可见。
    // wake:false is the anti-loop invariant: the receipt only lands in the
    // sender's log, visible on its next turn.
    void this.append(entry.callerSessionId, message, PAGE_RECEIPT_SOURCE, { wake: false })
      .catch((error: unknown) => {
        this.warn(`page-registry: receipt to ${entry.callerSessionId} for ${entry.url} failed: ${String(error)}`)
      })
  }

  /** 目标 agent 销毁：撤销武装（无回合可等，不发票面陈旧回执）/ disarm on target disposal */
  private readonly onDisposed = ({ agent }: { agent: Agent }): void => {
    const sessionId = agent.session?.id
    if (sessionId !== undefined) this.armed.delete(sessionId)
  }
}

/** 取一条 assistant/message 事件里的文本块（跳过 reasoning）/ extract the text blocks of an assistant/message event */
function assistantTextOf(event: SessionEvent): string {
  if (event.type !== 'assistant/message') return ''
  const blocks = (event.data as { message?: { content?: ReadonlyArray<{ type?: string; text?: string }> } }).message?.content
  if (!Array.isArray(blocks)) return ''
  return blocks
    .filter((block) => block.type === 'text' && typeof block.text === 'string' && block.text.trim() !== '')
    .map((block) => block.text)
    .join('\n')
}

/** 截断到上限并如实标注 / cap with an honest marker */
function capText(text: string): string {
  return text.length <= RECEIPT_TEXT_CAP ? text : `${text.slice(0, RECEIPT_TEXT_CAP)}…(truncated / 已截断)`
}
