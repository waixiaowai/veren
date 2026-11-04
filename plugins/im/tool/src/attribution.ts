/**
 * Caller attribution: which agent participant, in which room, is the tool
 * talking for. The turn service's session map is the only truth — the tool
 * never trusts model-supplied identities.
 *
 * 调用方归属：本次工具调用是为哪个智能体参与者、在哪个房间里说话的。回合服务的会话映射
 * 是唯一真相——工具绝不信任模型自报的身份。
 *
 * @module @veren/im-tool/attribution
 */

import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type { TurnService } from '@veren/im-turn'

/** Where the calling session lives: the agent participant and its room. */
/** 调用方会话的位置：智能体参与者与其房间。 */
export interface CallerPlace {
  readonly agentParticipantId: string
  readonly roomId: string
}

/**
 * Resolve the calling session's place through the turn service; `undefined`
 * when the call comes from outside any im-managed session.
 * 经回合服务解析调用方会话的位置；调用来自任何 im 托管会话之外时为 `undefined`。
 */
export function placeOf(turn: TurnService, exec: ToolRunContext): CallerPlace | undefined {
  const sessionId = exec.agent?.session.id
  if (sessionId === undefined) return undefined
  const place = turn.sessionPlaceOf(sessionId)
  if (place === undefined) return undefined
  return { agentParticipantId: place.agentParticipantId, roomId: place.roomId }
}
