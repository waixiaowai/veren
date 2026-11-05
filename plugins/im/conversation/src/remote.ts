/**
 * The conversation remote: the domain's web face, as an `imConv` Remote
 * namespace. Deliberately thin transport: each Remote method forwards one
 * conversation-service call. The panel mounts this namespace alongside the
 * core's `im` namespace — each domain owns its transport face.
 *
 * 会话远端：域的 Web 面（`imConv` 远端命名空间）。刻意只做薄传输：每个 Remote 方法转发
 * 一次会话服务调用。面板把这个命名空间与核心的 `im` 命名空间一起挂载——每个域拥有自己的
 * 传输面。
 *
 * @module @veren/im-conversation/remote
 */

import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { getOrThrow } from '@veren/core'
import { ConversationToken } from './service.ts'
import type { ConversationService } from './service.ts'

/**
 * The owner participant every web-panel write speaks as. The panel is the
 * workspace owner's view in v1; a room seats this id before it accepts posts.
 * Web 面板每次写入所用的所有者参与者。v1 里面板就是工作区所有者视角；房间接纳写入前
 * 必须已给这个 id 安排座位。
 */
const OWNER_PARTICIPANT = 'human:owner'

/**
 * The web surface over the conversation facade. Injects the conversation
 * token: the same plugin's apply provided it a tick earlier, and cordis
 * resolves the token whenever it is ready (G13).
 * 会话门面之上的 Web 面。注入会话令牌：同一插件的 apply 稍早提供了它，cordis 在就绪时
 * 解析令牌（G13）。
 */
export class ConversationRemoteService extends TypertRemoteService {
  static inject = ['imConversation']

  private readonly conversation: ConversationService

  constructor(ctx: Context) {
    super(ctx, 'imConversationGateway', { namespace: 'imConv' })
    this.conversation = getOrThrow(ctx, ConversationToken)
  }

  /** Every room, projection included. */
  @Remote('rooms')
  async rooms() {
    return { rooms: this.conversation.rooms() }
  }

  /** One room's memberships, roster order. */
  @Remote('roomMembers')
  async roomMembers(request: { readonly roomId: string }) {
    return { members: this.conversation.memberships(request.roomId) }
  }

  /** One room's messages after a sequence, ascending. */
  @Remote('messages')
  async messages(request: { readonly roomId: string; readonly sinceSequence?: number; readonly limit?: number }) {
    return {
      messages: this.conversation.list({
        roomId: request.roomId,
        ...(request.sinceSequence === undefined ? {} : { sinceSequence: request.sinceSequence }),
        ...(request.limit === undefined ? {} : { limit: request.limit }),
      }),
    }
  }

  /**
   * Post one human message into a room. The author is the workspace owner:
   * the web panel is the owner's view (v1), and the service rejects a
   * non-member author, so the room must already seat `human:owner`.
   * 以工作区所有者身份写一条消息。Web 面板是所有者视角（v1），而服务会拒绝非成员作者，
   * 因此房间必须已经给 `human:owner` 安排了座位。
   */
  @Remote('post')
  async post(request: { readonly roomId: string; readonly body: string; readonly clientId?: string }) {
    return this.conversation.post({
      roomId: request.roomId,
      actorId: OWNER_PARTICIPANT,
      kind: 'text',
      body: request.body,
      ...(request.clientId === undefined ? {} : { clientId: request.clientId }),
    })
  }

  /**
   * Create one internal room (group or direct) and seat its members. This is
   * the panel's "new conversation" entry: without it a room can only appear
   * from channel ingest, which leaves a host without a bound channel unusable.
   * 创建一个内部房间（群聊或私聊）并安排成员座位。这是面板的「新建会话」入口：没有它，
   * 房间只能由渠道入站产生，未绑定渠道的宿主将无法使用。
   */
  @Remote('createRoom')
  async createRoom(request: {
    readonly kind: 'direct' | 'group'
    readonly title?: string
    readonly memberIds: readonly string[]
  }) {
    const room = await this.conversation.createRoom({
      kind: request.kind,
      ...(request.title === undefined ? {} : { title: request.title }),
      memberIds: [...request.memberIds],
    })
    return { room }
  }

  /**
   * Unread counts for one participant across every room, as the sidebar renders
   * them. One call per poll instead of one call per room.
   * 一个参与者在全部房间的未读数，供侧栏渲染。每次轮询一次调用，而不是每个房间一次。
   */
  @Remote('unreadCounts')
  async unreadCounts(request: { readonly participantId: string }) {
    const counts = this.conversation.rooms().map(room => ({
      roomId: room.id,
      unread: this.conversation.unread(room.id, request.participantId),
    }))
    return { counts }
  }

  /** Advance one read cursor (the panel marks what the human saw). */
  @Remote('markRead')
  async markRead(request: { readonly roomId: string; readonly participantId: string; readonly sequence: number }) {
    const cursor = await this.conversation.markRead(request.roomId, request.participantId, request.sequence)
    return { cursor }
  }
}
