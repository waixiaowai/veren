/**
 * The working row: what the agent is doing right now, shown under the last
 * message while its turn runs and gone the moment the reply lands.
 *
 * Non-interactive by design (design §3.2: no streaming reply — the deltas only
 * show the thinking process). It renders the phase, the elapsed time, and the
 * tail of the streamed reasoning; the status text is the only live region, so
 * a screen reader hears "thinking" turn into "running bash" once rather than
 * once a second.
 *
 * 工作行：智能体此刻在做什么，回合运行期间显示在最后一条消息之下，回复落地的瞬间消失。
 *
 * 刻意不可交互（设计 §3.2：没有流式回复——增量只用于展示思考过程）。它渲染阶段、已用时间与
 * 流式推理的末尾；只有状态文案是 live region，因此读屏软件在「思考」变成「正在使用 bash」
 * 时播报一次，而不是每秒一次。
 *
 * @module @veren/im-ui/client/activity-row
 */

import { useEffect, useState } from 'react'
import { Avatar } from './avatar.tsx'
import { fill } from './format.ts'
import type { ImKey } from './locales.ts'
import { participantLabel } from './participant-label.ts'
import type { ImParticipant, ImPersonView } from './remote.ts'
import type { RoomActivity } from './turn-remote.ts'

/** Props of {@link ActivityRow}. */
export interface ActivityRowProps {
  readonly activity: RoomActivity
  readonly people: readonly ImPersonView[]
  readonly participants: readonly ImParticipant[]
  readonly t: (key: ImKey) => string
}

/** One agent's working row. */
export function ActivityRow(props: ActivityRowProps): React.JSX.Element {
  const { activity, t } = props
  const name = participantLabel(activity.agentParticipantId, props.people, t, props.participants)
  const seconds = useElapsedSeconds(activity.startedAt)
  return (
    <li className="im-line im-line-activity">
      <Avatar name={name} kind="agent" size="sm" />
      <span className="im-line-text">
        <span className="im-line-meta">
          {name} · {fill(t('workingFor'), { time: fill(t('workingSeconds'), { s: seconds }) })}
        </span>
        <span className="im-bubble im-bubble-activity">
          <span className="im-activity-dots" aria-hidden="true"><i /><i /><i /></span>
          <span className="im-activity-status" role="status">{statusLine(activity, t)}</span>
        </span>
        {activity.reasoning !== undefined && <span className="im-activity-thought">{activity.reasoning}</span>}
      </span>
    </li>
  )
}

/** The phase as one sentence. */
/** 把阶段说成一句话。 */
function statusLine(activity: RoomActivity, t: (key: ImKey) => string): string {
  if (activity.phase === 'tool') return fill(t('workingTool'), { tool: activity.toolName ?? '' })
  if (activity.phase === 'composing') return t('workingComposing')
  return t('workingThinking')
}

/** Whole seconds since the run started, ticking once a second. */
/** 运行开始至今的整秒数，每秒跳一次。 */
function useElapsedSeconds(startedAt: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = globalThis.setInterval(() => { setNow(Date.now()) }, 1_000)
    return () => { globalThis.clearInterval(timer) }
  }, [])
  return Math.max(0, Math.floor((now - startedAt) / 1_000))
}
