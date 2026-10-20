/**
 * @veren/im-tool plugin: the model-facing `im_*` tool family.
 *
 * The plugin only reads `ctx.imRouter` (the active-binding router); it owns no
 * channel code and no storage.
 *
 * @veren/im-tool 插件：面向模型的 `im_*` 工具族。
 *
 * 插件只读取 `ctx.imRouter`（active-binding 路由），不包含渠道代码，也不直接持有存储。
 *
 * @module @veren/im-tool
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { ImRouterToken } from '@veren/im'
import { registerPeopleTools } from './people-tools.ts'
import { registerReportTool } from './report-tool.ts'
import { registerImTools } from './tools.ts'

/** Plugin name. */
export const name = 'imTool'

/** Services this plugin consumes. */
export const inject = ['tools', ImRouterToken] as const

/** This plugin provides no service. */
export const provide = [] as const

/** Plugin configuration. */
export interface Config {
  /** Register the `im_*` tools. */
  enabled: boolean
}

/** Configuration schema. */
export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
})

/**
 * Apply the IM tool plugin.
 * @param ctx - host context carrying `tools` and `imRouter`.
 * @param config - validated plugin configuration.
 */
export const apply = (ctx: Context, config: Config): void => {
  if (!config.enabled) return
  registerImTools(ctx, ctx.imRouter)
  registerPeopleTools(ctx, ctx.imRouter)
  registerReportTool(ctx, ctx.imRouter)
}
