/**
 * The room-id scheme for channel-backed rooms.
 *
 * A conversation domain room is either internal (`conv:`) or backed by a
 * channel conversation (`chan:`). Only the channel adapter scope — this
 * module — knows the encoding; every other package treats room ids as opaque
 * strings and asks here when it needs the channel coordinates back.
 *
 * 渠道背书房间的房间号方案。
 *
 * 会话域的房间要么是内部的（`conv:`），要么由渠道会话背书（`chan:`）。只有渠道适配器范围
 * ——即本模块——知道编码方式；其余包把房间号当作不透明字符串，需要渠道坐标时回到这里解析。
 *
 * @module @veren/im/channel-room
 */

/** Channel coordinates recovered from a channel-backed room id. */
/** 从渠道背书的房间号里还原出的渠道坐标。 */
export interface ImChannelRoomCoordinates {
  readonly provider: string
  readonly accountId: string
  /** The provider's own conversation id; may itself contain colons. */
  /** provider 自己的会话 id；本身可能包含冒号。 */
  readonly conversationId: string
}

/**
 * Build the room id for one channel conversation. Deterministic so the same
 * channel conversation always maps to the same room across restarts.
 * 为一个渠道会话构建房间号。确定性编码——同一渠道会话跨重启总是映射到同一房间。
 */
export function channelRoomId(provider: string, accountId: string, conversationId: string): string {
  return `chan:${provider}:${accountId}:${conversationId}`
}

/**
 * Recover the channel coordinates from a channel-backed room id; `undefined`
 * for internal rooms or malformed ids.
 * 从渠道背书的房间号还原渠道坐标；内部房间或畸形 id 返回 `undefined`。
 */
export function parseChannelRoomId(roomId: string): ImChannelRoomCoordinates | undefined {
  if (!roomId.startsWith('chan:')) return undefined
  const parts = roomId.split(':')
  if (parts.length < 4) return undefined
  const [, provider, accountId] = parts
  if (provider === undefined || provider === '' || accountId === undefined || accountId === '') {
    return undefined
  }
  return { provider, accountId, conversationId: parts.slice(3).join(':') }
}
