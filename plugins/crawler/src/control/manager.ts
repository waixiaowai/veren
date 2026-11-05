/**
 * 采集任务管理器：全局单任务互斥 + 状态推进 + 停止超时强杀
 * （design/modules/api.md §2–§3）。
 * The crawl task manager: global single-task mutual exclusion, state
 * progression, and stop with timeout force-kill (design api.md §2–§3).
 *
 * 与采集内核的唯一耦合是进程句柄抽象——本模块不导入内核代码。
 * The only coupling to the crawl kernel is the process-handle abstraction —
 * this module never imports kernel code.
 *
 * @module @veren/crawler/control/manager
 */
import { CrawlerError } from '../errors.ts'
import { transition } from '../task/state.ts'
import { LogBuffer } from './logs.ts'
import type { CrawlerRunRequest, RunnerHandle, RunnerSpawner } from './runner.ts'
import type { CrawlerStatus } from './status.ts'
import { initialStatus } from './status.ts'

/** 停止限时等待（毫秒，design 未定值，取 15 秒）/ the stop grace window (ms; value unspecified in design, 15s chosen) */
export const STOP_TIMEOUT_MS = 15_000

/**
 * 一场采集的结局：退出码与起止时刻，供完成通知等观察者消费。
 * One crawl run's outcome: exit code and timing, consumed by observers
 * such as the completion notice.
 */
export interface CrawlerRunOutcome {
  /** 采集平台 / the platform */
  readonly platform: string
  /** 采集模式 / the crawling mode */
  readonly crawlerType: string
  /** 启动时刻（ISO）/ the start time (ISO) */
  readonly startedAt: string
  /** 结束时刻（ISO）/ the finish time (ISO) */
  readonly finishedAt: string
  /** 退出码 / the exit code */
  readonly exitCode: number
  /** 是否正常结束（退出码 0；用户主动停止不产生结局回调）/ whether it ended normally (exit 0; user stops never reach the observer) */
  readonly ok: boolean
}

/** 管理器选项：停止限时与结局观察者可注入（测试/通知）/ manager options: the stop window and the outcome observer are injectable (tests / notices) */
export interface CrawlerManagerOptions {
  /** 停止限时等待毫秒 / the stop grace window in ms */
  stopTimeoutMs?: number
  /** 结局观察者（完成通知）；实现不得抛出 / the outcome observer (completion notice); the implementation must not throw */
  onFinished?: (outcome: CrawlerRunOutcome) => Promise<void>
}

/**
 * 采集任务管理器（进程内单例）。
 * The crawl task manager (in-process singleton).
 */
export class CrawlerManager {
  private statusValue: CrawlerStatus = initialStatus()
  private handle: RunnerHandle | null = null
  readonly logs = new LogBuffer()
  private readonly stopTimeoutMs: number
  private readonly onFinished: ((outcome: CrawlerRunOutcome) => Promise<void>) | undefined
  private spawnRunner: RunnerSpawner

  constructor(spawner: RunnerSpawner, options: CrawlerManagerOptions = {}) {
    this.spawnRunner = spawner
    this.stopTimeoutMs = options.stopTimeoutMs ?? STOP_TIMEOUT_MS
    this.onFinished = options.onFinished
  }

  /** 运行器热替换：`dsh` 介质需要进程内运行器（存储域就绪后装配）/ hot-swap the runner: the `dsh` medium needs the in-process runner assembled once the storage domain is open */
  swapRunner(spawner: RunnerSpawner): void {
    if (this.statusValue.status !== 'idle') {
      throw new CrawlerError('CRAWLER_ALREADY_RUNNING', '仅空闲时可更换运行器', { status: this.statusValue.status })
    }
    this.spawnRunner = spawner
  }

  /** 当前状态快照 / the current status snapshot */
  status(): CrawlerStatus {
    return { ...this.statusValue }
  }

  /**
   * 启动采集任务：运行中/启动中重复启动拒绝（单任务互斥）。
   * Starts a crawl task; a duplicate start while running/starting is
   * rejected (single-task mutual exclusion).
   */
  async start(req: CrawlerRunRequest): Promise<{ status: 'started' | 'rejected'; message: string }> {
    const current = this.statusValue.status
    if (current === 'running' || current === 'starting') {
      return { status: 'rejected', message: '已有采集任务在运行，请先停止' }
    }
    if (this.statusValue.status === 'error') transition(this.statusValue.status, 'idle')
    return await this.launch(req)
  }

  /** 实际拉起子进程并推进 starting → running / actually spawn and progress starting → running */
  private async launch(req: CrawlerRunRequest): Promise<{ status: 'started' | 'rejected'; message: string }> {
    this.statusValue = {
      status: transition(this.statusValue.status, 'starting'),
      platform: req.platform,
      crawlerType: req.crawlerType,
      startedAt: new Date().toISOString(),
      errorMessage: null,
    }
    try {
      this.handle = this.spawnRunner(req, this.logs)
      void this.watchExit(this.handle, req)
    } catch (error) {
      this.statusValue = { ...this.statusValue, status: 'idle', errorMessage: String(error) }
      return { status: 'rejected', message: `启动失败: ${String(error)}` }
    }
    this.statusValue = { ...this.statusValue, status: transition('starting', 'running') }
    return { status: 'started', message: '已启动' }
  }

  /** 监视退出：非零退出置 error 态并保留错误信息；结局通知观察者（用户主动停止除外） / watch exit: a nonzero exit marks error and keeps the message; the outcome observer fires except on user stops */
  private async watchExit(handle: RunnerHandle, request: CrawlerRunRequest): Promise<void> {
    const code = await handle.exit
    if (this.handle !== handle) return
    this.handle = null
    if (this.statusValue.status === 'stopping') {
      this.statusValue = { ...this.statusValue, status: transition('stopping', 'idle') }
      return
    }
    this.statusValue = {
      ...this.statusValue,
      status: code === 0 ? transition('running', 'idle') : transition('running', 'error'),
      errorMessage: code === 0 ? null : `采集进程异常退出，退出码 ${code}`,
    }
    void this.onFinished?.({
      platform: request.platform,
      crawlerType: request.crawlerType,
      startedAt: this.statusValue.startedAt ?? new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      exitCode: code,
      ok: code === 0,
    }).catch(() => undefined)
  }

  /**
   * 停止运行中任务：终止信号 + 限时等待，超时强杀；空闲时返回未运行。
   * Stops the running task: terminate, bounded wait, force-kill on
   * timeout; returns not_running when idle.
   */
  async stop(): Promise<{ status: 'stopped' | 'not_running'; message: string }> {
    if (this.handle === null || this.statusValue.status !== 'running') {
      return { status: 'not_running', message: '没有运行中的采集任务' }
    }
    this.statusValue = { ...this.statusValue, status: transition('running', 'stopping') }
    const handle = this.handle
    handle.terminate()
    const winner = await Promise.race([
      handle.exit.then(() => 'exited'),
      sleepMs(this.stopTimeoutMs).then(() => 'timeout'),
    ])
    if (winner === 'timeout') handle.kill()
    // 强杀后只给一个短暂收尾窗口：句柄实现若不兑现 exit 承诺也不无限等。
    // After the kill, wait only a short grace: a handle that never fulfils
    // its exit promise cannot hang the manager.
    await Promise.race([handle.exit.catch(() => undefined), sleepMs(1000)])
    if (this.statusValue.status === 'stopping') {
      this.statusValue = { ...this.statusValue, status: transition('stopping', 'idle') }
    }
    return { status: 'stopped', message: '已停止' }
  }

  /** 人工复位 error → idle（排查后重新就绪）/ the manual reset error → idle (ready after triage) */
  reset(): void {
    if (this.statusValue.status === 'error') {
      this.statusValue = { ...initialStatus() }
      return
    }
    throw new CrawlerError('CRAWLER_NOT_RUNNING', `当前状态 ${this.statusValue.status} 无需复位`, {})
  }
}

/** 毫秒休眠 / sleep for ms */
function sleepMs(ms: number): Promise<'timeout'> {
  return new Promise((resolve) => setTimeout(() => resolve('timeout'), ms))
}
