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
 * Session provisioning (create/resume, workspace resolution, prompt-message
 * building) lives in `gateway-session.ts`; this file keeps only the per-turn
 * capture machinery.
 * 会话筹备（创建/恢复、工作区解析、prompt 消息构建）在 `gateway-session.ts`；本文件只保留
 * 单 turn 的捕获机制。
 *
 * @module @veren/im/gateway
 */

import type { Context } from '@deepseek-ai/cordis'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import { ImError } from './contract-errors.ts'
import type { ImBindingSettings } from './contract-bind.ts'
import { errorMessage } from './runtime-seams.ts'
import type { ImSessionGateway } from './runtime-seams.ts'
import { ensureDshSession, promptMessageOf, resumeAgentOptionsOf } from './gateway-session.ts'
import type { ImPromptSource } from './runtime-seams.ts'

/** One reply the gateway is waiting for. */
/** 一条网关正在等待的回复。 */
interface PendingReply {
  /** True until this prompt's own `user/message` event is observed. */
  /** 观察到本 prompt 自己的 `user/message` 事件之前为真。 */
  awaitingMessage: boolean
  /** The prompt id sent through `followup`; identifies exactly our turn. */
  /** 经 followup 发出的 prompt id；精确标识属于我们的那个 turn。 */
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

  ensureSession(request: {
    sessionId?: string
    settings: ImBindingSettings
  }): Promise<{ sessionId: string; created: boolean }> {
    return ensureDshSession(this.ctx, request)
  }

  ask(request: {
    sessionId: string
    prompt: string
    source: ImPromptSource
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
    source: ImPromptSource
  }): Promise<string | undefined> {
    return new Promise<string | undefined>((resolve, reject) => {
      const agent = this.ctx.agents.get(brandString<SessionId>(request.sessionId))
      if (agent === undefined) {
        this.resumeAndAsk(request, resolve, reject)
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

  /**
   * A disk session has no live agent after a host restart: resume it from
   * persistence before delivering, or every message dies silently with
   * IM_NOT_FOUND (live counter-example: WeChat messages after a restart
   * vanished). Only a failed resume rejects with its own error.
   * 宿主重启后磁盘会话没有活 agent：先从持久化恢复再投递，否则每条消息都
   * 以 IM_NOT_FOUND 静默死亡（真机反例：重启用微信发消息石沉大海）。恢复
   * 失败才以原始错误拒绝。
   */
  private resumeAndAsk(
    request: { sessionId: string; prompt: string; source: ImPromptSource },
    resolve: (value: string | undefined) => void,
    reject: (error: unknown) => void,
  ): void {
    void this.ctx.agents
      .resume({ resumeSessionId: brandString<SessionId>(request.sessionId), ...resumeAgentOptionsOf(this.ctx) })
      .then(() => this.deliverAfterResume(request, resolve, reject))
      .catch((error: unknown) => {
        reject(new ImError('IM_NOT_FOUND', `session could not be resumed: ${errorMessage(error)}`))
      })
  }

  /** Arm the reply and deliver the prompt once the session is live again. */
  /** 会话恢复后再武装待复并投递 prompt。 */
  private deliverAfterResume(
    request: { sessionId: string; prompt: string; source: ImPromptSource },
    resolve: (value: string | undefined) => void,
    reject: (error: unknown) => void,
  ): void {
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
  }

  /** Arm the per-ask timeout and register the pending reply it guards. */
  /** 武装单次询问的超时并登记它守护的待复。 */
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
  /** 停止等待回复；插件卸载时调用。 */
  dispose(): void {
    for (const [sessionId, pending] of [...this.pending]) {
      clearTimeout(pending.timer)
      pending.reject(new ImError('IM_INTERNAL', 'IM plugin is unloading'))
      this.pending.delete(sessionId)
    }
    this.chains.clear()
  }

  /** Consume one session event for the pending reply of that session. */
  /** 为该会话的待复消费一条会话事件。 */
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
  /** 恰好一次地落定一条待复。 */
  private settle(sessionId: string, outcome: { value?: string; error?: unknown }): void {
    const pending = this.pending.get(sessionId)
    if (pending === undefined) return
    this.pending.delete(sessionId)
    clearTimeout(pending.timer)
    if (outcome.error !== undefined) pending.reject(outcome.error)
    else pending.resolve(outcome.value)
  }

  /** Serialize prompts per Session so a reply cannot bind to the wrong turn. */
  /** 按 Session 串行化 prompt，回复才不会绑错 turn。 */
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
