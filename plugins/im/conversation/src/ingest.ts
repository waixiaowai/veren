/**
 * Channel ingest: turn one provider observation into a durable room message.
 *
 * The room id is deterministic (`chan:provider:account:conversation`), so the
 * same channel conversation always lands in the same room across restarts.
 * The inbound provider message id becomes the post's client id, which makes
 * provider redelivery an idempotent replay instead of a duplicate. The sender
 * is seated as a rostered human participant; the room's answering agent comes
 * from config (`channelAgentPreset`) or the synthesized default agent.
 *
 * 渠道吸收：把一条 provider 观察变成一条持久的房间消息。
 *
 * 房间号是确定性的（`chan:provider:account:conversation`），因此同一渠道会话跨重启总是
 * 落进同一房间。入站 provider 消息 id 成为写入的 client id，provider 重投因此是幂等回放
 * 而不是重复。发送者作为名册内的人类参与者入座；房间的应答智能体来自配置
 * （`channelAgentPreset`）或合成的默认智能体。
 *
 * @module @veren/im-conversation/ingest
 */

import {
  DEFAULT_AGENT_PARTICIPANT_ID,
  ImError,
  agentParticipantId,
  channelRoomId,
  contentToPrompt,
  humanParticipantId,
} from '@veren/im'
import type { ImPeople, ImMessage } from '@veren/im'
import type { ImMessageObserved } from '@veren/im'
import type { PostService } from './post.ts'
import type { RoomService } from './rooms.ts'

/** Options for the ingest; everything arrives by injection. */
/** 吸收的选项；一切都走注入。 */
export interface IngestOptions {
  readonly people: ImPeople
  readonly rooms: RoomService
  readonly post: PostService
  /** Preset whose agent answers channel rooms; absent = the default agent. */
  /** 其智能体应答渠道房间的 preset；缺省 = 默认智能体。 */
  readonly channelAgentPreset?: string
}

/** The channel-to-room ingest. */
/** 渠道到房间的吸收。 */
export class Ingest {
  private readonly agentId: string

  /**
   * @param options - injected collaborators plus the channel-agent choice.
   */
  constructor(private readonly options: IngestOptions) {
    this.agentId = options.channelAgentPreset === undefined
      ? DEFAULT_AGENT_PARTICIPANT_ID
      : agentParticipantId(options.channelAgentPreset)
  }

  /** The agent participant answering channel rooms. */
  /** 应答渠道房间的智能体参与者。 */
  get channelAgentId(): string {
    return this.agentId
  }

  /**
   * Ingest one observation: seat the room, then post the message durably. The
   * post service announces `im/message-new` for a fresh commit only, so a
   * provider redelivery stays silent without a second emission here.
   * 吸收一条观察：安排房间座位，然后持久写入消息。只有新提交由写入服务发出
   * `im/message-new`，因此 provider 重投自然保持沉默，这里无需再发一次。
   */
  async observe(payload: ImMessageObserved): Promise<void> {
    const { providerId, message } = payload
    const person = await this.options.people.observeMessage(providerId, message)
    if (person === undefined) {
      throw new ImError('IM_INVALID_REQUEST', `the sender of ${message.id} could not be recorded`)
    }
    const roomId = channelRoomId(providerId, message.accountId, message.conversationId)
    const senderId = humanParticipantId(person.id)
    await this.options.rooms.ensureChannelRoom({
      roomId,
      title: person.displayName,
      memberIds: [senderId, this.agentId],
    })
    await this.options.post.post({
      roomId,
      actorId: senderId,
      kind: 'text',
      body: bodyOf(message),
      clientId: message.id,
    })
  }
}

/** Render one message's content as the durable body (v1 channels are text). */
/** 把一条消息的内容渲染成持久正文（v1 渠道是文本）。 */
function bodyOf(message: ImMessage): string {
  return contentToPrompt(message.content)
}
