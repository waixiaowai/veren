/**
 * 编排世界的服务面：world 是工具面与网页网关共用的唯一编排对象。令牌是
 * 带 brand 的字符串（镜像 @veren/core Token 形态）——本包刻意不引入
 * workspace 依赖，保持 path/tarball 安装零摩擦。提供随 ctx.effect 卸载。
 * The orchestration world's service face: the world is the one orchestration
 * object shared by the tool face and the web gateway. The token is a branded
 * string (mirroring the @veren/core Token shape) — this package deliberately
 * avoids workspace dependencies to keep path/tarball installs friction-free.
 * The provision unloads with its ctx.effect.
 *
 * @module @veren/baidu-pan/service
 */
import type { Context } from '@deepseek-ai/cordis'
import type { BaiduPanWorld } from './world.js'

/** brand 标记符号（与 @veren/core 同型的零运行时开销品牌）。The brand marker symbol (zero runtime cost, same shape as @veren/core). */
const TOKEN = Symbol.for('@veren/baidu-pan/token')

/** 编排世界令牌：brand 字符串，cordis 的 provide/get 都认它。The world token: a branded string; cordis provide/get both accept it. */
export type BaiduPanWorldToken = string & { readonly [TOKEN]?: BaiduPanWorld }

/** 令牌常量（服务名即令牌名）。The token constant (the service name is the token name). */
export const BAIDU_PAN_WORLD_TOKEN = 'baiduPanWorld' as BaiduPanWorldToken

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The Baidu Pan orchestration world. / 百度网盘编排世界。 */
    baiduPanWorld: BaiduPanWorld
  }
}

/**
 * 提供编排世界（apply 内调用一次；随插件作用域卸载自动撤销）。
 * Provides the orchestration world (call once in apply; revoked when the
 * plugin scope unloads).
 */
export function provideWorld(ctx: Context, world: BaiduPanWorld): void {
  ctx.effect(() => ctx.provide(BAIDU_PAN_WORLD_TOKEN, world), 'baidu-pan.world')
}

/**
 * 读取编排世界；未提供即响亮失败——misconfiguration fails loud。
 * Reads the orchestration world; absence throws loudly — misconfiguration
 * fails loud.
 */
export function readWorld(ctx: Context): BaiduPanWorld {
  const world = ctx.get(BAIDU_PAN_WORLD_TOKEN) as BaiduPanWorld | undefined
  if (world === undefined) {
    throw new Error(`Value for token ${BAIDU_PAN_WORLD_TOKEN} not found in context`)
  }
  return world
}
