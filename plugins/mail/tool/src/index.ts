/**
 * `@veren/mail-tool`: the model-facing surface of the mail plugin.
 *
 * The package registers the `mail_*` tools and the bundled skill. It owns no
 * domain logic and no storage: it reads the mail service the core plugin
 * provides, and every tool is a thin projection of one service call.
 *
 * `@veren/mail-tool`：邮件插件面向模型的那一面。
 *
 * 本包注册 `mail_*` 工具与内置技能。它不拥有域逻辑，也不拥有存储：它读取核心插件提供的邮件
 * 服务，每个工具都是一次服务调用的薄投影。
 *
 * @module @veren/mail-tool
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { getOrThrow } from '@veren/core'
import type { MailService } from '@veren/mail'
import { MailServiceToken } from '@veren/mail'
import { subscribersTool, upsertGroupTool, upsertSubscriberTool, groupsTool, subscribeTool } from './audience-tools.ts'
import { activityTool, sendTool, workflowsTool } from './delivery-tools.ts'
import { conversationsTool, conversationMessagesTool, inboxTool, markMessageTool } from './inbox-tools.ts'
import { registerMailSkill } from './skill.ts'

/** Plugin name. / 插件名。 */
export const name = 'mailTool'

/** The services this plugin consumes. / 本插件消费的服务。 */
export const inject = ['tools', 'skills', MailServiceToken] as const

/** The services this plugin provides. / 本插件提供的服务。 */
export const provide = [] as const

/** The plugin's configuration. / 插件配置。 */
export interface Config {
  /** Whether the `mail_*` tools are registered. / 是否注册 `mail_*` 工具。 */
  readonly enabled: boolean
  /** Whether the bundled skill is registered. / 是否注册内置技能。 */
  readonly skill: boolean
}

/** The configuration schema. / 配置 schema。 */
export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  skill: z.boolean().default(true),
}) as z<Config>

/**
 * Apply the mail tool plugin.
 *
 * 应用邮件工具插件。
 *
 * @param ctx - host context carrying `tools` and the mail service / 携带 `tools` 与邮件服务的宿主上下文
 * @param config - validated plugin configuration / 已校验的插件配置
 */
export const apply = (ctx: Context, config: Config): void => {
  if (config.enabled) registerMailTools(ctx, getOrThrow(ctx, MailServiceToken))
  if (config.skill) registerMailSkill(ctx)
}

/**
 * Register every mail tool in the mounting scope.
 *
 * 在挂载作用域注册全部邮件工具。
 *
 * @param ctx - context owning the tools registry / 拥有工具注册表的上下文
 * @param mail - the mail service / 邮件服务
 */
export function registerMailTools(ctx: Context, mail: MailService): void {
  ctx.effect(() => {
    const disposers = [
      ctx.tools.register(sendTool(mail)),
      ctx.tools.register(workflowsTool(mail)),
      ctx.tools.register(activityTool(mail)),
      ctx.tools.register(subscribersTool(mail)),
      ctx.tools.register(upsertSubscriberTool(mail)),
      ctx.tools.register(groupsTool(mail)),
      ctx.tools.register(upsertGroupTool(mail)),
      ctx.tools.register(subscribeTool(mail)),
      ctx.tools.register(inboxTool(mail)),
      ctx.tools.register(markMessageTool(mail)),
      ctx.tools.register(conversationsTool(mail)),
      ctx.tools.register(conversationMessagesTool(mail)),
    ]
    return () => { for (const dispose of disposers.reverse()) dispose() }
  }, 'mail-tool:tools')
}

export { registerMailSkill, SKILL_NAME } from './skill.ts'
export { MAIL_OUTPUT_SCHEMA, failureOf } from './face.ts'
