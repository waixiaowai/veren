/**
 * 路由席位：`opencode-go` 路由的占有与自愈。
 * 同一进程里插件可能被加载两次（组合 patch 行与 profile include 行是两份
 * 模块实例），后到者必须让位；而让位者要能接管——占有者被卸载（patch 热
 * 重载、整条目重建）时路由随之释放，没有接管的实例就会留下一个"有登录、
 * 没有 provider"的宿主。
 * The route seat: ownership of the `opencode-go` route, and its self-healing.
 * The same process can load this plugin twice (a bundle patch row and a profile
 * include row are two module instances); the later activation must yield — and
 * a yielded activation must still be able to take over, because unloading the
 * owner (a live patch reload, an entry rebuild) releases the route, leaving a
 * host that is signed in yet advertises no provider.
 *
 * @module @veren/opencode-go/route
 */
import type { Context } from '@deepseek-ai/cordis'
import type { LlmAdapter } from '@deepseek-ai/dsh-llm'
import { OPENCODE_GO_PROVIDER } from './catalog.js'

/** 一次席位尝试的可变状态。The mutable state of one seat attempt. */
interface RouteSeat {
  /** 是否仍在装载中（拆卸后为 false，广播不再触发占有）。Whether this plugin is still loaded; a teardown clears it. */
  active: boolean
  /** 本实例持有路由时的释放句柄；undefined 表示不持有。This instance's release handle while it owns the route. */
  release: (() => void) | undefined
  /** 让位诊断是否已记录（每次装载只记一次）。Whether the yield diagnostic was already written (once per load). */
  yielded: boolean
}

/** 路由当前是否已被某个适配器占用。Whether any adapter currently serves the route. */
export function routeServed(ctx: Context): boolean {
  return ctx.llm.listProviders().some((provider) => provider.id === OPENCODE_GO_PROVIDER)
}

/**
 * 占有路由，并在路由重新空出来时再次占有；随插件卸载释放。
 * 每次取得路由（含接管）都调用一次 `onOwned`——登录网关每个进程只能挂
 * 一次，由调用方按需去重。
 * Claims the route and claims it again whenever it becomes free; releases with
 * the plugin. `onOwned` runs on every successful claim (a takeover included) —
 * the sign-in gateway mounts once per process, so the caller dedupes.
 * @param ctx - 插件上下文，提供 `llm` 注册面。The plugin context carrying the `llm` registry.
 * @param adapter - 本实例的适配器。This instance's adapter.
 * @param onOwned - 每次占有成功后执行。Runs after each successful claim.
 */
export function keepRoute(ctx: Context, adapter: LlmAdapter, onOwned: () => void): void {
  const seat: RouteSeat = { active: true, release: undefined, yielded: false }
  const claim = (): void => { claimRoute(ctx, adapter, seat, onOwned) }
  ctx.on('llm/adapters-updated', claim)
  // 该 effect 最后注册 => 最先拆卸：先停用自己，再释放路由，于是释放时
  // 广播的 `llm/adapters-updated` 不会诱发本实例自我重占。
  // Registered last, torn down first: deactivate, then release — so the
  // `llm/adapters-updated` published by our own release cannot re-claim.
  ctx.effect(() => () => {
    seat.active = false
    seat.release?.()
    seat.release = undefined
  }, 'opencode-go:keepRoute')
  claim()
}

/**
 * 一次占有尝试：空闲则注册，被兄弟实例占用则让位（等下一次广播）。
 * One claim attempt: register while free, yield to a sibling instance
 * otherwise (the next broadcast tries again).
 * @param ctx - 插件上下文。The plugin context.
 * @param adapter - 本实例的适配器。This instance's adapter.
 * @param seat - 可变席位状态。The mutable seat state.
 * @param onOwned - 占有成功后的回调。Runs after a successful claim.
 */
function claimRoute(ctx: Context, adapter: LlmAdapter, seat: RouteSeat, onOwned: () => void): void {
  if (!seat.active || seat.release !== undefined) return
  if (routeServed(ctx)) {
    noteYield(ctx, seat)
    return
  }
  try {
    seat.release = ctx.llm.registerAdapter([OPENCODE_GO_PROVIDER], adapter)
  } catch (error) {
    // 让位竞态：检查与注册之间兄弟实例先注册成功。
    // A yield race: a sibling instance registered between the check and this call.
    if ((error as { code?: string }).code !== 'DUPLICATE_ADAPTER') throw error
    noteYield(ctx, seat)
    return
  }
  // 这行日志是"provider 找不到"类问题的判据：接管成功同样会留下它。
  // This log line is the diagnosis for "the provider is missing"; a takeover logs it too.
  ctx.logger.info('opencode-go: claimed the provider route')
  onOwned()
}

/** 记录一次让位（每次装载只记一次，避免每次广播刷日志）。Records one yield (once per load, so broadcasts stay quiet). */
function noteYield(ctx: Context, seat: RouteSeat): void {
  if (seat.yielded) return
  seat.yielded = true
  ctx.logger.info('opencode-go: the provider route is held by another activation of this plugin; waiting to take over')
}
