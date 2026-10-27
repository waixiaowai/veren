/**
 * The hub provider: one `ImService` that receives WeChat messages from the
 * CMS im-hub module by outbound long polling and delivers replies back to it.
 * It holds no iLink session itself — the hub does — so `bind` refuses and
 * `accounts` reports the single device-side account.
 *
 * hub provider：一个 `ImService`，通过出站长轮询从 CMS im-hub 模块接收微信消息，
 * 并把回复交回 hub。它自身不持有 iLink 会话——那是 hub 的事——因此 `bind` 拒绝，
 * `accounts` 只报告唯一的设备侧账号。
 *
 * 对接面 = cms 信封 API（`/v1/im/hub/*`，Bearer API Key，`{code,message,data}`，
 * data 内 snake_case）；新鲜度过滤在 CMS 侧完成（after=0 只回 5 分钟内消息）。
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

/** One routed message from the hub's device queue (CMS envelope data shape). */
export interface HubDeviceMessage {
  seq: number
  message_id: string
  conversation_id: string
  sender: string
  text: string
  sent_at: number
}

/** The CMS envelope wrapper (code=0 success; non-zero carries message). */
export interface HubEnvelope<T> {
  code: number
  message: string
  data: T
}

/** GET /v1/im/hub/messages 的 data 形状。 */
export interface HubMessagesData {
  messages: HubDeviceMessage[]
  tail: number
}

/** Provider construction options. */
export interface HubProviderOptions {
  /** The CMS origin serving the im-hub module. */
  hubBaseUrl: string
  /** The device's CMS API Key (imhub:read granted). */
  apiKey: string
  /** This device's registration name at the hub. */
  deviceId: string
  logger: LoggerService
  cursor: HubCursorStore
  fetchImpl?: typeof fetch
}

/** The device-side provider backed by the CMS im-hub module. */
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

  /** 信封解包：code≠0 视为宿主结构化拒绝。 */
  private async envelope<T>(response: Response): Promise<T> {
    const body = (await response.json()) as HubEnvelope<T>
    if (body.code !== 0) {
      throw new ImError('IM_INTERNAL', `hub refused: ${body.message} (code=${body.code})`)
    }
    return body.data
  }

  /** Deliver one reply through the hub (CMS envelope). */
  async send(request: ImSendRequest): Promise<ImSendResult> {
    const text = request.content.type === 'text' || request.content.type === 'markdown'
      ? request.content.text
      : ''
    const response = await this.fetch(`${this.options.hubBaseUrl}/v1/im/hub/replies`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.options.apiKey}`,
      },
      body: JSON.stringify({ conversation_id: request.target.conversationId, text }),
      signal: this.controller.signal,
    })
    if (!response.ok) throw new ImError('IM_SEND_REJECTED', `hub refused the reply: HTTP ${response.status}`)
    await this.envelope(response)
    return { id: `hub-${Date.now()}`, sentAt: Date.now() }
  }

  /** The long-poll loop: claim batches, emit, advance the cursor per batch.
   *  新鲜度过滤在 CMS 侧完成（after=0 只回 5 分钟内消息）——设备侧零重复实现。 */
  private async loop(): Promise<void> {
    const { hubBaseUrl, apiKey, deviceId, cursor, logger } = this.options
    while (!this.controller.signal.aborted) {
      try {
        const response = await this.fetch(
          `${hubBaseUrl}/v1/im/hub/messages?device=${encodeURIComponent(deviceId)}&after=${cursor.after(deviceId)}`,
          { headers: { authorization: `Bearer ${apiKey}` }, signal: this.controller.signal },
        )
        if (!response.ok) throw new ImError('IM_INTERNAL', `hub poll failed: HTTP ${response.status}`)
        const data = await this.envelope<HubMessagesData>(response)
        for (const message of data.messages ?? []) {
          // 防御：空 message_id 一旦入库就是启动开库都过不了的毒行（真机缺陷
          // 2026-10-27：旧网关不下发该字段）。跳过并推进游标，不让一条坏载荷
          // 堵死整条通道。
          // Defense: an empty message_id becomes a poison row that fails the
          // domain at open (live defect 2026-10-27: an older gateway omitted
          // the field). Skip it, advance the cursor, keep the channel alive.
          if (message.message_id === undefined || message.message_id === '') {
            logger.warn(`[im:hub] message seq ${message.seq} has no message_id — skipped`)
            await cursor.save(deviceId, message.seq)
            continue
          }
          const normalized: ImMessage = {
            id: message.message_id,
            accountId: deviceId,
            conversationId: message.conversation_id,
            sender: { id: message.sender },
            sentAt: message.sent_at,
            content: { type: 'text', text: message.text },
          }
          for (const handler of [...this.handlers]) await handler(normalized)
          await cursor.save(deviceId, message.seq)
        }
        if ((data.messages ?? []).length === 0) {
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
