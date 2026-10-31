/**
 * 装配期绑定的模块级 ctx 槽位：组件体的同步读、工具构建器与结算看守，以及
 * 首屏的异步读都从这里取本插件的 ctx。注册一定先于任何页面打开；未绑定即取
 * = 装配错误 fail loud。
 * The module-level ctx slot bound at assembly time: the bodies' sync reads, the
 * tool builders, the settlement watch, and the first screen's async reads all
 * take this plugin's ctx from here. Registration always precedes any page open;
 * reading unbound is an assembly error and fails loud.
 * @module @veren/person-agent-app
 */
import type { Context } from '@deepseek-ai/cordis'

let appCtx: Context | undefined

/** 装配时绑定（index.ts 的单入口注册调用一次）/ bind at assembly time (called once by index.ts's wiring) */
export function bindPersonAgentContext(ctx: Context): void {
  appCtx = ctx
}

/** 取绑定的 ctx；未绑定 = 装配错误 fail loud / read the bound ctx; unbound = assembly error, fail loud */
export function requireCtx(): Context {
  if (appCtx === undefined) {
    throw new Error('[person-agent-app] the app ctx is not bound; the app wiring must run before pages open')
  }
  return appCtx
}
