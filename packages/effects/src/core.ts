/**
 * The effects core's queue face: a storage-agnostic durable side-effect queue.
 *
 * Semantics are ported from the official dsh-superagent `src/app/effects.ts`
 * (MIT, read-only reference under `deepseek/dsh-superagent`; this file is a
 * rewrite for this repository's rules, not a vendored copy): enqueue inside
 * the caller's transaction with per kind+key coalescing that keeps the queue
 * position and resets attempts; a `Later` throw defers without counting a
 * failure; other failures retry with exponential backoff capped per handler;
 * ordered kinds run one at a time and a failed row holds back its kind; a
 * kind's health errors only after {@link FAILURES_BEFORE_ERROR} consecutive
 * failures of one row. The attempt mechanics live in `dispatch.ts`.
 *
 * Adaptations for a storage-agnostic core (full rationale in the README):
 * the medium is the {@link EffectStorage} port instead of SQLite, so every
 * mutation (enqueue, cancel, and attempt write-backs) runs on one internal
 * FIFO chain to reproduce the official single-threaded read-modify-write
 * ordering over an async backend; the constructor becomes the async
 * `Effects.open` factory that resumes `seq` from the persisted rows; and
 * health snapshots go to an {@link EffectHealthSink} instead of the official
 * `HealthBoard`.
 *
 * 效果核的队列门面：存储无关的持久化副作用队列。
 *
 * 语义移植自官方 dsh-superagent 的 `src/app/effects.ts`（MIT，`deepseek/dsh-superagent`
 * 下只读参照；本文件按本仓规范重写，不是 vendor 副本）：调用方事务内入队，同 kind+key
 * 合并覆盖——保留队列位、attempts 清零；抛 `Later` = 暂缓且不计失败；其余失败按各处理器
 * 上限做指数退避；ordered 类型一次跑一条、失败阻塞同类型后续；同一行连续失败
 * {@link FAILURES_BEFORE_ERROR} 次该 kind 才报健康错误。尝试机构在 `dispatch.ts`。
 *
 * 为做成存储无关核所做的适配（完整理由见 README）：介质从 SQLite 换成
 * {@link EffectStorage} 端口，因此所有变更（入队、取消、尝试写回）都跑在一条内部 FIFO
 * 链上，在异步后端上复现官方单线程读改写的次序；构造器变成异步 `Effects.open` 工厂，
 * 从持久化行恢复 `seq`；健康快照交给 {@link EffectHealthSink} 而非官方 `HealthBoard`。
 *
 * @module @veren/effects/core
 */

import { dispatchAll } from './dispatch.ts'
import type { DispatchContext, RegisteredHandler, Task } from './dispatch.ts'
import { brokenSnapshot, FAILURES_BEFORE_ERROR, waitingSnapshot } from './health.ts'
import type { EffectHealthSink } from './health.ts'
import { Later } from './later.ts'
import type { EffectPayloadMap, EffectRow, EffectStorage, HandlerOptions } from './rows.ts'

/** Queue construction options (the official constructor's `now` parameter plus a health sink). */
export interface EffectsOptions {
  /** Deterministic clock injection, as in the official constructor. */
  readonly now?: () => number
  /** Receives one snapshot per report; absent means no health reporting. */
  readonly health?: EffectHealthSink
}

/**
 * The durable side-effect queue. Open one per storage medium with
 * {@link Effects.open}, register one handler per kind with `handle`, and
 * enqueue rows inside the caller's transaction with `enqueue`.
 * / 持久化副作用队列。用 {@link Effects.open} 在一个介质上开一条队列，`handle` 给每种
 * kind 注册一个处理器，`enqueue` 在调用方事务内入队。
 */
export class Effects<P extends EffectPayloadMap = EffectPayloadMap> implements DispatchContext {
  private readonly handlers = new Map<string, RegisteredHandler>()
  private readonly tasks = new Set<Task>()
  /** Kinds whose last dispatch failed; the next successful dispatch of the kind refreshes their health. */
  private readonly broken = new Set<string>()
  /** Tail of the internal mutation chain; every link settles so reads stay consistent. */
  private chainTail: Promise<unknown> = Promise.resolve()
  private seq = 0
  private scheduled = false
  /** Rows queued before `start` wait, such as while setup is incomplete. */
  private started = false
  private stopped = false

  private constructor(
    readonly storage: EffectStorage,
    private readonly clock: () => number,
    private readonly health: EffectHealthSink | undefined,
  ) {}

  /**
   * Open a queue over `storage`, resuming `seq` past every persisted row so
   * rows enqueued after a restart sort behind the ones that waited.
   * / 在 `storage` 上开一条队列，`seq` 从全部持久化行之后续号，重启后新入队的行排在
   * 等待行后面。
   */
  static async open<PP extends EffectPayloadMap = EffectPayloadMap>(
    storage: EffectStorage,
    options: EffectsOptions = {},
  ): Promise<Effects<PP>> {
    const effects = new Effects<PP>(storage, options.now ?? Date.now, options.health)
    for (const row of await storage.load()) effects.seq = Math.max(effects.seq, row.seq)
    return effects
  }

  /**
   * Upsert one effect inside the caller's transaction, coalescing with any
   * waiting row of the same kind and key while keeping its queue position
   * (payload replaced, attempts reset, due now, generation bumped).
   * / 在调用方事务内 upsert 一条效果；与同 kind+key 的等待行合并覆盖——载荷替换、
   * attempts 清零、due 归零、generation 自增，但保留队列位。
   */
  enqueue<K extends keyof P & string>(kind: K, key: string, payload: P[K]): Promise<void> {
    return this.chain(() => this.enqueueLink(kind, key, JSON.stringify(payload)))
  }

  private async enqueueLink(kind: string, key: string, value: string): Promise<void> {
    const current = this.rowOf(kind, key)
    const row: EffectRow = current === undefined
      ? { kind, key, value, seq: ++this.seq, generation: 0, attempts: 0, due: this.clock(), error: '' }
      : { ...current, value, generation: current.generation + 1, attempts: 0, error: '', due: this.clock() }
    await this.storage.put(row)
    this.kick()
  }

  /**
   * Register the one handler of a kind; a second registration is a caller
   * bug and fails loud.
   * / 注册一种 kind 的唯一处理器；重复注册是调用方缺陷，fail loud。
   */
  handle<K extends keyof P & string>(
    kind: K,
    run: (payload: P[K], key: string) => Promise<void>,
    options: HandlerOptions = {},
  ): void {
    if (this.handlers.has(kind)) throw new Error(`The ${kind} effects already have a handler`)
    const { limit = () => 1, retry = [2000, 60_000], ordered = false, quiet = false } = options
    this.handlers.set(kind, { run, limit: ordered ? () => Math.min(1, limit()) : limit, retry, ordered, quiet })
    this.report(kind)
    this.kick()
  }

  /** Whether any row of the kind (optionally of the key) is waiting. */
  pending(kind: string, key?: string): boolean {
    return key === undefined ? this.rowsOf(kind).length > 0 : this.rowOf(kind, key) !== undefined
  }

  /**
   * Drop the queued row; if an attempt is already running, that attempt
   * finishes normally — its write-back is guarded by seq + generation.
   * / 丢掉排队中的行；已在跑的那次尝试会正常跑完——写回由 seq + generation 把守。
   */
  cancel(kind: string, key: string): Promise<void> {
    return this.chain(async () => {
      await this.storage.delete(kind, key)
      this.report(kind)
    })
  }

  /** Begin dispatching; rows queued earlier start now. */
  start(): void {
    this.started = true
    this.kick()
  }

  /** Ask for one dispatch cycle on the next microtask; idempotent while one is scheduled. */
  kick(): void {
    if (this.scheduled) return
    this.scheduled = true
    queueMicrotask(() => {
      this.scheduled = false
      this.dispatch()
    })
  }

  /** Resolves once no effect of the kind (or of any kind) is running. */
  async idle(kind?: string): Promise<void> {
    for (;;) {
      this.dispatch()
      const running = [...this.tasks].filter(task => kind === undefined || task.kind === kind).map(task => task.done)
      if (running.length === 0) return
      await Promise.allSettled(running)
    }
  }

  /**
   * Stop starting new effects and wait for running ones; waiting rows remain
   * in storage for the next start, and a shutdown-cut attempt's row is left
   * untouched so it retries on the next start.
   * / 停止启动新效果并等待在跑的；等待行留在存储里等下一次 start，被停机打断的尝试
   * 不写回，下次 start 重跑。
   */
  async drain(): Promise<void> {
    this.stopped = true
    await Promise.allSettled([...this.tasks].map(task => task.done))
  }

  private dispatch(): void {
    if (!this.started || this.stopped) return
    dispatchAll(this, this.handlers)
  }

  /** @internal DispatchContext: the machinery's view of the queue. */
  now(): number {
    return this.clock()
  }

  rowsOf(kind: string): readonly EffectRow[] {
    return [...this.storage.list(kind)].sort((one, other) => one.seq - other.seq)
  }

  /** @internal DispatchContext. */
  runningKeysOf(kind: string): ReadonlySet<string> {
    return new Set([...this.tasks].filter(task => task.kind === kind).map(task => task.key))
  }

  /** @internal DispatchContext. */
  chain<T>(work: () => Promise<T>): Promise<T> {
    const pending = this.chainTail.then(work, work)
    this.chainTail = pending.then(() => undefined, () => undefined)
    return pending
  }

  /** @internal DispatchContext: a queue-level failure marks the kind broken until its next good dispatch. */
  failed(kind: string, error: unknown): void {
    this.broken.add(kind)
    this.health?.set(kind, brokenSnapshot(error, this.instant()))
  }

  /** @internal DispatchContext. */
  report(kind: string): void {
    if (this.health === undefined || !this.handlers.has(kind)) return
    const handler = this.handlers.get(kind)
    this.health.set(kind, waitingSnapshot(this.rowsOf(kind), handler?.quiet ?? false, this.instant()))
  }

  /** @internal DispatchContext: the first good dispatch of a broken kind refreshes its health. */
  recover(kind: string): void {
    if (this.broken.delete(kind)) this.report(kind)
  }

  /** @internal DispatchContext. */
  isStopped(): boolean {
    return this.stopped
  }

  /** @internal DispatchContext. */
  track(task: Task): void {
    this.tasks.add(task)
  }

  /** @internal DispatchContext. */
  forget(task: Task): void {
    this.tasks.delete(task)
    this.kick()
  }

  private rowOf(kind: string, key: string): EffectRow | undefined {
    return this.storage.list(kind).find(row => row.key === key)
  }

  private instant(): string {
    return new Date(this.clock()).toISOString()
  }
}

/** 语义出处：官方 Later 信号原样重导出 / the official Later signal, re-exported verbatim */
export { Later, FAILURES_BEFORE_ERROR }
