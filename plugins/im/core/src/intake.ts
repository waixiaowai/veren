/**
 * Automatic stranger intake: ask once, and let the conversation model record
 * the answer through the low-privilege `im_person_report` tool.
 *
 * The question is sent to the stranger, never to the user. A person is asked at
 * most once; a burst of messages cannot trigger a second question. This module
 * no longer parses replies: reading the answer is a semantic judgment, so the
 * conversation model decides and writes through the tool. This side only keeps
 * the ask side (rate limits, ask-once, audit) and the settle entry the tool
 * calls back into.
 *
 * 自动陌生人采集：只问一次，回答由会话中的大模型通过低权限工具 `im_person_report` 记录。
 *
 * 询问发给陌生人，而不是用户。每个人最多问一次；连发多条也不会触发第二次询问。本模块不再解析
 * 回复：读懂回答是语义判断，由会话模型决定并经工具写入。这一侧只保留提问侧（限频、ask-once、
 * 审计）以及供工具回写的 settle 接口。
 *
 * Declarations (config, the fixed question, view shapes, options) live in
 * `intake-types.ts` and are re-exported unchanged here.
 * 声明面（配置、固定询问、视图形状、选项）在 `intake-types.ts`，并在此原样再导出。
 *
 * @module @veren/im/intake
 */

import { errorMessage } from './runtime-seams.ts'
import type { ImLogger } from './runtime-seams.ts'
import type { ImMessage, ImSendResult } from './contract.ts'
import type { ImPeople, ImPersonView } from './people.ts'
import type { ImPersonIntakeRow } from './store.ts'
import { STRANGER_INTAKE_ASK, STRANGER_INTAKE_DEFAULTS } from './intake-types.ts'
import type {
  ImIntakeRecordView, ImIntakeSettle, ImIntakeStatusView, ImStrangerIntakeConfig, ImStrangerIntakeOptions,
} from './intake-types.ts'

// ---- unchanged export surface (declarations moved to intake-types.ts) ----
// ---- 导出面不变（声明面移至 intake-types.ts）----
export { STRANGER_INTAKE_ASK, STRANGER_INTAKE_DEFAULTS } from './intake-types.ts'
export type {
  ImIntakeRecordView,
  ImIntakeSettle,
  ImIntakeStatusView,
  ImStrangerIntakeConfig,
  ImStrangerIntakeOptions,
} from './intake-types.ts'

const HOUR_MS = 3_600_000
const RECENT_LIMIT = 100

/**
 * The automatic stranger-intake service. It never routes messages and never
 * reads replies: it sends one fixed question and settles rows when the
 * conversation model reports back through the tool.
 * 自动陌生人采集服务。它不路由消息，也不读回复：只发送一条固定询问，并在会话模型通过工具
 * 回报时收尾对应的行。
 */
export class ImStrangerIntake {
  private readonly people: ImPeople
  private readonly logger: ImLogger
  private readonly send: ImStrangerIntakeOptions['send']
  private readonly now: () => number
  private readonly config: ImStrangerIntakeConfig
  // In-process guards: two concurrent conversations cannot ask one person twice,
  // and a failed intake write cannot cause a second question after a good send.
  // 进程内保护：两个并发会话不会把同一个人问两遍；intake 写入失败也不会在发送成功后重问。
  private readonly asking = new Set<string>()
  private readonly asked = new Set<string>()
  private readonly askTimes = new Map<string, number[]>()

  /**
   * @param options - people directory, logger, sender, config, and clock.
   */
  constructor(options: ImStrangerIntakeOptions) {
    this.people = options.people
    this.logger = options.logger
    this.send = options.send
    this.now = options.now ?? Date.now
    this.config = { ...STRANGER_INTAKE_DEFAULTS, ...options.config }
  }

  /** Whether the total switch is on. */
  get enabled(): boolean {
    return this.config.enabled
  }

  /**
   * React to one inbound message before it is routed by asking the question
   * when allowed. Failures are logged and contained: bookkeeping must not drop
   * the message, and replies are left to the conversation model.
   * 在消息被路由前处理一次入站消息，允许时发出询问。失败只记日志并吞掉：记账不能丢消息；
   * 回复交给会话模型处理。
   * @param providerId - provider that emitted the message.
   * @param message - normalized inbound message.
   * @param person - the sender as just observed, when recording succeeded.
   */
  async handle(providerId: string, message: ImMessage, person: ImPersonView | undefined): Promise<void> {
    try {
      await this.askOnce(providerId, message, person)
    } catch (error: unknown) {
      this.logger.error(`[im:${providerId}] stranger intake failed: ${errorMessage(error)}`)
    }
  }

  /** Read the switch, counts, and recent audit records. */
  status(limit = 20): ImIntakeStatusView {
    const rows = this.people.intakes().sort((left, right) => right.asked_at - left.asked_at)
    const counts = this.countsOf(rows)
    const requested = Number.isFinite(limit) ? Math.trunc(limit) : 20
    const size = Math.max(1, Math.min(RECENT_LIMIT, requested))
    return {
      enabled: this.config.enabled,
      askText: STRANGER_INTAKE_ASK,
      replyWindowMs: this.config.replyWindowMs,
      maxAsksPerHour: this.config.maxAsksPerHour,
      minAskIntervalMs: this.config.minAskIntervalMs,
      counts,
      recent: rows.slice(0, size).map(row => this.viewOf(row)),
    }
  }

  /**
   * Settle the open question of one person from the model's report. Only an
   * `asked` row moves; a missing or already-settled row is a no-op.
   * 根据模型的回报收尾一个人的未决询问。只有 asked 状态的行会移动；没有行或已收尾都是空操作。
   * @returns whether a row was settled.
   */
  async settleByModel(personId: string, outcome: ImIntakeSettle, detail?: 'name' | 'contact' | 'both'): Promise<boolean> {
    const intake = this.people.intakeOf(personId)
    if (intake === undefined || intake.status !== 'asked') return false
    const now = this.now()
    await this.people.recordIntake({
      ...intake,
      status: outcome,
      settled_at: now,
      ...(outcome === 'answered' && detail !== undefined ? { outcome: detail } : {}),
    })
    this.logger.info?.(
      `[im:intake] person ${personId} intake ${outcome}`
      + `${detail === undefined ? '' : ` (${detail})`}`
      + ` via im_person_report (${intake.account_id}/${intake.conversation_id})`,
    )
    return true
  }

  /** Whether one observed person is already identifiable enough not to be asked. */
  private identifiable(person: ImPersonView, externalId: string): boolean {
    if (person.identityStatus !== 'unverified') return true
    if (person.aliases.length > 0 || person.bio !== undefined || person.notes !== undefined) return true
    if (normalizeKey(person.displayName) !== normalizeKey(externalId)) return true
    // The automatic provider contact is the raw id; any other contact came from
    // a human and makes the person searchable.
    return person.contacts.some(contact => normalizeKey(contact.value) !== normalizeKey(externalId))
  }

  /** Ask once, or leave an already-asked person to the conversation model. */
  private async askOnce(providerId: string, message: ImMessage, person: ImPersonView | undefined): Promise<void> {
    if (!this.config.enabled) return
    const externalId = message.sender.id.trim()
    if (person === undefined || externalId === '') return
    if (this.people.intakeOf(person.id) !== undefined) return
    if (this.asked.has(person.id) || this.identifiable(person, externalId)) return
    if (this.asking.has(person.id) || !this.allow(providerId, message.accountId)) return
    this.asking.add(person.id)
    try {
      const sent = await this.deliverQuestion(providerId, message)
      if (sent === undefined) return
      this.asked.add(person.id)
      await this.recordAsk(providerId, message, person, sent)
    } finally {
      this.asking.delete(person.id)
    }
  }

  /**
   * Send the fixed question. `undefined` means nothing went out: no intake row
   * is written and a later message may still ask.
   * 发送固定询问。undefined 表示什么都没发出去：不写 intake 行，之后的消息仍可询问。
   */
  private async deliverQuestion(
    providerId: string,
    message: ImMessage,
  ): Promise<ImSendResult | undefined> {
    try {
      return await this.send({
        accountId: message.accountId,
        conversationId: message.conversationId,
        text: STRANGER_INTAKE_ASK,
      })
    } catch (error: unknown) {
      this.logger.error(
        `[im:${providerId}] stranger intake could not ask ${message.accountId}/${message.conversationId}: ${errorMessage(error)}`,
      )
      return undefined
    }
  }

  /**
   * Record one sent question. The question did go out, so the in-memory guard
   * stays even when the write fails: there will be no second question.
   * 记录一次已发出的询问。询问已经发出，即使写入失败进程内闸门也保留：不会再问第二次。
   */
  private async recordAsk(
    providerId: string,
    message: ImMessage,
    person: ImPersonView,
    sent: ImSendResult,
  ): Promise<void> {
    try {
      await this.people.recordIntake({
        person_id: person.id,
        provider: providerId,
        account_id: message.accountId,
        conversation_id: message.conversationId,
        status: 'asked',
        asked_at: this.now(),
        ask_message_id: sent.id,
        ask_text: STRANGER_INTAKE_ASK,
      })
    } catch (error: unknown) {
      this.logger.error(
        `[im:${providerId}] stranger intake was sent but not recorded for person ${person.id}: ${errorMessage(error)}`,
      )
    }
    this.logger.info?.(
      `[im:${providerId}] stranger intake asked ${message.accountId}/${message.conversationId}`
      + ` (message ${sent.id}): ${STRANGER_INTAKE_ASK}`,
    )
  }

  /** Reserve one send slot under the per-account sliding-hour cap. */
  private allow(providerId: string, accountId: string): boolean {
    const now = this.now()
    const recent = (this.askTimes.get(accountId) ?? []).filter(at => now - at < HOUR_MS)
    this.askTimes.set(accountId, recent)
    if (recent.length >= Math.max(1, this.config.maxAsksPerHour)) {
      this.logger.warn(`[im:${providerId}] stranger intake skipped for ${accountId}: hourly cap reached`)
      return false
    }
    const last = recent[recent.length - 1]
    if (last !== undefined && now - last < this.config.minAskIntervalMs) {
      this.logger.warn(`[im:${providerId}] stranger intake skipped for ${accountId}: minimum interval not elapsed`)
      return false
    }
    // Reserve synchronously before the send await so two conversations cannot
    // both observe the same free slot.
    // 在 send await 之前同步预留，两个会话不会同时看到同一个空位。
    recent.push(now)
    return true
  }

  /** Per-status tally used by the audit view. */
  private countsOf(rows: ImPersonIntakeRow[]): Record<ImIntakeRecordView['status'], number> {
    const counts: Record<ImIntakeRecordView['status'], number> = { asked: 0, answered: 0, declined: 0, expired: 0 }
    for (const row of rows) counts[this.effectiveStatus(row)] += 1
    return counts
  }

  /** Effective status, treating an overdue `asked` as expired for display. */
  private effectiveStatus(row: ImPersonIntakeRow): ImIntakeRecordView['status'] {
    if (row.status !== 'asked') return row.status
    return this.now() > row.asked_at + this.config.replyWindowMs ? 'expired' : 'asked'
  }

  /** Project one row and its person onto the audit view. */
  private viewOf(row: ImPersonIntakeRow): ImIntakeRecordView {
    const person = this.people.person(row.person_id)
    return {
      personId: row.person_id,
      personName: person?.displayName ?? row.person_id,
      ...(person?.claimedName === undefined ? {} : { claimedName: person.claimedName }),
      status: this.effectiveStatus(row),
      provider: row.provider,
      accountId: row.account_id,
      conversationId: row.conversation_id,
      askedAt: row.asked_at,
      askMessageId: row.ask_message_id,
      askText: row.ask_text,
      expiresAt: row.asked_at + this.config.replyWindowMs,
      ...(row.settled_at === undefined ? {} : { settledAt: row.settled_at }),
      ...(row.outcome === undefined ? {} : { outcome: row.outcome }),
      ...(row.reply_message_id === undefined ? {} : { replyMessageId: row.reply_message_id }),
      ...(row.reply_excerpt === undefined ? {} : { replyExcerpt: row.reply_excerpt }),
    }
  }
}

/** Normalize text for one-line log-safe comparison. */
function normalizeKey(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase()
}
