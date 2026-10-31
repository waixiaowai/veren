/**
 * The in-memory guards of the stranger-intake ask side: the ask-once gate and
 * the per-account sliding-hour rate limiter.
 *
 * Two concurrent conversations cannot ask one person twice, a failed intake
 * write cannot cause a second question after a good send, and one account can
 * absorb only so many questions per hour.
 *
 * 陌生人采集提问侧的进程内闸门：ask-once 闸门与按账号的滑动小时限频器。
 *
 * 两个并发会话不会把同一个人问两遍；intake 写入失败也不会在发送成功后重问；一个账号
 * 每小时只吸收有限次询问。
 *
 * @module @veren/im/intake-gate
 */

import type { ImLogger } from './runtime-seams.ts'
import type { ImPeople } from './people.ts'

const HOUR_MS = 3_600_000
/** Cap for the in-memory ask-once guard; pruned against the durable rows. */
/** 进程内 ask-once 闸门的上限；对照持久化行收缩。 */
const ASKED_CAP = 512

/** The knobs the gate needs from `ImStrangerIntakeConfig`. */
/** 闸门需要的 `ImStrangerIntakeConfig` 旋钮。 */
export interface IntakeGateLimits {
  maxAsksPerHour: number
  minAskIntervalMs: number
}

/**
 * Ask-once plus rate-limit guards for the intake question. Pure bookkeeping:
 * it never sends anything and never touches storage.
 * 采集询问的 ask-once 与限频闸门。纯记账：不发任何东西，也不碰存储。
 */
export class IntakeAskGate {
  private readonly asking = new Set<string>()
  private readonly asked = new Set<string>()
  private readonly askTimes = new Map<string, number[]>()

  /**
   * @param people - the directory, used to prune the ask-once guard.
   * @param logger - warn channel for skipped questions.
   * @param now - the clock.
   */
  constructor(
    private readonly people: ImPeople,
    private readonly logger: ImLogger,
    private readonly now: () => number,
  ) {}

  /** Whether one person is currently mid-ask in another conversation. */
  /** 某个人是否正在另一个会话中被询问。 */
  isBeingAsked(personId: string): boolean {
    return this.asking.has(personId)
  }

  /** Whether one person was already asked in this process lifetime. */
  /** 某个人在本进程生命周期内是否已被问过。 */
  hasBeenAsked(personId: string): boolean {
    return this.asked.has(personId)
  }

  /**
   * Reserve one send slot under the per-account sliding-hour cap.
   * 在按账号的滑动小时上限下预留一个发送槽位。
   */
  reserveSlot(providerId: string, accountId: string, limits: IntakeGateLimits): boolean {
    const now = this.now()
    const recent = (this.askTimes.get(accountId) ?? []).filter(at => now - at < HOUR_MS)
    // 空槽位直接删键，Map 不随账号数无界增长。
    // An empty slot deletes the key, so the map never grows with the account count.
    if (recent.length === 0) this.askTimes.delete(accountId)
    else this.askTimes.set(accountId, recent)
    if (recent.length >= Math.max(1, limits.maxAsksPerHour)) {
      this.logger.warn(`[im:${providerId}] stranger intake skipped for ${accountId}: hourly cap reached`)
      return false
    }
    const last = recent[recent.length - 1]
    if (last !== undefined && now - last < limits.minAskIntervalMs) {
      this.logger.warn(`[im:${providerId}] stranger intake skipped for ${accountId}: minimum interval not elapsed`)
      return false
    }
    // Reserve synchronously before the send await so two conversations cannot
    // both observe the same free slot.
    // 在 send await 之前同步预留，两个会话不会同时看到同一个空位。
    recent.push(now)
    this.askTimes.set(accountId, recent)
    return true
  }

  /** Enter the mid-ask section for one person. */
  /** 进入某人「询问中」区段。 */
  beginAsk(personId: string): void {
    this.asking.add(personId)
  }

  /** Leave the mid-ask section for one person (always, success or not). */
  /** 离开某人「询问中」区段（无论成败）。 */
  endAsk(personId: string): void {
    this.asking.delete(personId)
  }

  /** Record that one person's question did go out. */
  /** 记录某人的询问确实已发出。 */
  markAsked(personId: string): void {
    this.asked.add(personId)
  }

  /**
   * Shrink the in-memory ask-once guard: every id with a durable intake row is
   * already re-derivable from storage (the row check runs first in askOnce), so
   * only write-failure survivors need to stay in memory.
   * 收缩进程内 ask-once 闸门：有持久化行的 id 已可从存储再推导（askOnce 的第一道检查），
   * 内存里只需保留写入失败的幸存者。
   */
  pruneAsked(): void {
    if (this.asked.size <= ASKED_CAP) return
    for (const id of this.asked) {
      if (this.people.intakeOf(id) !== undefined) this.asked.delete(id)
    }
  }
}
