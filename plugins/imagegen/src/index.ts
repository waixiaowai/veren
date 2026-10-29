/**
 * @veren/imagegen —— DSH 图像生成插件。挂载即注册：两个模型工具
 * （imagegen__generate / imagegen__edit，作用于任意 OpenAI 兼容 Images API）、
 * `image-generation` 技能（提示词纪律）与粘贴式登录流（key 只进凭据库）。
 * `enabled` 默认 false：安装不等于授权付费，未开启时工具以 IMAGEGEN_DISABLED
 * 拒绝调用。
 * @veren/imagegen — the dsh image generation plugin. Mounting registers the
 * two model tools (imagegen__generate / imagegen__edit against any
 * OpenAI-compatible Images API), the `image-generation` skill (the prompting
 * discipline), and the paste sign-in flow (the key lives only in the
 * credential store). `enabled` defaults to false: installing is not consenting
 * to paid calls — while off, tools refuse with IMAGEGEN_DISABLED.
 *
 * @module @veren/imagegen
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-authorization'
import type {} from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-workspace'
import z from '@deepseek-ai/schemastery'
import { registerImagegenFlow } from './auth-flow.js'
import { resolveConfig, type Config as ConfigShape } from './config.js'
import { registerImagegenSkill } from './skill.js'
import { registerImagegenTools } from './tools.js'
import type { ImagegenWorld } from './assets.js'

/** Cordis 插件名。The Cordis plugin name. */
export const name = 'imagegen'

/** 插件配置形状。The plugin config shape. */
export interface Config extends ConfigShape {}

/** 宿主统一配置契约（缺省值与校验在 config.ts 的 resolveConfig）。 */
/** The host's uniform config contract (defaults and validation live in config.ts's resolveConfig). */
export const Config: z<Config> = z.object({
  enabled: z.boolean().description('Paid-call gate; tools refuse with IMAGEGEN_DISABLED while false'),
  baseURL: z.string().role('url').description('OpenAI-compatible Images API root'),
  apiKey: z.string().description('Optional plaintext Images API key; wins over the credential record. Sits in the profile config file in plaintext - prefer the sign-in flow if that bothers you'),
  model: z.string().description('Default image model, e.g. gpt-image-2'),
  requestTimeoutMs: z.number().description('Per-request timeout in milliseconds'),
  maxAttempts: z.number().description('Maximum attempts for transient failures'),
}).description('Image generation endpoint, cost gate, and timeouts')

/**
 * 依赖的能力面：tools（工具表）、skills（技能表）、attachments（生成图
 * 入库）、credentials（key 记录）、authorization（登录流）、workspaceRegistry
 * （落盘基准目录解析）。
 * The injected capabilities: tools (the tool registry), skills (the skill
 * registry), attachments (admitting generated images), credentials (the key
 * record), authorization (the sign-in flow), workspaceRegistry (resolving the
 * save-path base directory).
 */
export const inject = ['tools', 'skills', 'attachments', 'credentials', 'authorization', 'workspaceRegistry']

/** 本插件不提供服务面。This plugin provides no service face. */
export const provide = []

/**
 * 组装编排世界：workspaceOf 按调用会话反查工作区目录（person-agent 先例同型）。
 * Assembles the orchestration world: workspaceOf resolves the calling
 * session's workspace directory (the person-agent precedent's shape).
 */
function worldOf(ctx: Context, config: ReturnType<typeof resolveConfig>): ImagegenWorld {
  return {
    config,
    credentials: ctx.credentials,
    attachments: ctx.attachments,
    workspaceOf: (sessionId) => {
      if (sessionId === undefined) return undefined
      const workspace = ctx.workspaceRegistry.list().find(entry => entry.sessionIds.includes(sessionId))
      return workspace?.path
    },
  }
}

/** 插件入口：登录流 + 工具表 + 技能表，全部随插件卸载逆序清理。 */
/** Plugin entry: the sign-in flow, the tool registry, and the skill registry — all reverse-order cleaned on unload. */
export const apply = (ctx: Context, config: Config): void => {
  const resolved = resolveConfig(config)
  registerImagegenFlow(ctx, resolved)
  const world = worldOf(ctx, resolved)
  ctx.effect(() => registerImagegenTools(ctx, world), 'imagegen.tools')
  ctx.effect(() => registerImagegenSkill(ctx), 'imagegen.skill')
}
