/**
 * 采集调度器：到点就跑，跑过就不重复跑。
 *
 * 判定很简单——当前本地时刻过了配置的采集时刻，且今天还没采过，就采一次。
 * 幂等靠采集账（存储里当天那条记录），因此**重启不会重采**，手动补采也不
 * 会被调度器顶掉。
 *
 * The pull scheduler: fires when due, never twice for the same day.
 *
 * The decision is simple — once the local clock passes the configured pull
 * time and today has no pull yet, pull once. The idempotency rests on the
 * pull ledger (that day's row in storage), so a **restart does not re-pull**
 * and a manual catch-up pull is not overwritten by the scheduler.
 *
 * @module @veren/zhihu-ops/schedule/runner
 */
import type { Context } from '@deepseek-ai/cordis'
import type { PullOutcome } from '../collect/pull.ts'
import { dayKey } from '../collect/day.ts'

/** 调度器用到的面 / the faces the scheduler uses */
export interface SchedulerFaces {
  /** 跑一次采集 / runs one pull */
  readonly pull: () => Promise<PullOutcome>
  /** 今天是否已经采过 / whether today was already pulled */
  readonly pulledOn: (day: string) => boolean
  /** 钟面来源 / the clock source */
  readonly now: () => Date
}

/** 调度器的配置 / the scheduler configuration */
export interface SchedulerOptions {
  /** 每日采集时刻（本地 HH:mm）/ the daily pull time (local HH:mm) */
  readonly pullLocalTime: string
  /** 检查间隔（毫秒）/ how often to check (ms) */
  readonly tickMs: number
}

/** 时刻比较用的小时与分钟 / the hour and minute used for the time comparison */
interface HourMinute {
  readonly hour: number
  readonly minute: number
}

/**
 * 把 `HH:mm` 解析成小时与分钟；解析失败响亮失败。
 * Parses `HH:mm` into an hour and a minute; a parse failure fails loudly.
 *
 * @param text - the configured time / 配置的时刻
 * @returns the hour and minute / 小时与分钟
 */
export function parseHourMinute(text: string): HourMinute {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(text)
  if (match === null) {
    throw new Error(`[zhihu-ops] pullLocalTime must be HH:mm, got "${text}"`)
  }
  return { hour: Number.parseInt(match[1] ?? '0', 10), minute: Number.parseInt(match[2] ?? '0', 10) }
}

/**
 * 采集调度器。
 * The pull scheduler.
 */
export class PullScheduler {
  private readonly host: Context
  private readonly faces: SchedulerFaces
  private readonly options: SchedulerOptions
  private timer: (() => void) | undefined
  private ticking = false

  /**
   * @param host - the host context (only `effect` and `logger` are used) / 宿主上下文
   * @param faces - the pull faces / 采集用到的面
   * @param options - the scheduler configuration / 调度器配置
   */
  constructor(host: Context, faces: SchedulerFaces, options: SchedulerOptions) {
    this.host = host
    this.faces = faces
    this.options = options
  }

  /** 开始检查；幂等，第二次调用保留第一个计时器 / starts checking; idempotent, a second call keeps the first timer */
  start(): void {
    if (this.timer !== undefined) return
    this.timer = this.host.effect(() => {
      const handle = globalThis.setInterval(() => { void this.tick() }, this.options.tickMs)
      return () => { globalThis.clearInterval(handle) }
    }, 'zhihu-ops:pull-schedule')
  }

  /** 停止检查 / stops checking */
  stop(): void {
    this.timer?.()
    this.timer = undefined
  }

  /** 是否到了该采集的时候 / whether it is time to pull */
  isDue(): boolean {
    const now = this.faces.now()
    const target = parseHourMinute(this.options.pullLocalTime)
    const minutesNow = now.getHours() * 60 + now.getMinutes()
    if (minutesNow < target.hour * 60 + target.minute) return false
    return !this.faces.pulledOn(dayKey(now))
  }

  /**
   * 一个检查节拍：到点且今天没采过，就采一次。
   * One check tick: pull once when it is due and today has no pull yet.
   */
  async tick(): Promise<void> {
    if (this.ticking || !this.isDue()) return
    this.ticking = true
    try {
      const outcome = await this.faces.pull()
      this.host.logger.info(`zhihu-ops: pulled ${outcome.day} (${outcome.state}, ${outcome.requestCount} request(s))`)
    } catch (error: unknown) {
      this.host.logger.warn(`zhihu-ops: the pull failed: ${String(error)}`)
    } finally {
      this.ticking = false
    }
  }
}
