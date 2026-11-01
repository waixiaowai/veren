/**
 * The `Later` signal of the effects core, ported from the official
 * `src/app/effects.ts` (MIT, read-only reference). It lives in its own module
 * so the dispatch machinery and the queue face can both import it without a
 * cycle.
 *
 * 效果核的 `Later` 信号，移植自官方 `src/app/effects.ts`（MIT，只读参照）。单独成模块，
 * 派发机构与队列门面都能引用而不成环。
 *
 * @module @veren/effects/later
 */

/**
 * Signals that an effect cannot run right now (no delivery target, all worker
 * slots full…); the row re-runs after the handler's initial retry delay
 * without counting a failure.
 * / 表示效果当下跑不了（没有投递目标、工作槽占满……）；行在处理器的初始重试延迟后
 * 重跑，不计失败。
 */
export class Later extends Error {}
