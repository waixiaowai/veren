/**
 * Outbound delivery: committed room messages flow back to the WeChat channel.
 *
 * The core no longer routes or replies — rooms belong to the conversation
 * domain, and `im/message-new` announces every durably committed message.
 * This module is the WeChat adapter's return leg: it picks the agent-authored
 * messages that live on a WeChat-backed room and hands the body to the
 * provider's send. Delivery is best-effort: the durable fact (the room
 * message) is already safe, so every failure is a warning and never an
 * exception out of the event listener.
 *
 * 出站投递：已提交的房间消息流回微信渠道。
 *
 * 核心不再路由与回复——房间归会话域所有，`im/message-new` 宣告每条持久提交的消息。本模块是
 * 微信适配器的回程腿：挑出作者为智能体、且住在微信背书房间的消息，把正文交给 provider 发送。
 * 投递是尽力而为：持久事实（房间消息）已经安全，因此每个失败都只是一条警告，绝不从事件监听器
 * 里抛出异常。
 *
 * @module @veren/im-wechat/delivery
 */

import type { LoggerService } from '@deepseek-ai/cordis'
import { degradeContent, parseChannelRoomId } from '@veren/im'
import type { ImRegistry } from '@veren/im'
import type { ImMessageNew } from '@veren/im-conversation'

/** Collaborators the delivery needs. */
/** 投递所需的协作者。 */
export interface DeliveryOptions {
  /** The provider id this adapter registered under. */
  /** 本适配器注册所用的 provider id。 */
  readonly providerId: string
  /**
   * The provider registry, resolved per event so delivery always follows the
   * live registration instead of a captured instance.
   * provider 注册表，按事件解析，让投递始终跟随当前注册，而不是捕获的实例。
   */
  readonly registry: ImRegistry
  /** Host logger. */
  /** 宿主日志器。 */
  readonly logger: LoggerService
}

/** The explicit send target recovered from a channel room id. */
/** 从渠道房间号还原出的显式发送目标。 */
export interface DeliveryTarget {
  readonly accountId: string
  readonly conversationId: string
}

/**
 * The send target when this message must reach the WeChat channel, else
 * `undefined`: internal rooms have no channel coordinates, other providers'
 * rooms are not ours, and only agent-authored messages go out — the inbound
 * human message is already on the channel, and echoing it would loop.
 * 当消息必须送达微信渠道时给出发送目标，否则 `undefined`：内部房间没有渠道坐标，其他
 * provider 的房间不归我们，且只有智能体写的消息出站——入站的人类消息已在渠道上，回声会
 * 造成循环。
 */
export function channelTargetOf(payload: ImMessageNew, providerId: string): DeliveryTarget | undefined {
  if (!payload.message.authorId.startsWith('agent:')) return undefined
  const coordinates = parseChannelRoomId(payload.room.id)
  if (coordinates === undefined) return undefined
  if (coordinates.provider !== providerId) return undefined
  return { accountId: coordinates.accountId, conversationId: coordinates.conversationId }
}

/**
 * Deliver one committed room message to the channel when it qualifies. Never
 * throws: an unknown provider, an unknown account, and a rejected send are all
 * warnings, because the room already holds the message.
 * 一条已提交的房间消息符合条件时投递到渠道。绝不抛出：provider 不明、账号不明、发送被拒都
 * 只记警告，因为房间已经持有这条消息。
 */
export async function deliverRoomMessage(options: DeliveryOptions, payload: ImMessageNew): Promise<void> {
  const target = channelTargetOf(payload, options.providerId)
  if (target === undefined) return
  try {
    const provider = options.registry.get(options.providerId)
    await provider.service.send({
      target,
      // 微信带不动 markdown：降级在调用 provider 之前完成，绝不静默丢字。
      // WeChat cannot carry markdown: the downgrade happens before the provider
      // call, and no text is silently dropped.
      content: degradeContent(provider.features, { type: 'text', text: payload.message.body }),
      replyToMessageId: undefined,
    })
  } catch (error: unknown) {
    options.logger.warn(
      `[im:${options.providerId}] outbound delivery of ${payload.message.id} failed: `
        + `${error instanceof Error ? error.message : String(error)}`,
    )
  }
}
