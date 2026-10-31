/**
 * Session provisioning for the IM gateway: creating or resuming the DSH Session
 * one inbound conversation lands in, and building the user message a delivered
 * prompt becomes.
 *
 * IM 网关的会话筹备：为入站会话创建或恢复承载它的 DSH Session，并构建投递 prompt 所变成的
 * user message。
 *
 * The {{model}} prompt variable is registered from `agent.options.model`, so
 * both the create path and the resume path backfill the deployment default
 * model (`agentDefaultModel`) unless the binding settings name one explicitly.
 * `agent.options.model` 注册 {{model}} 提示变量，因此创建与恢复两条路径都会回填部署默认
 * 模型（`agentDefaultModel`）——除非绑定设置里显式给了模型。
 *
 * @module @veren/im/gateway-session
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { AgentOptions } from '@deepseek-ai/dsh-agent'
// 类型-only：拉取 ctx.workspaceRegistry 的 declaration merging（会话 cwd 归属解析）
// / type-only: pulls the ctx.workspaceRegistry declaration merging (session cwd membership)
import type {} from '@deepseek-ai/dsh-workspace'
// 类型-only：拉取 ctx.agentDefaultModel 的 declaration merging（部署默认模型选型，
// 会话创建时回填 agentOptions.model 以注册 {{model}} 提示变量）
// / type-only: pulls the ctx.agentDefaultModel declaration merge (the deployment
// default model, applied at session creation to register the {{model}} prompt variable)
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { ImError } from './contract-errors.ts'
import type { ImBindingSettings } from './contract-bind.ts'
import { errorMessage } from './runtime-seams.ts'
import type { ImPromptSource } from './runtime-seams.ts'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** One inbound IM message promoted into a DSH Session. @persistenceSource user */
    /** 一条被提升进 DSH Session 的入站 IM 消息。 @persistenceSource user */
    'im-message': {
      kind: 'im-message'
      providerId: string
      accountId: string
      conversationId: string
      messageId: string
    }
  }
}

/** One session-provisioning request: an optional existing session plus settings. */
/** 一次会话筹备请求：可选的既有会话加绑定设置。 */
export interface ImSessionRequest {
  sessionId?: string
  settings: ImBindingSettings
}

/**
 * Resolve the default workspace path for new IM sessions — the same shape as
 * app-host's pageSessionWorkspace: the durable default when present, else the
 * oldest workspace; no registry or empty registry falls back to process.cwd().
 * 为新 IM 会话解析默认工作区路径——与 app-host 的 pageSessionWorkspace 同构：
 * 有持久默认用默认，否则取最早创建的工作区；无 registry 或空 registry 退回进程 cwd。
 */
async function imSessionWorkspace(ctx: Context): Promise<string> {
  try {
    const registry = ctx.workspaceRegistry
    const workspaces = registry.list()
    if (workspaces.length === 0) return process.cwd()
    const preferred = await registry.initializeDefault(async () => {
      throw new Error('im: the default workspace already exists; the resolver must not run')
    }).catch(() => undefined)
    return preferred?.path ?? workspaces[workspaces.length - 1]!.path
  } catch {
    return process.cwd()
  }
}

/** Build the per-agent options a new Session receives. */
/** 构建新 Session 收到的 per-agent 选项。 */
function agentOptionsOf(settings: ImBindingSettings): { agentOptions: AgentOptions } | Record<string, never> {
  const options: AgentOptions = {}
  if (settings.provider !== undefined) options.provider = settings.provider
  if (settings.model !== undefined) options.model = settings.model
  if (settings.reasoning !== undefined) {
    options.reasoningEffort = brandString<NonNullable<AgentOptions['reasoningEffort']>>(settings.reasoning)
  }
  return Object.keys(options).length === 0 ? {} : { agentOptions: options }
}

/**
 * The agent options a resumed session receives: the deployment default model.
 * 恢复会话收到的 agent 选项：部署默认模型。
 */
export function resumeAgentOptionsOf(ctx: Context): {
  agentOptions: { provider: string; model: string }
} {
  // 恢复路径同样回填部署默认模型：旧绑定的会话创建于修复前，缺
  // agentOptions.model，首回合 {{model}} 插值即失败（同 beginBind 修复）。
  // / the resume path applies the deployment default model too: older
  // bindings were created before the fix and lack agentOptions.model
  // (same first-turn {{model}} failure as the beginBind fix).
  const selection = ctx.agentDefaultModel.currentSelection()
  return { agentOptions: { provider: selection.provider, model: selection.model } }
}

/**
 * Ensure the DSH Session one conversation lands in: resume an existing session
 * id, or create a fresh one with the binding settings applied.
 * 确保会话所落的 DSH Session：已有会话 id 就恢复，否则按绑定设置新建。
 */
export async function ensureDshSession(
  ctx: Context,
  request: ImSessionRequest,
): Promise<{ sessionId: string; created: boolean }> {
  if (request.sessionId !== undefined) return resumeSession(ctx, request.sessionId)
  return createSession(ctx, request.settings)
}

/** Resume one persisted session id; a session with a live agent is a no-op. */
/** 恢复一个持久化会话 id；已有活 agent 的会话直接复用。 */
async function resumeSession(ctx: Context, existing: string): Promise<{ sessionId: string; created: boolean }> {
  const id = brandString<SessionId>(existing)
  if (ctx.agents.get(id) !== undefined) return { sessionId: existing, created: false }
  try {
    await ctx.agents.resume({ resumeSessionId: id })
    return { sessionId: existing, created: false }
  } catch (error: unknown) {
    throw new ImError('IM_INTERNAL', `session could not be resumed: ${errorMessage(error)}`)
  }
}

/** Create a fresh session from the binding settings plus the deployment defaults. */
/** 按绑定设置加部署默认值创建新会话。 */
async function createSession(ctx: Context, settings: ImBindingSettings): Promise<{ sessionId: string; created: boolean }> {
  const id = brandString<SessionId>(`session-${randomUUID()}`)
  try {
    // agentOptions.model 来自部署默认模型（agentDefaultModel）：agent-loop 用
    // agent.options.model 注册 {{model}} 提示变量——不给模型，deployment persona
    // 段的 {{model}} 插值在首回合就失败（真机反例：IM 会话首轮"本轮运行失败
    // prompt variable {{model}} has no value"）。与 app-host / webhook 会话创建
    // 同一条选型路径；settings 显式给了 model 时以 settings 为准。
    // agentOptions.model comes from the deployment default model
    // (agentDefaultModel): the agent loop registers the {{model}} prompt
    // variable from agent.options.model — without one, the deployment persona
    // section's {{model}} interpolation fails on the first turn (live
    // counter-example: an IM session's first turn failed with "prompt
    // variable {{model}} has no value"). Same selection path as app-host and
    // the webhook session creation; explicit settings win when present.
    const fallback = settings.model === undefined ? ctx.agentDefaultModel.currentSelection() : undefined
    await ctx.agents.create({
      sessionId: id,
      meta: { cwd: await imSessionWorkspace(ctx), ...(settings.presetId === undefined ? {} : { agentPreset: settings.presetId }) },
      ...agentOptionsOf(settings),
      ...(fallback === undefined || settings.model !== undefined ? {} : {
        agentOptions: { provider: fallback.provider, model: fallback.model },
      }),
    })
    return { sessionId: id, created: true }
  } catch (error: unknown) {
    throw new ImError('IM_INTERNAL', `session could not be created: ${errorMessage(error)}`)
  }
}

/** Build the user message one delivered prompt becomes. */
/** 构建投递 prompt 所变成的 user message。 */
export function promptMessageOf(request: {
  prompt: string
  source: ImPromptSource
}): ReturnType<typeof createUserMessage> {
  return createUserMessage({
    content: [{ type: 'text', text: request.prompt }],
    source: { kind: 'im-message', ...request.source },
  })
}
