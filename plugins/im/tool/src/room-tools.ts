/**
 * The read-side room tools: `im_rooms` (the roster of rooms with unread
 * counts) and `im_read` (one room's messages, advancing only the read cursor).
 *
 * Neither tool advances the seen watermark — that is the turn engine's business
 * — so reading never fabricates "you have seen this". Only the monotonic read
 * cursor moves, and only for the calling agent.
 *
 * 读取侧的房间工具：`im_rooms`（房间名册与未读数）与 `im_read`（一个房间的消息，只推进
 * 已读游标）。
 *
 * 两个工具都不推进已见水位——那是回合引擎的事——读取因此绝不会伪造「你已经看过」。只有
 * 单调的已读游标会动，且只为调用方而动。
 *
 * @module @veren/im-tool/room-tools
 */

import { defineTool, type InferArgs, type ParameterSchemaSpec } from '@deepseek-ai/dsh-tools'
import { ImError } from '@veren/im'
import type { ConversationService, Message, Room } from '@veren/im-conversation'
import type { ImParticipants } from '@veren/im'
import type { TurnService } from '@veren/im-turn'
import { placeOf } from './attribution.ts'
import { excerptOf, ok, OUTPUT, outsideRoom, run } from './values.ts'

/** Excerpt length of a last-message line in the room list. */
/** 房间列表里最后一条消息摘录的长度。 */
const EXCERPT_CHARS = 200

/** `im_rooms` description: read-only orientation over the room roster. */
/** `im_rooms` 描述：房间名册之上的只读定向。 */
const ROOMS_DESCRIPTION = 'List every IM room you could act in: id, kind, title, members with display names, '
  + 'your unread count, and an excerpt of the latest line. Read-only: nothing is marked read '
  + 'or seen. Use it to decide where to look next; im_read loads one room\'s messages.'

/** `im_read` description: one room's transcript without side effects on triage. */
/** `im_read` 描述：一个房间的记录，不影响分流状态。 */
const READ_DESCRIPTION = 'Read one IM room\'s messages, oldest first. Optionally start after a sequence '
  + 'number and cap the number of lines. Reading advances your read cursor (unread counts) but '
  + 'NOT your seen watermark — the turn engine owns that — so triage still treats you as not '
  + 'having reacted. Missing room fails with CONVERSATION_NOT_FOUND.'

/** `im_read` parameters. */
/** `im_read` 参数。 */
const READ_PARAMETERS = {
  roomId: { type: 'string', required: true, description: 'The room to read, as im_rooms reported it.' },
  sinceSequence: { type: 'number', description: 'Exclusive lower bound: only lines strictly after this sequence.' },
  limit: { type: 'number', description: 'Maximum lines to return (default and maximum follow the domain limits).' },
} as const satisfies ParameterSchemaSpec

/** Inferred argument shapes. */
/** 推导出的参数形状。 */
type ReadArgs = InferArgs<typeof READ_PARAMETERS>

/** Project one message onto the tool view. */
/** 把一条消息投影成工具视图。 */
function messageView(message: Message): Record<string, unknown> {
  return {
    id: message.id,
    authorId: message.authorId,
    kind: message.kind,
    sequence: message.sequence,
    body: message.body,
    createdAt: message.createdAt,
    ...(message.clientId === undefined ? {} : { clientId: message.clientId }),
  }
}

/** The last line of one room, any author, as an excerpt view. */
/** 一个房间的最后一行（任意作者），摘录视图。 */
function lastLineOf(conversation: ConversationService, roomId: string): Record<string, unknown> | undefined {
  const all = conversation.list({ roomId })
  const last = all[all.length - 1]
  if (last === undefined) return undefined
  return { sequence: last.sequence, authorId: last.authorId, excerpt: excerptOf(last.body, EXCERPT_CHARS) }
}

/** One room projected for the roster: members named, unread counted. */
/** 投影成名册视图的一个房间：成员具名、未读计数。 */
function roomView(
  conversation: ConversationService,
  participants: ImParticipants,
  room: Room,
  agentId: string,
): Record<string, unknown> {
  const members = conversation.memberships(room.id).map(member => {
    const view = participants.resolve(member.participantId)
    return {
      participantId: member.participantId,
      displayName: view?.displayName ?? member.participantId,
      kind: view?.kind ?? 'human',
    }
  })
  return {
    id: room.id,
    kind: room.kind,
    ...(room.title === undefined ? {} : { title: room.title }),
    members,
    unread: conversation.unread(room.id, agentId),
    ...(lastLineOf(conversation, room.id)),
  }
}

/** The `im_rooms` execution: a full read-only roster for the calling agent. */
/** `im_rooms` 执行：为调用方整理一份完整的只读名册。 */
function roomsExecute(conversation: ConversationService, participants: ImParticipants, turn: TurnService) {
  return async (_args: Record<string, never>, exec: Parameters<ReturnType<typeof defineTool>['execute']>[1]) => run(async () => {
    const place = placeOf(turn, exec)
    if (place === undefined) return outsideRoom()
    const rooms = conversation.rooms().map(room => roomView(conversation, participants, room, place.agentParticipantId))
    return ok({ rooms })
  })
}

/** The `im_read` execution: one room's lines, then the caller's read cursor. */
/** `im_read` 执行：一个房间的消息行，随后推进调用方的已读游标。 */
function readExecute(conversation: ConversationService, turn: TurnService) {
  return async (args: ReadArgs, exec: Parameters<ReturnType<typeof defineTool>['execute']>[1]) => run(async () => {
    const place = placeOf(turn, exec)
    if (place === undefined) return outsideRoom()
    const room = conversation.room(args.roomId)
    if (room === undefined) {
      throw new ImError('CONVERSATION_NOT_FOUND', `no such room: ${args.roomId ?? ''}`)
    }
    const messages = conversation.list({
      roomId: room.id,
      ...(args.sinceSequence === undefined ? {} : { sinceSequence: args.sinceSequence }),
      ...(args.limit === undefined ? {} : { limit: args.limit }),
    })
    const last = messages[messages.length - 1]
    const cursor = last === undefined
      ? conversation.readSequence(room.id, place.agentParticipantId)
      : (await conversation.markRead(room.id, place.agentParticipantId, last.sequence)).lastReadSequence
    return ok({
      roomId: room.id,
      messages: messages.map(messageView),
      readSequence: cursor,
    })
  })
}

/**
 * Build the read-side room tools.
 * @param conversation - the conversation facade.
 * @param participants - the roster for display names.
 * @param turn - the session→place reverse lookup.
 */
export function imRoomsTool(conversation: ConversationService, participants: ImParticipants, turn: TurnService) {
  return defineTool({
    name: 'im_rooms',
    description: ROOMS_DESCRIPTION,
    parameters: {} as const satisfies ParameterSchemaSpec,
    output: OUTPUT,
    execute: roomsExecute(conversation, participants, turn),
  })
}

/** Build the `im_read` tool definition over the conversation facade. */
/** 在会话门面之上构建 `im_read` 工具定义。 */
export function imReadTool(conversation: ConversationService, turn: TurnService) {
  return defineTool({
    name: 'im_read',
    description: READ_DESCRIPTION,
    parameters: READ_PARAMETERS,
    output: OUTPUT,
    execute: readExecute(conversation, turn),
  })
}
