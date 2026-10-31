/**
 * Model-facing `startup_create`, `startup_list`, `startup_update`,
 * `startup_delete`, and `startup_run` tools over the Host `ctx.startupAutostart`
 * service. Mounting the plugin registers them in the mounting scope, so a preset
 * decides which agents receive them.
 *
 * This entry only assembles and re-exports: the tools live in `tools.ts`, their
 * JSON-schema contract in `schemas.ts`, their copy in `descriptions.ts`, and
 * the pure argument/error helpers in `mapping.ts`.
 *
 * 面向模型的 `startup_*` 工具族，作用于宿主 `ctx.startupAutostart` 服务。挂载在
 * 哪个作用域，工具就注册到哪个作用域，由 preset 决定哪些 agent 拿到它们。
 *
 * 本入口只做组装与再导出：工具在 `tools.ts`，JSON-schema 契约在 `schemas.ts`，文案在
 * `descriptions.ts`，参数与错误的纯助手在 `mapping.ts`。
 * @module @veren/startup-autostart-tool
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { registerStartupTools } from './tools.ts'

/** Plugin name registered with the Loader. */
export const name = 'tool-startup-autostart'

/** Empty configuration: access is controlled by mounting the plugin. / 空配置：通过挂载插件控制授权。 */
export const Config = z.object({})

/** Host services this plugin consumes; `startupAutostart` is resolved per scope. / 宿主依赖按作用域解析。 */
export const inject = ['tools', 'startupAutostart']

/**
 * Register the five startup tools in the mounting scope.
 * @param ctx - Context owning the `tools` registry.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => registerStartupTools(ctx), 'startup-autostart-tool:register')
}
