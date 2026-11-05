/**
 * @veren/im-conversation plugin entry: opens the durable conversation domain,
 * assembles rooms/post/reads into the conversation facade, subscribes channel
 * observations, and publishes the `imConversation` service.
 *
 * The plugin is pure downstream of @veren/im: it consumes
 * `im/message-observed` and emits `im/message-new` / `im/room-updated`. It
 * ships no wake policy — that is @veren/im-coordination's.
 *
 * @veren/im-conversation 插件入口：打开持久会话域，把 rooms/post/reads 组装成会话门面，
 * 订阅渠道观察，并发布 `imConversation` 服务。
 *
 * 本插件是 @veren/im 的纯下游：消费 `im/message-observed`，发出 `im/message-new` 与
 * `im/room-updated`。它不带唤醒策略——那是 @veren/im-coordination 的事。
 *
 * @module @veren/im-conversation
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import './events.ts'
import { ConvStorage } from './store.ts'
import { RoomService } from './rooms.ts'
import { PostService } from './post.ts'
import { ReadService } from './reads.ts'
import { Ingest } from './ingest.ts'
import { ConversationFacade, ConversationToken } from './service.ts'
import { ConversationRemoteService } from './remote.ts'

export * from './types.ts'
export * from './rows.ts'
export { CONVERSATION_DOMAIN_NAME, conversationDomain } from './schema.ts'
export type { ConversationStore } from './schema.ts'
export { ConvStorage, tablesOf } from './store.ts'
export type { ConvTable, ConvTables } from './store.ts'
export { RoomService, SYSTEM_AUTHOR } from './rooms.ts'
export { DEFAULT_LIST_LIMIT, MAX_BODY_CHARS, MAX_LIST_LIMIT, PostService } from './post.ts'
export { ReadService } from './reads.ts'
export { Ingest } from './ingest.ts'
export { ConversationFacade, ConversationToken } from './service.ts'
export { ConversationRemoteService } from './remote.ts'
export type { ConversationService } from './service.ts'
export type { ImMessageNew, ImRoomUpdated } from './events.ts'

/** Plugin name. */
/** 插件名。 */
export const name = 'imConversation'

/**
 * Host services: durable storage plus the core's people directory and
 * participant roster (both provided by @veren/im).
 * 宿主服务：持久存储，加上核心的人员目录与参与者名册（均由 @veren/im 提供）。
 */
export const inject = ['storageDomain', 'imPeople'] as const
/** Services this plugin provides. */
/** 本插件提供的服务。 */
export const provide = [ConversationToken] as const

/** Plugin configuration. */
/** 插件配置。 */
export interface Config {
  /**
   * The preset whose agent answers channel rooms. Absent: the synthesized
   * default agent answers with the deployment persona.
   * 其智能体应答渠道房间的 preset。缺省：合成的默认智能体以部署人格应答。
   */
  channelAgentPreset?: string
}
/** Configuration schema. */
/** 配置 schema。 */
export const Config: z<Config> = z.object({
  channelAgentPreset: z.string().min(1).required(false),
})

/** Options for the ingest builder, narrowed to what it reads. */
/** 吸收器构建选项，收窄到它实际读取的部分。 */
type IngestConfig = Pick<Config, 'channelAgentPreset'>

/**
 * Assemble the ingest and subscribe it to channel observations.
 * 组装吸收器并订阅渠道观察。
 */
function wireIngest(ctx: Context, config: IngestConfig, rooms: RoomService, post: PostService): void {
  const ingest = new Ingest({
    people: ctx.imPeople,
    rooms,
    post,
    ...(config.channelAgentPreset === undefined ? {} : { channelAgentPreset: config.channelAgentPreset }),
  })
  ctx.effect(
    () => ctx.on('im/message-observed', payload => ingest.observe(payload)),
    'im-conversation:ingest',
  )
}

/**
 * Apply the conversation plugin.
 * @param ctx - host context.
 * @param config - validated plugin configuration.
 */
export const apply = async (ctx: Context, config: Config): Promise<void> => {
  const storage = new ConvStorage()
  await storage.open(ctx)
  ctx.effect(() => () => storage.close(), 'im-conversation:storage')

  const rooms = new RoomService({ store: storage })
  // 每条写入路径（渠道吸收、im_send、Web 输入区）都在提交后发出同一个事件：唤醒扇出与
  // 面板刷新只认这一个事实来源。
  // Every write path — channel ingest, im_send, the web composer — announces the
  // same fact after commit: the wake fan-out and the panel refresh have exactly
  // one source.
  const post = new PostService({
    store: storage,
    rooms,
    committed: ({ room, message }) => { ctx.emit('im/message-new', { room, message }) },
  })
  const reads = new ReadService({ store: storage })
  const facade = new ConversationFacade(rooms, post, reads)
  ctx.effect(() => ctx.provide(ConversationToken, facade), 'im-conversation:service')

  wireIngest(ctx, config, rooms, post)
  ctx.effect(
    () => ctx.on('im/message-new', ({ room }) => {
      ctx.emit('im/room-updated', { room })
    }),
    'im-conversation:room-echo',
  )
  // Web 面板的会话读取面：`imConv` 远端命名空间（房间/成员/消息/已读）。
  // The web panel's conversation face: the `imConv` remote namespace (rooms,
  // members, messages, read cursors).
  ctx.plugin(ConversationRemoteService)
}
