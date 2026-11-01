/**
 * The dispatch machinery of the effects core, split from `core.ts` by
 * responsibility (the queue face vs the attempt mechanics). Every rule here
 * is ported from the official dsh-superagent `src/app/effects.ts` (MIT,
 * read-only reference): ordered kinds block behind their oldest row even when
 * it is not yet due; the limit is queried only once ready rows exist; up to
 * 16 due rows plus the running ones enter a cycle; a row runs again only with
 * the latest payload (the write-back is guarded by seq + generation); a
 * `Later` throw re-runs after the initial delay without counting a failure;
 * other failures double from it up to the cap; a shutdown-cut attempt leaves
 * its row untouched.
 *
 * 效果核的派发机构，按职责从 `core.ts` 拆出（队列门面对尝试机构）。这里的每条规则都
 * 移植自官方 dsh-superagent 的 `src/app/effects.ts`（MIT，只读参照）：ordered 类型被自己
 * 最老的行挡住（哪怕没到期）；只有存在就绪行才查询 limit；每轮至多 16 条到期行加在跑行；
 * 行只会带着最新载荷重跑（写回由 seq + generation 把守）；抛 `Later` 按初始延迟重跑且
 * 不计失败；其余失败按上限指数退避；被停机打断的尝试不写回。
 *
 * @module @veren/effects/dispatch
 */

import { Later } from './later.ts'
import type { EffectRow, EffectStorage } from './rows.ts'

/** One registered handler, erased to `never` payloads for internal storage. */
export interface RegisteredHandler {
  readonly run: (payload: never, key: string) => Promise<void>
  readonly limit: () => number
  readonly retry: readonly [number, number]
  readonly ordered: boolean
  readonly quiet: boolean
}

/** One in-flight attempt; `done` is assigned once the attempt promise exists. */
export interface Task {
  readonly kind: string
  readonly key: string
  done: Promise<void>
}

/**
 * What the machinery needs from the queue; `Effects` implements it.
 * / 派发机构向队列要的东西；`Effects` 实现它。
 */
export interface DispatchContext {
  readonly storage: EffectStorage
  readonly now: () => number
  /** Sorted waiting rows of one kind. / 某 kind 按 `seq` 排序的等待行 */
  rowsOf(kind: string): readonly EffectRow[]
  /** Keys of the kind's in-flight attempts. / 某 kind 在跑尝试的 key */
  runningKeysOf(kind: string): ReadonlySet<string>
  /** Enqueue one mutation on the internal chain. / 内部链上排一个变更 */
  chain<T>(work: () => Promise<T>): Promise<T>
  /** Queue-level failure of a kind. / 某 kind 的队列级失败 */
  failed(kind: string, error: unknown): void
  /** Refresh a kind's health snapshot. / 刷新某 kind 的健康快照 */
  report(kind: string): void
  /** A good dispatch of a previously broken kind clears its broken mark. / 此前失败过的 kind 派发成功一次即摘除标记 */
  recover(kind: string): void
  /** Whether the queue is drained. / 队列是否已停机 */
  isStopped(): boolean
  /** Track a spawned attempt. / 登记一次刚启动的尝试 */
  track(task: Task): void
  /** Forget a finished attempt and ask for one more dispatch. / 忘掉已结束的尝试并请求再派发一轮 */
  forget(task: Task): void
}

/** Dispatch one cycle for every handled kind, reporting queue-level failures under their kind. */
export function dispatchAll(ctx: DispatchContext, handlers: ReadonlyMap<string, RegisteredHandler>): void {
  for (const [kind, handler] of handlers) {
    try {
      dispatchKind(ctx, kind, handler)
    } catch (error) {
      ctx.failed(kind, error)
    }
  }
}

export function dispatchKind(ctx: DispatchContext, kind: string, handler: RegisteredHandler): void {
  const now = ctx.now()
  const running = ctx.runningKeysOf(kind)
  const rows = ctx.rowsOf(kind)
  const candidates = handler.ordered
    ? rows.slice(0, 1)
    : rows.filter(row => row.due <= now).slice(0, 16 + running.size)
  const ready = handler.ordered && running.size > 0
    ? []
    : candidates.filter(row => row.due <= now && !running.has(row.key))
  let room = ready.length > 0 ? handler.limit() - running.size : 0
  for (const row of ready) {
    if (room-- <= 0) break
    spawn(ctx, kind, handler, row)
  }
  ctx.recover(kind)
}

/** Spawn one attempt; the task leaves the running set only after its write-back lands. */
function spawn(ctx: DispatchContext, kind: string, handler: RegisteredHandler, row: EffectRow): void {
  const task: Task = { kind, key: row.key, done: Promise.resolve() }
  task.done = attempt(ctx, kind, handler, row)
    .catch((error: unknown) => {
      ctx.failed(kind, error)
    })
    .finally(() => {
      ctx.forget(task)
    })
  ctx.track(task)
}

async function attempt(ctx: DispatchContext, kind: string, handler: RegisteredHandler, row: EffectRow): Promise<void> {
  let failure: { readonly error: unknown } | undefined
  try {
    await handler.run(JSON.parse(row.value) as never, row.key)
  } catch (error) {
    failure = { error }
  }
  await settle(ctx, kind, handler, row, failure)
  if (!ctx.isStopped()) ctx.report(kind)
}

/**
 * Write the attempt's outcome back, guarded by seq + generation so a row
 * replaced or re-queued while running is never overwritten.
 * / 把尝试结果写回，由 seq + generation 把守——运行中被替换或重入队的行绝不会被覆盖。
 */
function settle(
  ctx: DispatchContext,
  kind: string,
  handler: RegisteredHandler,
  row: EffectRow,
  failure: { readonly error: unknown } | undefined,
): Promise<void> {
  return ctx.chain(async () => {
    if (failure === undefined) {
      if (isCurrent(ctx, kind, row)) await ctx.storage.delete(kind, row.key)
      return
    }
    if (ctx.isStopped() || !isCurrent(ctx, kind, row)) return
    await ctx.storage.put(settledRow(ctx, handler, row, failure.error))
  })
}

/** Official backoff rule: `Later` re-runs after the initial delay; other failures double from it up to the cap. */
function settledRow(ctx: DispatchContext, handler: RegisteredHandler, row: EffectRow, error: unknown): EffectRow {
  const delay = error instanceof Later
    ? handler.retry[0]
    : Math.min(handler.retry[1], handler.retry[0] * 2 ** Math.min(row.attempts, 16))
  if (error instanceof Later) return { ...row, due: ctx.now() + delay }
  return { ...row, attempts: row.attempts + 1, error: String(error).slice(0, 1000), due: ctx.now() + delay }
}

/** Whether the stored row is still exactly the one this attempt was dispatched for. */
function isCurrent(ctx: DispatchContext, kind: string, row: EffectRow): boolean {
  const current = ctx.rowsOf(kind).find(stored => stored.key === row.key)
  return current !== undefined && current.seq === row.seq && current.generation === row.generation
}
