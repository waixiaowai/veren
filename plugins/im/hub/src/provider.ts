/**
 * The hub provider: one `ImService` that receives WeChat messages from the
 * cloud hub by outbound long polling and delivers replies back to it. It holds
 * no iLink session itself — the hub does — so `bind` refuses and `accounts`
 * reports the single device-side account.
 *
 * hub provider：一个 `ImService`，通过出站长轮询从云端 hub 接收微信消息，并把回复
 * 交回 hub。它自身不持有 iLink 会话——那是 hub 的事——因此 `bind` 拒绝，`accounts`
 * 只报告唯一的设备侧账号。
 *
 * @module @veren/im-hub/provider
 */

import { ImError } from '@veren/im'
import type {
  ImAccount, ImBindAttempt, ImBindRequest, ImFeatures, ImMessage, ImSendRequest, ImSendResult,
} from '@veren/im'
import type { LoggerService } from '@deepseek-ai/cordis'
import type { HubCursorStore } from './store.ts'

/** Capabilities the hub channel declares (WeChat V1 text, direct only). */
export const HUB_FEATURES: ImFeatures = {
  direct: true,
  group: false,
  threads: false,
  markdown: false,
  media: { image: false, file: false },
  typing: false,
  auth: [],
  limits: { textChars: 1_800 },
}

/** One routed message from the hub's device queue. */
export interface HubDeviceMessage {
  seq: number
  id: string
  conversationId: string
  sender: string
  text: string
  sentAt: number
}

/** Provider construction options. */
export interface HubProviderOptions {
  hubBaseUrl: string
  deviceToken: string
  deviceId: string
  logger: LoggerService
  cursor: HubCursorStore
  fetchImpl?: typeof fetch
}

/** The device-side provider backed by the cloud hub's device API. */
export class HubProvider {
  readonly features = HUB_FEATURES
  private readonly fetch: typeof fetch
  private readonly handlers = new Set<(message: ImMessage) => void | Promise<void>>()
  private readonly controller = new AbortController()

  constructor(private readonly options: HubProviderOptions) {
    this.fetch = options.fetchImpl ?? fetch
  }

  /** Lifecycle start: the poll loop begins with the first listener. */
  async start(): Promise<void> {}

  /** Lifecycle stop: abort the poll loop. */
  async stop(): Promise<void> {
    this.controller.abort()
  }

  /** The single device-side account. */
  async accounts(): Promise<ImAccount[]> {
    return [{ id: this.options.deviceId, displayName: 'Hub', status: 'online' }]
  }

  /**
   * Subscribe the router and start the long-poll loop. At-least-once: a batch
   * is delivered before the cursor advances, so a crash replays it.
   * 订阅路由并启动长轮询循环。至少一次：先投递再推进游标，崩溃会重放批次。
   */
  listen(handler: (message: ImMessage) => void | Promise<void>): () => void {
    this.handlers.add(handler)
    void this.loop()
    return () => {
      this.handlers.delete(handler)
    }
  }

  /** The hub holds the iLink session; authorization never happens here. */
  async bind(_request: ImBindRequest): Promise<ImBindAttempt> {
    throw new ImError('IM_UNSUPPORTED', 'authorization lives on the cloud hub, not on this device')
  }

  /** Deliver one reply through the hub. */
  async send(request: ImSendRequest): Promise<ImSendResult> {
    const text = request.content.type === 'text' || request.content.type === 'markdown'
      ? request.content.text
      : ''
    const response = await this.fetch(`${this.options.hubBaseUrl}/hub/replies`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hub-token': this.options.deviceToken },
      body: JSON.stringify({
        conversationId: request.target.conversationId,
        text,
        ...(request.replyToMessageId === undefined ? {} : { replyTo: request.replyToMessageId }),
      }),
      signal: this.controller.signal,
    })
    if (!response.ok) throw new ImError('IM_SEND_REJECTED', `hub refused the reply: HTTP ${response.status}`)
    return { id: `hub-${Date.now()}`, sentAt: Date.now() }
  }

  /** The long-poll loop: claim batches, emit, advance the cursor per batch. */
  private async loop(): Promise<void> {
    const { hubBaseUrl, deviceToken, deviceId, cursor, logger } = this.options
    while (!this.controller.signal.aborted) {
      try {
        const response = await this.fetch(
          `${hubBaseUrl}/hub/poll?device=${encodeURIComponent(deviceId)}&after=${cursor.after(deviceId)}`,
          { headers: { 'x-hub-token': deviceToken }, signal: this.controller.signal },
        )
        if (!response.ok) throw new ImError('IM_INTERNAL', `hub poll failed: HTTP ${response.status}`)
        const body = (await response.json()) as { messages?: HubDeviceMessage[]; tail?: number }
        // 全新设备（cursor=0）只消费新鲜消息：更早的按历史跳过（游标直接越过），
        // 5 分钟内的照常投递——注册后立刻发消息的用户不能被当成历史吞掉。
        // A brand-new device (cursor=0) consumes only fresh messages: older ones
        // are skipped as history (the cursor jumps past them); anything within
        // five minutes is delivered — a user messaging right after registering
        // must not be swallowed as history.
        const batch = body.messages ?? []
        if (cursor.after(deviceId) === 0 && batch.length > 0) {
          const staleCutoff = Date.now() - 300_000
          const stale = batch.filter(message => message.sentAt <= staleCutoff)
          if (stale.length > 0) {
            await cursor.save(deviceId, Math.max(...stale.map(message => message.seq)))
            if (stale.length === batch.length) continue
          }
        }
        for (const message of batch) {
          const normalized: ImMessage = {
            id: message.id,
            accountId: deviceId,
            conversationId: message.conversationId,
            sender: { id: message.sender },
            sentAt: message.sentAt,
            content: { type: 'text', text: message.text },
          }
          for (const handler of [...this.handlers]) await handler(normalized)
          await cursor.save(deviceId, message.seq)
        }
        if ((body.messages ?? []).length === 0) {
          await new Promise(resolve => setTimeout(resolve, 300))
        }
      } catch (error: unknown) {
        if (this.controller.signal.aborted) return
        logger.warn(`[im:hub] poll failed, retrying in 5s: ${error instanceof Error ? error.message : String(error)}`)
        await new Promise(resolve => setTimeout(resolve, 5_000))
      }
    }
  }
}
