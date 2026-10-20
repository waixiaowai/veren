/**
 * Automatic stranger intake: ask once, read only a clearly stated answer, and
 * keep the self-report separate from verified identity.
 *
 * The question is sent to the stranger, never to the user. A person is asked at
 * most once; a burst of messages cannot trigger a second question. The reply is
 * parsed by a deliberately narrow, deterministic extractor: a whole-line name, a
 * small set of explicit self-introduction prefixes, or an unmistakable contact
 * pattern. Anything else is abandoned at the end of the reply window instead of
 * being guessed into the directory.
 *
 * 自动陌生人采集：只问一次，只读取明确说出的回答，并把自述与已核实身份分开保存。
 *
 * 询问发给陌生人，而不是用户。每个人最多问一次；连发多条也不会触发第二次询问。回复由刻意
 * 狭窄、确定性的提取器解析：整行姓名、少量明确的自述前缀，或不会认错的联系方式格式。其余内容
 * 在回复窗口结束时放弃，绝不猜着写进名单。
 *
 * @module @veren/im/intake
 */

import type { ImMessage, ImMessageContent, ImSendResult } from './contract.ts'
import type { ImLogger } from './bindings.ts'
import type { ImPeople, ImPersonView } from './people.ts'
import type { ImIntakeStatus, ImPersonIntakeRow } from './store.ts'
import { comparisonKey, isOptOut, oneLine, parseSelfReport } from './intake-parser.ts'

export { parseSelfReport } from './intake-parser.ts'
export type { ParsedSelfReport } from './intake-parser.ts'

/** One switch and its safety bounds. */
export interface ImStrangerIntakeConfig {
  /** The total switch. `false` sends nothing and records nothing. */
  enabled: boolean
  /** How long after the question a reply is still considered an answer. */
  replyWindowMs: number
  /** Per-account cap across a sliding hour; 0 is treated as 1. */
  maxAsksPerHour: number
  /** Minimum gap between two questions from one account. */
  minAskIntervalMs: number
}

/** Defaults used by the plugin config and by direct router construction. */
export const STRANGER_INTAKE_DEFAULTS: ImStrangerIntakeConfig = {
  enabled: true,
  replyWindowMs: 120_000,
  maxAsksPerHour: 10,
  minAskIntervalMs: 10_000,
}

/**
 * The one question. It asks only for a form of address and a contact method,
 * states that declining is fine, and makes no promise the host cannot keep.
 * 唯一的一条询问：只问怎么称呼和联系方式，说明不方便也没关系，不承诺做不到的事。
 */
export const STRANGER_INTAKE_ASK = '你好，我们好像还没认识过。请问怎么称呼你？方便的话再留个联系方式，我记一下，以后好找你，不方便也没关系。'

/** One intake record as the status tool shows it. */
export interface ImIntakeRecordView {
  personId: string
  personName: string
  claimedName?: string
  status: ImIntakeStatus
  provider: string
  accountId: string
  conversationId: string
  askedAt: number
  askMessageId: string
  askText: string
  /** Computed from the reply window; useful while `status` is still `asked`. */
  expiresAt: number
  settledAt?: number
  outcome?: 'name' | 'contact' | 'both'
  replyMessageId?: string
  replyExcerpt?: string
}

/** The switch, counts, and a bounded audit window. */
export interface ImIntakeStatusView {
  enabled: boolean
  askText: string
  replyWindowMs: number
  maxAsksPerHour: number
  minAskIntervalMs: number
  counts: Record<ImIntakeStatus, number>
  recent: ImIntakeRecordView[]
}

/** Construction options; the clock, store, and sender are injectable. */
export interface ImStrangerIntakeOptions {
  people: ImPeople
  logger: ImLogger
  /** Send one text to one explicit target. */
  send: (request: { accountId: string; conversationId: string; text: string }) => Promise<ImSendResult>
  config?: Partial<ImStrangerIntakeConfig>
  now?: () => number
}

const MAX_EXCERPT_CHARS = 200
const HOUR_MS = 3_600_000
const RECENT_LIMIT = 100

/** One-line audit excerpt; never lets a reply forge a log section. */
function excerptOf(content: ImMessageContent): string | undefined {
  if (content.type === 'text' || content.type === 'markdown') {
    const text = oneLine(content.text)
    if (text === '') return undefined
    return [...text].slice(0, MAX_EXCERPT_CHARS).join('')
  }
  return content.type === 'image' ? '[image]' : `[file: ${content.name}]`
}

/** Stable message for logs. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * The automatic stranger-intake service. It never routes messages and never
 * asks the model: it sends one fixed question and records the answer.
 * 自动陌生人采集服务。它不路由消息，也不问模型：只发送一条固定询问并记录回答。
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
   * React to one inbound message before it is routed. Failures are logged and
   * contained: directory bookkeeping must not drop the message.
   * 在消息被路由前处理一次入站消息。失败只记日志并吞掉：目录记账不能丢消息。
   * @param providerId - provider that emitted the message.
   * @param message - normalized inbound message.
   * @param person - the sender as just observed, when recording succeeded.
   * @returns nothing; the routing step continues regardless.
   */
  async handle(providerId: string, message: ImMessage, person: ImPersonView | undefined): Promise<void> {
    try {
      await this.handleNow(providerId, message, person)
    } catch (error: unknown) {
      this.logger.error(`[im:${providerId}] stranger intake failed: ${messageOf(error)}`)
    }
  }

  /** Read the switch, counts, and recent audit records. */
  status(limit = 20): ImIntakeStatusView {
    const rows = this.people.intakes().sort((left, right) => right.asked_at - left.asked_at)
    const counts: Record<ImIntakeStatus, number> = { asked: 0, answered: 0, declined: 0, expired: 0 }
    for (const row of rows) counts[this.effectiveStatus(row)] += 1
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

  /** Whether one observed person is already identifiable enough not to be asked. */
  private identifiable(person: ImPersonView, externalId: string): boolean {
    if (person.identityStatus !== 'unverified') return true
    if (person.aliases.length > 0 || person.bio !== undefined || person.notes !== undefined) return true
    if (comparisonKey(person.displayName) !== comparisonKey(externalId)) return true
    // The automatic provider contact is the raw id; any other contact came from
    // a human and makes the person searchable.
    return person.contacts.some(contact => comparisonKey(contact.value) !== comparisonKey(externalId))
  }

  /** Ask once, or interpret the reply to an existing question. */
  private async handleNow(providerId: string, message: ImMessage, person: ImPersonView | undefined): Promise<void> {
    if (!this.config.enabled) return
    const externalId = message.sender.id.trim()
    if (person === undefined || externalId === '') return
    const existing = this.people.intakeOf(person.id)
    if (existing !== undefined) {
      await this.considerReply(providerId, message, person, existing)
      return
    }
    if (this.asked.has(person.id) || this.identifiable(person, externalId)) return
    if (this.asking.has(person.id) || !this.allow(providerId, message.accountId)) return
    this.asking.add(person.id)
    try {
      let sent: ImSendResult
      try {
        sent = await this.send({
          accountId: message.accountId,
          conversationId: message.conversationId,
          text: STRANGER_INTAKE_ASK,
        })
      } catch (error: unknown) {
        // Nothing was sent, so no intake row is written: a later message may ask.
        // 没有发出去，因此不写 intake 行：之后的消息仍可以询问。
        this.logger.error(
          `[im:${providerId}] stranger intake could not ask ${message.accountId}/${message.conversationId}: ${messageOf(error)}`,
        )
        return
      }
      this.asked.add(person.id)
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
        // The question did go out; the in-memory guard prevents a second one.
        // 询问已经发出；进程内闸门防止再问第二次。
        this.logger.error(
          `[im:${providerId}] stranger intake was sent but not recorded for person ${person.id}: ${messageOf(error)}`,
        )
      }
      this.logger.info?.(
        `[im:${providerId}] stranger intake asked ${message.accountId}/${message.conversationId}`
        + ` (message ${sent.id}): ${STRANGER_INTAKE_ASK}`,
      )
    } finally {
      this.asking.delete(person.id)
    }
  }

  /** Interpret one reply against the open question. */
  private async considerReply(
    providerId: string,
    message: ImMessage,
    person: ImPersonView,
    intake: ImPersonIntakeRow,
  ): Promise<void> {
    if (intake.status !== 'asked') return
    const now = this.now()
    const expiresAt = intake.asked_at + this.config.replyWindowMs
    if (now > expiresAt) {
      await this.settle(providerId, intake, 'expired', now)
      return
    }
    const content = message.content
    const text = content.type === 'text' || content.type === 'markdown' ? content.text : undefined
    if (text !== undefined && isOptOut(text)) {
      await this.settle(providerId, intake, 'declined', now)
      return
    }
    const parsed = text === undefined ? undefined : parseSelfReport(text)
    if (parsed === undefined) return
    await this.people.recordClaim(person.id, {
      ...(parsed.name === undefined ? {} : { name: parsed.name }),
      contacts: parsed.contacts,
      provider: providerId,
      accountId: message.accountId,
      conversationId: message.conversationId,
      messageId: message.id,
    })
    const outcome = parsed.name !== undefined && parsed.contacts.length > 0
      ? 'both'
      : parsed.name !== undefined ? 'name' : 'contact'
    const excerpt = excerptOf(content)
    const settled: ImPersonIntakeRow = {
      ...intake,
      status: 'answered',
      settled_at: now,
      outcome,
      reply_message_id: message.id,
      ...(excerpt === undefined ? {} : { reply_excerpt: excerpt }),
    }
    await this.people.recordIntake(settled)
    this.logger.info?.(
      `[im:${providerId}] stranger intake claim recorded for person ${person.id}`
      + ` (${message.accountId}/${message.conversationId}, ${outcome}):`
      + ` name=${parsed.name ?? '-'} contacts=${parsed.contacts.map(contact => contact.value).join(',') || '-'}`,
    )
  }

  /** Move one intake to a terminal state without parsing anything. */
  private async settle(
    providerId: string,
    intake: ImPersonIntakeRow,
    status: 'declined' | 'expired',
    now: number,
  ): Promise<void> {
    await this.people.recordIntake({ ...intake, status, settled_at: now })
    this.logger.info?.(
      `[im:${providerId}] stranger intake for person ${intake.person_id} ${status}`
      + ` (${intake.account_id}/${intake.conversation_id})`,
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

  /** Effective status, treating an overdue `asked` as expired for display. */
  private effectiveStatus(row: ImPersonIntakeRow): ImIntakeStatus {
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
