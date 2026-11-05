/**
 * Which live turns the timeline should draw as working rows.
 *
 * A run can outlive the visible fact: the reply is posted, the five-second
 * timeline poll shows it, and the activity poll has not yet noticed the run
 * settled. Drawing the row after the answer would claim the agent is still
 * writing what the reader already sees, so a reply from that agent newer than
 * the run's start hides the row immediately.
 *
 * 时间线应该把哪些实时回合画成工作行。
 *
 * 运行的寿命可能长过可见事实：回复已写入、五秒的时间线轮询已经显示它，而活动轮询还没发现
 * 运行落定。回复之后继续画工作行，等于在读者已经看到答案时仍声称智能体在写，因此只要该
 * 智能体有一条晚于运行开始的回复，就立刻隐藏这一行。
 *
 * @module @veren/im-ui/client/activity-filter
 */

import type { Message } from './remote.ts'
import type { RoomActivity } from './turn-remote.ts'

/**
 * The working rows one room should draw right now.
 * 一个房间此刻应该画出的工作行。
 * @param activities - every live turn across rooms.
 * @param messages - the open room's timeline, oldest first.
 * @param roomId - the open room; other rooms' runs are dropped.
 * @returns the runs that are still working from the reader's point of view.
 */
export function visibleActivities(
  activities: readonly RoomActivity[],
  messages: readonly Message[],
  roomId: string | undefined,
): readonly RoomActivity[] {
  if (roomId === undefined) return []
  const newest = messages[messages.length - 1]
  return activities.filter(run => run.roomId === roomId && !answered(run, newest))
}

/** Whether the newest message is this run's reply, already on screen. */
/** 最新一条消息是否就是这个运行已经上屏的回复。 */
function answered(run: RoomActivity, newest: Message | undefined): boolean {
  if (newest === undefined) return false
  return newest.authorId === run.agentParticipantId && newest.createdAt >= run.startedAt
}
