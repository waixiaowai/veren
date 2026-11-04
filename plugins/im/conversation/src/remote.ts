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

  /** Advance one read cursor (the panel marks what the human saw). */
  @Remote('markRead')
  async markRead(request: { readonly roomId: string; readonly participantId: string; readonly sequence: number }) {
    const cursor = await this.conversation.markRead(request.roomId, request.participantId, request.sequence)
    return { cursor }
  }
}
