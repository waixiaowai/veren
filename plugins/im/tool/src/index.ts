/**
 * @veren/im-tool plugin: the model-facing `im_*` tool family and the
 * `im-collaboration` skill.
 *
 * The plugin owns no channel code and no storage: every collaborator arrives
 * by injection from the family packages (conversation, coordination, turn,
 * and the core's directory/intake/memory/participants/bindings). Attribution
 * is the turn service's session map; the model never self-identifies.
 *
 * @veren/im-tool 插件：面向模型的 `im_*` 工具族与 `im-collaboration` 技能。
 *
 * 插件不拥有渠道代码，也不持有存储：所有协作者都由家族各包注入（会话、协调、回合，以及
 * 核心的目录/采集/记忆/名册/绑定）。归属由回合服务的会话映射决定；模型绝不自报身份。
 *
 * @module @veren/im-tool
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { getOrThrow } from '@veren/core'
import {
  ImBindingsToken, ImCredentialToken, ImDirectoryToken, ImIntakeToken, ImLoggerToken, ImMemoryToken,
  ImParticipantsToken, ImPeopleToken, ImToken,
} from '@veren/im'
import { ConversationToken } from '@veren/im-conversation'
import { CoordinationToken } from '@veren/im-coordination'
import { TurnToken } from '@veren/im-turn'
import { registerCollaborationSkill } from './skill.ts'
import { registerImTools } from './tools.ts'

/** Plugin name. */
export const name = 'imTool'

/** Host services and family services this plugin consumes. */
/** 本插件消费的宿主服务与家族服务。 */
export const inject = [
  'tools', 'skills',
  'imConversation', 'imCoordination', 'imTurn',
  'imDirectory', 'imIntake', 'imMemory', 'imParticipants', 'imBindings',
] as const

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
 * Apply the IM tool plugin: the collaboration skill, then every tool.
 * 应用 IM 工具插件：先协作技能，再全部工具。
 *
 * @param ctx - host context carrying `tools`, `skills`, and the family services.
 * @param config - validated plugin configuration.
 */
export const apply = (ctx: Context, config: Config): void => {
  if (!config.enabled) return
  ctx.effect(() => registerCollaborationSkill(ctx), 'im:skill')
  registerImTools(ctx, {
    conversation: getOrThrow(ctx, ConversationToken),
    coordination: getOrThrow(ctx, CoordinationToken),
    turn: getOrThrow(ctx, TurnToken),
    directory: getOrThrow(ctx, ImDirectoryToken),
    intake: getOrThrow(ctx, ImIntakeToken),
    memory: getOrThrow(ctx, ImMemoryToken),
    participants: getOrThrow(ctx, ImParticipantsToken),
    bindings: getOrThrow(ctx, ImBindingsToken),
    registry: getOrThrow(ctx, ImToken),
    credentials: getOrThrow(ctx, ImCredentialToken),
    people: getOrThrow(ctx, ImPeopleToken),
    logger: getOrThrow(ctx, ImLoggerToken),
  })
}
