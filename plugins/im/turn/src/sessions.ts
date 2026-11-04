/**
 * Session provisioning for turns: one DSH session per agent participant per
 * room, resumed after restarts, preset-backed when the participant names one.
 *
 * The agent IS a DSH preset (workspace decision): `agent:<presetId>` sessions
 * carry `meta.agentPreset`, the default agent's sessions run the deployment
 * persona. Model/provider defaults come from the deployment's
 * `agentDefaultModel`, same selection path as app-host and the webhook
 * session creation.
 *
 * 回合的会话筹备：每个智能体参与者每个房间一个 DSH 会话，重启后恢复，参与者指名 preset
 * 时以 preset 为人格。
 *
 * 智能体就是 DSH preset（工作区裁定）：`agent:<presetId>` 的会话携带 `meta.agentPreset`；
 * 默认智能体的会话以部署人格运行。模型/provider 缺省来自部署的 `agentDefaultModel`，与
 * app-host 及 webhook 会话创建同一条选型路径。
 *
 * @module @veren/im-turn/sessions
 */

import { randomUUID } from 'node:crypto'
import { brandString } from '@deepseek-ai/dsh-brand'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Context } from '@deepseek-ai/cordis'
import type { AgentOptions } from '@deepseek-ai/dsh-agent'
import type { SessionId, SessionEvent } from '@deepseek-ai/dsh-session'
// 类型-only：拉取 ctx.workspaceRegistry 的 declaration merging（会话 cwd 归属解析）
// / type-only: pulls the ctx.workspaceRegistry declaration merging (session cwd membership)
import type {} from '@deepseek-ai/dsh-workspace'
// 类型-only：拉取 ctx.agentDefaultModel 的 declaration merging（部署默认模型）
// / type-only: pulls the ctx.agentDefaultModel declaration merge (deployment default model)
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { ImError } from '@veren/im'
import { errorMessage } from './errors.ts'

/**
 * The prompt-provenance source carried by every turn's user message (declared
 * here; the capture arms on it, so a human typing in the same session can
 * never leak an answer into a run).
 * 每个回合的 user message 携带的 prompt 来源（在此声明；捕获靠它武装，因此同一会话里
 * 打字的人类绝不可能把回答泄漏进一次运行）。
 */
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** One turn's prompt, keyed by the run that produced it. @persistenceSource user */
    /** 一个回合的 prompt，以产出它的运行标识。 @persistenceSource user */
    'im-turn': {
      kind: 'im-turn'
      runId: string
    }
  }
}

/** The agent participant's preset id, when it has one. */
/** 智能体参与者的 preset id（有才有）。 */
export function presetOfAgent(agentId: string): string | undefined {
  if (!agentId.startsWith('agent:')) return undefined
  const preset = agentId.slice('agent:'.length)
  return preset === 'default' ? undefined : preset
}

/**
 * The per-agent options a new session receives: the deployment default model,
 * so the `{{model}}` prompt variable interpolates on the first turn (live
 * defect, 2026-10-27).
 * 新会话收到的 per-agent 选项：部署默认模型，`{{model}}` 提示变量才能在首回合插值
 * （真机缺陷，2026-10-27）。
 */
function agentOptionsOf(ctx: Context): { agentOptions: AgentOptions } {
  const selection = ctx.agentDefaultModel.currentSelection()
  return { agentOptions: { provider: selection.provider, model: selection.model } }
}

/**
 * Resolve the default workspace path for new sessions — same shape as
 * app-host's pageSessionWorkspace: the durable default when present, else the
 * oldest workspace; no registry or empty registry falls back to process.cwd().
 * 为新会话解析默认工作区路径——与 app-host 的 pageSessionWorkspace 同构：有持久默认用
 * 默认，否则取最早创建的工作区；无 registry 或空 registry 退回进程 cwd。
 */
async function sessionWorkspace(ctx: Context): Promise<string> {
  try {
    const workspaces = ctx.workspaceRegistry.list()
    if (workspaces.length === 0) return process.cwd()
    const preferred = await ctx.workspaceRegistry.initializeDefault(async () => {
      throw new Error('im-turn: the default workspace already exists; the resolver must not run')
    }).catch(() => undefined)
    return preferred?.path ?? workspaces[workspaces.length - 1]!.path
  } catch {
    return process.cwd()
  }
}

/** Construction options. */
/** 构造选项。 */
export interface SessionsOptions {
  readonly ctx: Context
  /** Look up one persisted session id; returns undefined when unmapped. */
  /** 查一个持久化的会话 id；未映射时返回 undefined。 */
  readonly lookup: (key: string) => string | undefined
  /** Remember one session id under one key. */
  /** 在一个键下记住一个会话 id。 */
  readonly remember: (key: string, sessionId: string) => Promise<void>
}

/** Session provisioning per agent+room, plus the per-session prompt capture. */
/** 按智能体+房间的会话筹备，外加按会话的 prompt 捕获。 */
export class Sessions {
  private readonly pending = new Map<string, {
    awaitingMessage: boolean
    messageId: string
    text: string
    resolve: (value: string | undefined) => void
    reject: (error: unknown) => void
    timer: NodeJS.Timeout
  }>()

  /**
   * @param options - host context plus the session-map seams.
   */
  constructor(private readonly options: SessionsOptions) {
    options.ctx.effect(
      () => options.ctx.on('session/event', (session, event) => this.observe(session.id, event)),
      'im-turn:session-events',
    )
  }

  /**
   * Ensure the session one agent uses in one room: resume the mapped one, or
   * create a fresh one (preset-backed when applicable) and remember it.
   * 确保一个智能体在一个房间使用的会话：恢复已映射的，或新建（适用时以 preset 为人格）
   * 并记住。
   */
  async ensure(agentId: string, roomId: string): Promise<string> {
    const key = `${agentId}\u0000${roomId}`
    const mapped = this.options.lookup(key)
    if (mapped !== undefined) {
      const live = await this.resume(mapped)
      if (live !== undefined) return mapped
    }
    const preset = presetOfAgent(agentId)
    const id = brandString<SessionId>(`session-${randomUUID()}`)
    try {
      await this.options.ctx.agents.create({
        sessionId: id,
        meta: {
          cwd: await sessionWorkspace(this.options.ctx),
          ...(preset === undefined ? {} : { agentPreset: preset }),
        },
        ...agentOptionsOf(this.options.ctx),
      })
    } catch (error: unknown) {
      throw new ImError('IM_INTERNAL', `session could not be created: ${errorMessage(error)}`)
    }
    await this.options.remember(key, id)
    return id
  }

  /**
   * Deliver one prompt into one session and wait for that turn's reply text.
   * The capture arms only on this prompt's own user message (matched through
   * the `im-turn` source), so concurrent human turns never leak in.
   * 把一条 prompt 投进一个会话并等待该回合的回复文本。捕获只在本 prompt 自己的 user
   * message 上武装（经 `im-turn` source 匹配），并发的人类回合绝不泄漏进来。
   */
  ask(request: { sessionId: string; prompt: string; runId: string; timeoutMs: number }): Promise<string | undefined> {
    return this.serialize(request.sessionId, () => this.awaitReply(request))
  }

  /** Stop waiting for replies; called on plugin unload. */
  /** 停止等待回复；插件卸载时调用。 */
  dispose(): void {
    for (const [sessionId, pending] of [...this.pending]) {
      clearTimeout(pending.timer)
      pending.reject(new ImError('IM_INTERNAL', 'im-turn is unloading'))
      this.pending.delete(sessionId)
    }
  }

  /** Register the pending reply, deliver through followup, leave the rest to observe. */
  /** 登记待复，经 followup 投递，其余交给 observe 处理。 */
  private awaitReply(request: {
    sessionId: string
    prompt: string
    runId: string
    timeoutMs: number
  }): Promise<string | undefined> {
    return new Promise<string | undefined>((resolve, reject) => {
      const agent = this.options.ctx.agents.get(brandString<SessionId>(request.sessionId))
      if (agent === undefined) {
        reject(new ImError('IM_NOT_FOUND', `session vanished before the prompt: ${request.sessionId}`))
        return
      }
      const timer = setTimeout(() => {
        this.settle(request.sessionId, {
          error: new ImError('IM_INTERNAL', `the session did not answer within ${request.timeoutMs}ms`),
        })
      }, request.timeoutMs)
      timer.unref()
      this.pending.set(request.sessionId, {
        awaitingMessage: true,
        messageId: request.runId,
        text: '',
        resolve,
        reject,
        timer,
      })
      try {
        agent.followup(createUserMessage({
          content: [{ type: 'text', text: request.prompt }],
          source: { kind: 'im-turn', runId: request.runId },
        }))
      } catch (error: unknown) {
        this.settle(request.sessionId, { error })
      }
    })
  }

  /** Resume one persisted session; a missing session resolves to undefined. */
  /** 恢复一个持久化会话；恢复不了就解析为 undefined。 */
  private async resume(existing: string): Promise<string | undefined> {
    const id = brandString<SessionId>(existing)
    if (this.options.ctx.agents.get(id) !== undefined) return existing
    try {
      const selection = this.options.ctx.agentDefaultModel.currentSelection()
      await this.options.ctx.agents.resume({
        resumeSessionId: id,
        agentOptions: { provider: selection.provider, model: selection.model },
      })
      return existing
    } catch {
      return undefined
    }
  }

  /** Consume one session event for the pending reply of that session. */
  /** 为该会话的待复消费一条会话事件。 */
  private observe(sessionId: SessionId, event: SessionEvent): void {
    const pending = this.pending.get(sessionId)
    if (pending === undefined) return
    if (event.type === 'user/message') {
      const source: unknown = event.data.source
      if (pending.awaitingMessage
        && typeof source === 'object' && source !== null
        && (source as { kind?: unknown }).kind === 'im-turn'
        && (source as { runId?: unknown }).runId === pending.messageId) {
        pending.awaitingMessage = false
      }
      return
    }
    if (event.type === 'assistant/message') {
      if (pending.awaitingMessage) return
      for (const block of event.data.message.content) {
        if (block.type === 'text') pending.text += block.text
      }
      return
    }
    if (event.type === 'turn/end' && !pending.awaitingMessage) {
      this.settle(sessionId, { value: pending.text.trim() || undefined })
    }
  }

  /** Settle one pending reply exactly once. */
  /** 恰好一次地落定一条待复。 */
  private settle(sessionId: string, outcome: { value?: string; error?: unknown }): void {
    const pending = this.pending.get(sessionId)
    if (pending === undefined) return
    this.pending.delete(sessionId)
    clearTimeout(pending.timer)
    if (outcome.error !== undefined) pending.reject(outcome.error)
    else pending.resolve(outcome.value)
  }

  /** Serialize prompts per session so a reply cannot bind to the wrong turn. */
  /** 按会话串行化 prompt，回复才不会绑错回合。 */
  private serialize<T>(sessionId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.chains.get(sessionId) ?? Promise.resolve()
    const next = previous.then(work, work)
    const tail = next.catch(() => undefined)
    this.chains.set(sessionId, tail)
    return next.finally(() => {
      if (this.chains.get(sessionId) === tail) this.chains.delete(sessionId)
    })
  }

  private readonly chains = new Map<string, Promise<unknown>>()
}
