/**
 * The turn prompt: the room-context envelope one wake becomes. Persona lives
 * in the preset; this envelope carries only the facts of this wake — the
 * room, the roster, the unread messages, and the reply contract.
 *
 * 回合 prompt：一次唤醒变成的房间上下文信封。人格活在 preset 里；这个信封只携带本次
 * 唤醒的事实——房间、名册、未读消息与回复契约。
 *
 * @module @veren/im-turn/prompt
 */

import { ImParticipants } from '@veren/im'
import type { Message, Room } from '@veren/im-conversation'

/** How many unread messages one prompt carries (the rest wait for the next wake). */
/** 一条 prompt 携带的未读消息数上限（其余等下一次唤醒）。 */
export const MAX_PROMPT_MESSAGES = 40

/** Assemble the prompt for one run's inbox. */
/** 为一次运行的收件箱组装 prompt。 */
export function buildPrompt(input: {
  readonly room: Room
  readonly agentId: string
  readonly participants: ImParticipants
  readonly unread: readonly Message[]
}): string {
  const sections = [
    roomSection(input.room, input.participants),
    inboxSection(input.unread, input.participants),
    replyContract(),
  ]
  return sections.filter(section => section !== '').join('\n\n')
}

/** The room section: identity, kind, and the roster (humans first, per design). */
/** 房间区块：身份、类型与名册（按设计，人类在前）。 */
function roomSection(room: Room, participants: ImParticipants): string {
  const members = room.members
    .map(id => participants.resolve(id))
    .filter(view => view !== undefined)
    .map(view => `${view.displayName}（${view.kind === 'agent' ? '智能体' : '人'}）`)
  return [
    '[Room]',
    `房间：${room.title ?? room.id}`,
    `类型：${room.kind === 'direct' ? '私聊' : '群聊'}`,
    `成员：${members.join('、')}`,
  ].join('\n')
}

/** The inbox section: the unread messages, one line each. */
/** 收件箱区块：未读消息，一行一条。 */
function inboxSection(unread: readonly Message[], participants: ImParticipants): string {
  if (unread.length === 0) return ''
  const lines = unread.slice(0, MAX_PROMPT_MESSAGES).map(message => {
    const author = participants.resolve(message.authorId)
    const name = author?.displayName ?? message.authorId
    const kindTag = author?.kind === 'agent' ? '智能体' : '人'
    return `#${message.sequence} ${name}（${kindTag}）：${message.body.replace(/\s+/g, ' ').slice(0, 2_000)}`
  })
  const overflow = unread.length > MAX_PROMPT_MESSAGES
    ? `\n（另有 ${unread.length - MAX_PROMPT_MESSAGES} 条更早的未读，下次唤醒继续处理）`
    : ''
  return ['[New messages]', ...lines].join('\n') + overflow
}

/** The reply contract (design language: the model's output IS the room message). */
/** 回复契约（设计语言：模型输出就是房间消息）。 */
function replyContract(): string {
  return [
    '[Reply contract]',
    '你本轮输出的全部文本会作为一条消息发进上面的房间，此外没有别的回信机制。',
    '直接输出要发给房间的内容；不要复述这些元信息，不要调用发送类工具。',
    '如果判断不需要回应，输出空内容（保持安静是正当选择）。',
    '若工具结果告知发言被拒（HELD），说明房间里有你没看到的新消息，已附在结果里：'
    + '基于新事实改写，或保持安静。',
  ].join('\n')
}

/** The re-prompt one gate hold becomes: the unseen facts, then the same contract. */
/** 一次闸门拒绝变成的再提示：未看到的事实在前，同一份契约在后。 */
export function buildHoldPrompt(input: {
  readonly draft: string
  readonly newer: readonly string[]
  readonly kind: string
}): string {
  const lines = input.newer.length > 0
    ? input.newer.map(line => `- ${line}`)
    : ['- 你的上一条回复与房间最近的发言逐字重复']
  return [
    '[Your reply was held]',
    `你上一条回复没有被发送（原因：${input.kind === 'freshness' ? '房间里有更新的发言' : '与最近的发言重复'}）。`,
    '你没看到的内容：',
    ...lines,
    '请基于以上事实重新决定：改写后重发，或输出空内容保持安静。',
  ].join('\n')
}
