/**
 * Who can still be seated in a group room: every roster agent plus every
 * address-book person who is not a member yet, agents first.
 *
 * Pure derivation over the room's member projection and the two rosters, so the
 * invite list can be unit-tested without a browser.
 *
 * 一个群聊还能收起谁：名册里的每个智能体，加上通讯录里尚未入座的每个人，智能体在前。
 *
 * 这是对房间成员投影与两份名册的纯推导，因此邀请清单可以脱离浏览器做单元测试。
 *
 * @module @veren/im-ui/client/invite-candidates
 */

import type { ImKey } from './locales.ts'
import { participantLabel } from './participant-label.ts'
import type { ImParticipant, ImPersonView, Room } from './remote.ts'

/** One selectable invitee: a room participant id with its rendered name. */
/** 一个可邀请对象：房间参与者 id 及其显示名。 */
export interface InviteCandidate {
  readonly id: string
  readonly label: string
  readonly kind: 'human' | 'agent'
}

/**
 * The people and agents one group room can still seat.
 * @param room - the open room; its `members` projection is the take-out list.
 * @param people - the people directory, for `human:<personId>` invitees.
 * @param participants - the host roster, whose agents are the `agent:` invitees.
 * @param t - locale seat.
 * @returns candidates in display order: agents, then people, each id once.
 */
export function inviteCandidates(
  room: Room,
  people: readonly ImPersonView[],
  participants: readonly ImParticipant[],
  t: (key: ImKey) => string,
): InviteCandidate[] {
  const seated = new Set(room.members)
  const agents = participants
    .filter(participant => participant.kind === 'agent' && !seated.has(participant.id))
    .map(participant => candidateOf(participant.id, 'agent', people, participants, t))
  const humans = people
    .map(person => `human:${person.id}`)
    .filter(id => !seated.has(id))
    .map(id => candidateOf(id, 'human', people, participants, t))
  return dedupe([...agents, ...humans])
}

/** One candidate row: the id plus the one label the page renders. */
/** 一行候选：id 加上页面渲染的那一个名字。 */
function candidateOf(
  id: string,
  kind: InviteCandidate['kind'],
  people: readonly ImPersonView[],
  participants: readonly ImParticipant[],
  t: (key: ImKey) => string,
): InviteCandidate {
  return { id, kind, label: participantLabel(id, people, t, participants) }
}

/** First occurrence wins, so one participant id never appears twice. */
/** 先出现者胜出，同一个参与者 id 绝不出现两次。 */
function dedupe(candidates: readonly InviteCandidate[]): InviteCandidate[] {
  return [...new Map(candidates.map(candidate => [candidate.id, candidate])).values()]
}
