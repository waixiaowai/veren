/**
 * DSH-backed session gateway: the bridge that turns one delivered prompt into
 * one Session turn and hands the turn's text back to the channel.
 *
 * A delivered prompt starts one turn; the answer is the concatenated text of
 * that turn's `assistant/message` events, settled at `turn/end`. The capture is
 * armed only by this prompt's own `user/message` event (matched through the
 * `im-message` source), so a human turn running concurrently in the same
 * Session can never leak its answer back to the channel.
 *
 * 基于 DSH 的会话网关：把一次投递的 prompt 变成一个 Session turn，并把该 turn 的文本交还渠道。
 *
 * 投递的 prompt 启动一个 turn；回答是该 turn 的 `assistant/message` 事件文本拼接，在
 * `turn/end` 落定。捕获只由本 prompt 自己的 `user/message` 事件武装（经 `im-message` source
 * 匹配），因此同一 Session 里并发进行的人类 turn 绝不会把它的回答泄漏回渠道。
 *
 * Split out of `index.ts` so the plugin assembly stays under the file-size
 * ceiling.
 * 按职责从 `index.ts` 拆出，让插件装配保持在单文件行数上限内。
 *
 * @module @veren/im/gateway
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { AgentOptions } from '@deepseek-ai/dsh-agent'
// 类型-only：拉取 ctx.workspaceRegistry 的 declaration merging（会话 cwd 归属解析）
// / type-only: pulls the ctx.workspaceRegistry declaration merging (session cwd membership)
import type {} from '@deepseek-ai/dsh-workspace'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import { ImError } from './contract.ts'
import type { ImBindingSettings } from './contract.ts'
import { errorMessage } from './runtime-seams.ts'
import type { ImSessionGateway } from './runtime-seams.ts'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** One inbound IM message promoted into a DSH Session. @persistenceSource user */
    'im-message': {
      kind: 'im-message'
      providerId: string
      accountId: string
      conversationId: string
      messageId: string
    }
  }
}

/** One reply the gateway is waiting for. */
interface PendingReply {
  /** True until this prompt's own `user/message` event is observed. */
  awaitingMessage: boolean
  /** The prompt id sent through `followup`; identifies exactly our turn. */
  messageId: string
  text: string
  resolve: (value: string | undefined) => void
  reject: (error: unknown) => void
  timer: NodeJS.Timeout
}

/**
 * DSH-backed session gateway. See the module header for the capture contract.
 * 基于 DSH 的会话网关。捕获契约见模块头。
 */
export class DshSessionGateway implements ImSessionGateway {
  private readonly pending = new Map<string, PendingReply>()
  private readonly chains = new Map<string, Promise<unknown>>()

  /**
   * @param ctx - context carrying `agents` and the session event bus.
   * @param replyTimeoutMs - maximum wait for one turn to end.
   */
  constructor(
    private readonly ctx: Context,
    private readonly replyTimeoutMs: number,
  ) {
    ctx.effect(
      () => ctx.on('session/event', (session, event) => this.observe(session.id, event)),
      'im:session-events',
    )
  }

  async ensureSession(request: {
    sessionId?: string
    settings: ImBindingSettings
  }): Promise<{ sessionId: string; created: boolean }> {
    const existing = request.sessionId
    if (existing !== undefined) {
      const id = brandString<SessionId>(existing)
      if (this.ctx.agents.get(id) !== undefined) return { sessionId: existing, created: false }
      try {
        await this.ctx.agents.resume({ resumeSessionId: id })
        return { sessionId: existing, created: false }
      } catch (error: unknown) {
        throw new ImError('IM_INTERNAL', `session could not be resumed: ${errorMessage(error)}`)
      }
    }
    const id = brandString<SessionId>(`session-${randomUUID()}`)
    try {
    await this.ctx.agents.create({
      sessionId: id,
      // cwd 是会话的工作区归属（GUI 侧栏与历史加载按头 cwd 解析作用域）：缺省
      // 会话落进 _no-cwd，GUI 打开即 session/not-found（真机反例）。默认工作区
      // 解析与 app-host 同构：registry 缺席退回进程 cwd。
      // cwd is the session's workspace membership (the GUI sidebar and history
      // loading resolve scope from the header cwd): without it sessions land in
      // _no-cwd and the GUI fails them with session/not-found (live
      // counter-example). The default-workspace resolution mirrors app-host,
      // falling back to the process cwd when the registry is absent.
      meta: { cwd: await imSessionWorkspace(this.ctx), ...(request.settings.presetId === undefined ? {} : { agentPreset: request.settings.presetId }) },
      ...agentOptionsOf(request.settings),
    })
      return { sessionId: id, created: true }
    } catch (error: unknown) {
      throw new ImError('IM_INTERNAL', `session could not be created: ${errorMessage(error)}`)
    }
  }

  ask(request: {
    sessionId: string
    prompt: string
    source: {
      providerId: string
      accountId: string
      conversationId: string
      messageId: string
    }
  }): Promise<string | undefined> {
    return this.serialize(request.sessionId, () => this.awaitReply(request))
  }

  /**
   * Register one pending reply, deliver the prompt through `followup`, and
   * leave the answer to `observe`.
   * 登记一条待复，经 followup 投递 prompt，回答交给 observe 处理。
   */
  private awaitReply(request: {
    sessionId: string
    prompt: string
    source: {
      providerId: string
      accountId: string
      conversationId: string
      messageId: string
    }
  }): Promise<string | undefined> {
    return new Promise<string | undefined>((resolve, reject) => {
      const agent = this.ctx.agents.get(brandString<SessionId>(request.sessionId))
      if (agent === undefined) {
        // 宿主重启后磁盘会话没有活 agent：先从持久化恢复再投递，否则每条消息都
        // 以 IM_NOT_FOUND 静默死亡（真机反例：重启用微信发消息石沉大海）。恢复
        // 失败才以原始错误拒绝。
        // A disk session has no live agent after a host restart: resume it from
        // persistence before delivering, or every message dies silently with
        // IM_NOT_FOUND (live counter-example: WeChat messages after a restart
        // vanished). Only a failed resume rejects with its own error.
        void this.ctx.agents
          .resume({ resumeSessionId: brandString<SessionId>(request.sessionId) })
          .then(() => {
            const resumed = this.ctx.agents.get(brandString<SessionId>(request.sessionId))
            if (resumed === undefined) {
              reject(new ImError('IM_NOT_FOUND', `session did not resume: ${request.sessionId}`))
              return
            }
            this.armReply(request, resolve, reject)
            try {
              resumed.followup(promptMessageOf(request))
            } catch (error: unknown) {
              this.settle(request.sessionId, { error })
            }
          })
          .catch((error: unknown) => {
            reject(new ImError('IM_NOT_FOUND', `session could not be resumed: ${error instanceof Error ? error.message : String(error)}`))
          })
        return
      }
      this.armReply(request, resolve, reject)
      try {
        agent.followup(promptMessageOf(request))
      } catch (error: unknown) {
        this.settle(request.sessionId, { error })
      }
    })
  }

  /** Arm the per-ask timeout and register the pending reply it guards. */
  private armReply(
    request: { sessionId: string; source: { messageId: string } },
    resolve: (value: string | undefined) => void,
    reject: (error: unknown) => void,
  ): void {
    const timer = setTimeout(() => {
      this.settle(request.sessionId, {
        error: new ImError('IM_INTERNAL', `session did not answer within ${this.replyTimeoutMs}ms`),
      })
    }, this.replyTimeoutMs)
    timer.unref()
    this.pending.set(request.sessionId, {
      awaitingMessage: true,
      messageId: request.source.messageId,
      text: '',
      resolve,
      reject,
      timer,
    })
  }

  /** Stop waiting for replies; called on plugin unload. */
  dispose(): void {
    for (const [sessionId, pending] of [...this.pending]) {
      clearTimeout(pending.timer)
      pending.reject(new ImError('IM_INTERNAL', 'IM plugin is unloading'))
      this.pending.delete(sessionId)
    }
    this.chains.clear()
  }

  /** Consume one session event for the pending reply of that session. */
  private observe(sessionId: SessionId, event: SessionEvent): void {
    const pending = this.pending.get(sessionId)
    if (pending === undefined) return
    if (event.type === 'user/message') {
      // Arm only on this prompt's own user message; anything else in the same
      // Session (a human typing meanwhile) belongs to another turn.
      // 只在本 prompt 自己的 user message 上武装；同一 Session 里的其他输入属于别的 turn。
      const source: unknown = event.data.source
      if (pending.awaitingMessage
        && typeof source === 'object' && source !== null
        && (source as { kind?: unknown }).kind === 'im-message'
        && (source as { messageId?: unknown }).messageId === pending.messageId) {
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
  private settle(sessionId: string, outcome: { value?: string; error?: unknown }): void {
    const pending = this.pending.get(sessionId)
    if (pending === undefined) return
    this.pending.delete(sessionId)
    clearTimeout(pending.timer)
    if (outcome.error !== undefined) pending.reject(outcome.error)
    else pending.resolve(outcome.value)
  }

  /** Serialize prompts per Session so a reply cannot bind to the wrong turn. */
  private serialize<T>(sessionId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.chains.get(sessionId) ?? Promise.resolve()
    const next = previous.then(work, work)
    const tail = next.catch(() => undefined)
    this.chains.set(sessionId, tail)
    return next.finally(() => {
      if (this.chains.get(sessionId) === tail) this.chains.delete(sessionId)
    })
  }
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
    const preferred = registry.initializeDefault(async () => {
      throw new Error('im: the default workspace already exists; the resolver must not run')
    }).catch(() => undefined)
    return preferred?.path ?? workspaces[workspaces.length - 1]!.path
  } catch {
    return process.cwd()
  }
}

/** Build the user message one delivered prompt becomes. */
function promptMessageOf(request: {
  prompt: string
  source: {
    providerId: string
    accountId: string
    conversationId: string
    messageId: string
  }
}): ReturnType<typeof createUserMessage> {
  return createUserMessage({
    content: [{ type: 'text', text: request.prompt }],
    source: { kind: 'im-message', ...request.source },
  })
}

/** Build the per-agent options a new Session receives. */
function agentOptionsOf(settings: ImBindingSettings): { agentOptions: AgentOptions } | Record<string, never> {
  const options: AgentOptions = {}
  if (settings.provider !== undefined) options.provider = settings.provider
  if (settings.model !== undefined) options.model = settings.model
  if (settings.reasoning !== undefined) {
    options.reasoningEffort = brandString<NonNullable<AgentOptions['reasoningEffort']>>(settings.reasoning)
  }
  return Object.keys(options).length === 0 ? {} : { agentOptions: options }
}
