/**
 * The startup trigger's delivery engine. One drive per live runtime instance,
 * every delivery inside `ctx.agents.withoutInitiator`, so a session this plugin
 * creates or wakes can never re-enter the same trigger and start a loop.
 *
 * The per-item actions live in `deliver.ts` and the Session resolution in
 * `agent-driver.ts`; this module owns the latch, the drive loop, and the
 * attempt stamping that make the deliveries safe and observable.
 *
 * 启动触发的投递引擎。每个运行实例只驱动一次，所有投递都在
 * `ctx.agents.withoutInitiator` 内执行，因此本插件拉起/唤醒的会话无法重新触发同一套
 * 逻辑，不会形成无限套娃。逐项动作在 `deliver.ts`，会话解析在 `agent-driver.ts`；
 * 本模块只负责让这些投递安全且可观察的闩锁、驱动循环与尝试盖章。
 * @module @veren/startup-autostart/runtime
 */

import type { Context } from '@deepseek-ai/cordis'
import { deliverItem } from './deliver.ts'
import type { StartupItemRecord, StartupOutcome } from './item.ts'

/** Longest retained failure account, in characters. */
const MAX_DETAIL_LENGTH = 300

/** One item's result from a single drive, for logging and for the trigger report. */
export interface StartupDriveReport {
  readonly id: string
  readonly name: string
  readonly outcome: StartupOutcome
}

/** Render a thrown value as a bounded one-line account. */
function errorText(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  const oneLine = text.replaceAll(/\s+/g, ' ').trim()
  return oneLine.length <= MAX_DETAIL_LENGTH ? oneLine : `${oneLine.slice(0, MAX_DETAIL_LENGTH - 1)}…`
}

/**
 * Owns the one permitted drive and every delivery it performs.
 *
 * The runtime is replaced together with the storage domain it commits into, so
 * "once per process" means once per activated service: an HMR reload arms a
 * fresh drive, and the durable per-item cooldown is what stops a second run
 * from repeating itself inside the cooldown window.
 */
export class StartupRuntime {
  private latched = false
  private requested = false
  private running: Promise<void> | undefined
  private stopping = false

  /**
   * @param ctx - Host services used to create, resume, and enqueue.
   * @param items - current durable items, read fresh at each drive.
   * @param transact - serialize a drive against management writes.
   * @param commit - persist one item's run stamp and outcome.
   */
  constructor(
    private readonly ctx: Context,
    private readonly items: () => readonly StartupItemRecord[],
    private readonly transact: (work: () => Promise<void>) => Promise<void>,
    private readonly commit: (item: StartupItemRecord) => Promise<void>,
  ) {}

  /**
   * Accept the first trigger of this runtime and ignore every later one.
   * Dispatch failures are logged; the trigger never rejects into its caller.
   */
  requestDrive(): void {
    if (this.stopping || this.latched) return
    this.latched = true
    this.requested = true
    this.start()
  }

  /** Stop accepting triggers and drain a running drive before storage closes. */
  async dispose(): Promise<void> {
    this.stopping = true
    // requestDrive reports execution failures itself; teardown only waits.
    await this.running?.catch(() => undefined)
  }

  /**
   * Run exactly one item now, outside any caller's initiator scope.
   *
   * The manual path deliberately ignores the latch: the caller asked for this
   * item, and the cooldown decision belongs to the management operation that
   * checked it. The delivered message is still attributed to no initiator, so a
   * Session woken this way cannot re-enter the trigger.
   * @param item - the item to deliver.
   * @returns the retained outcome of this attempt; failures are recorded, not thrown.
   */
  async runItem(item: StartupItemRecord): Promise<StartupOutcome> {
    return this.ctx.agents.withoutInitiator(async () => this.attempt(item))
  }

  /** Start the drive inside the initiator-free scope, reporting any failure. */
  private start(): void {
    let run: Promise<void>
    try {
      run = this.ctx.agents.withoutInitiator(async () => {
        while (this.requested && !this.stopping) {
          this.requested = false
          await this.transact(async () => { await this.drive() })
        }
      })
    } catch (error: unknown) {
      // Ancestor unloading closes initiator admission before runtime cleanup.
      this.requested = false
      this.ctx.logger.warn(`startup-autostart: the startup trigger did not run: ${errorText(error)}`)
      return
    }
    this.running = run
    void run.catch((error: unknown) => {
      this.ctx.logger.warn(`startup-autostart: the startup trigger stopped: ${errorText(error)}`)
    }).finally(() => { this.running = undefined })
  }

  /**
   * Run every enabled item, stamping each attempt.
   *
   * Nothing here consults the run history: a start is the one event the user
   * asked to act on, and a restart interrupted whatever the previous start set
   * going. A failing item is recorded and logged; it never stops the rest.
   * @returns one report per attempted item.
   */
  private async drive(): Promise<StartupDriveReport[]> {
    const reports: StartupDriveReport[] = []
    const all = this.items()
    const enabled = all.filter(item => item.enabled)
    if (enabled.length === 0) {
      this.ctx.logger.debug(`startup-autostart: ${all.length} item(s) stored, none enabled`)
      return reports
    }
    for (const item of enabled) {
      if (this.stopping) break
      reports.push({ id: item.id, name: item.name, outcome: await this.attempt(item) })
    }
    this.ctx.logger.info(
      `startup-autostart: ran ${reports.length} startup item(s); `
      + `${reports.filter(report => report.outcome.status === 'failed').length} failed`,
    )
    return reports
  }

  /**
   * Deliver one item and stamp the attempt, whatever the result.
   *
   * The stamp records history for the panel and the model; it gates nothing.
   * A failure is contained here so one broken item never stops the others.
   * @param item - the item to deliver.
   * @returns the retained outcome; a failure is recorded rather than thrown.
   */
  private async attempt(item: StartupItemRecord): Promise<StartupOutcome> {
    const startedAt = new Date().toISOString()
    let outcome: StartupOutcome
    try {
      outcome = { status: 'ok', detail: await deliverItem(this.ctx, item, startedAt), at: new Date().toISOString() }
    } catch (error: unknown) {
      outcome = { status: 'failed', detail: errorText(error), at: new Date().toISOString() }
      this.ctx.logger.warn(`startup-autostart: item "${item.name}" (${item.id}) failed: ${outcome.detail}`)
    }
    await this.commit({ ...item, lastRunAt: startedAt, lastOutcome: outcome, runCount: item.runCount + 1 })
    return outcome
  }
}
