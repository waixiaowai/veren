/**
 * @deepseek-ai/dsh-graph-tools —— 把 flow 引擎暴露成模型可见的内置工具。
 *
 * @deepseek-ai/dsh-graph-tools — expose the flow engine as model-facing built-in tools.
 *
 * 插件入口：注册 graph_list / graph_run / graph_status 三个工具。依赖两项能力：
 * DSH 工具注册表（ctx.tools，dsh-tools 提供）与 flow 引擎（FlowEngineToken，
 * @deepseek-ai/dsh-graph-flow-engine 提供）。每个注册走 ctx.effect，随 fiber 逆序注销。
 * The plugin entry: register the graph_list / graph_run / graph_status tools. It
 * requires two capabilities — the DSH tool registry (ctx.tools, provided by
 * dsh-tools) and the flow engine (FlowEngineToken, provided by
 * @deepseek-ai/dsh-graph-flow-engine). Every registration goes through ctx.effect, so it
 * unregisters in reverse order with the fiber.
 */

import type { Context } from '@deepseek-ai/cordis'
// 类型-only import：只为拉取 dsh-tools 的 declaration merge（ctx.tools 类型面）
// Type-only import: pulls in the dsh-tools declaration merge (the ctx.tools type surface).
import type { } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'
import { getOrThrow } from '@veren/core'
import { FlowEngineToken } from '@deepseek-ai/dsh-graph-flow-engine'
import { createGraphTools } from './tools.js'

export { createGraphTools } from './tools.js'
export type { FlowRunStatus, GraphFlowItem, GraphListPayload, GraphNodeItem, GraphRunPayload } from './types.js'

/** 插件配置 / the plugin config */
export interface Config {
    /** graph_run 等待运行完成的上限（毫秒）；到点返回 running，运行继续、用 graph_status 轮询 /
        the graph_run wait budget in ms; on expiry it returns "running" and the run keeps going — poll with graph_status */
    runTimeoutMs: number
}

/** 插件配置 schema（@deepseek-ai/schemastery）/ the plugin config schema */
export const Config: z<Config> = z.object({ runTimeoutMs: z.number().min(0).default(60_000) })

/** 插件名 / the plugin name */
export const name = 'graphTools'
/** 依赖 DSH 工具注册表与 flow 引擎能力 / requires the DSH tool registry and the flow engine capability */
export const inject = ['tools', FlowEngineToken] as const
/** 不提供新能力 / provides no new capability */
export const provide = [] as const

/**
 * 插件入口：按序注册三个工具（逆序注销由 ctx.effect 负责）。
 * The plugin entry: register the three tools in order; ctx.effect owns the
 * reverse-order unregistration.
 * @param ctx - 宿主上下文 / the host context.
 * @param config - 归一化后的插件配置 / the normalized plugin config.
 */
export const apply = (ctx: Context, config: Config): void => {
    const engine = getOrThrow(ctx, FlowEngineToken)
    for (const tool of createGraphTools(engine, Config(config).runTimeoutMs)) {
        ctx.effect(() => ctx.tools.register(tool), `graph-tools:${tool.name}`)
    }
}
