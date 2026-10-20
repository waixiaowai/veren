/**
 * 会话内模型切换插件：开放运行时工具 `select_model`，让会话在对话过程中
 * 切换 provider/model 与推理强度。切换逻辑完全复用宿主的
 * `sessionController.selectModel`，本插件只做参数校验与错误透传。
 * The in-conversation model switch plugin: exposes the runtime tool
 * `select_model` so a session can change its provider/model and reasoning
 * effort mid-conversation. All switching logic is the host's
 * `sessionController.selectModel`; this plugin only validates arguments and
 * passes host errors through.
 *
 * @module @imeep/dsh-select-model
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import z from '@deepseek-ai/schemastery'
import { registerSelectModel } from './select-tool.js'

/** Cordis 插件名。The Cordis plugin name. */
export const name = 'select-model'

/**
 * 插件配置形状。当前没有可调项，保留空对象 schema 以满足宿主统一配置
 * 契约；未来新增开关无需迁移既有配置行。
 * The plugin config shape. No tunables yet; the empty object schema satisfies
 * the host's uniform config contract, and future toggles will not require
 * migrating existing config rows.
 */
export interface Config {}

/** 插件配置 schema（宿主要求用 schemastery 定义）。
 * The plugin config schema (the host requires a schemastery definition). */
export const Config: z<Config> = z.object({})
  .description('Select model plugin options. 会话内模型切换插件的配置项（暂无可调项）。')

/** 激活时需要的 Service 能力。The service capabilities needed at activation. */
export const inject = ['tools']

/** 本插件不对外提供服务。This plugin provides no services. */
export const provide = []

/**
 * 激活插件：在宿主工具注册表上注册 `select_model`。effect 函数体返回
 * `tools.register` 给出的精确卸载函数，卸载/HMR 时逆序调用，不泄漏注册项。
 * Activate the plugin: register `select_model` on the host tool registry. The
 * effect body returns the exact disposer given by `tools.register`, invoked on
 * unload/HMR, so no registration leaks.
 * @param ctx - 携带 `tools` 的宿主上下文。The host context carrying `tools`.
 * @param _config - 已解析的插件配置（当前无可调项）。
 *   The resolved plugin config (no tunables yet).
 */
export const apply = (ctx: Context, _config: Config): void => {
  ctx.effect(() => registerSelectModel(ctx), 'select-model.tool')
}
