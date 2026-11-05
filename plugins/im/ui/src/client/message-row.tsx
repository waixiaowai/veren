/**
 * One message row: author, time, bubble, and the hover copy action.
 *
 * The copy action appears on hover and on keyboard focus (design §24.3: hover
 * only changes colour, never layout), and its confirmation replaces the label
 * in place for 1.2s.
 *
 * 一行消息：作者、时间、气泡，以及悬停复制操作。
 *
 * 复制按钮在悬停与键盘聚焦时出现（设计 §24.3：悬停只改颜色，不改布局），确认文案原地替换
 * 1.2 秒。
 *
 * @module @veren/im-ui/client/message-row
 */

import { useState } from 'react'
import { Avatar } from './avatar.tsx'
import { clockOf, dayLabelOf } from './format.ts'
import type { ImKey } from './locales.ts'
import type { ImPersonView, Message } from './remote.ts'
import { participantLabel } from './participant-label.ts'

/** Props of {@link MessageRow}. */
export interface MessageRowProps {
  readonly message: Message
  readonly startOfDay: boolean
  readonly t: (key: ImKey) => string
  readonly people: readonly ImPersonView[]
}

/** One message row, or the system line, plus its day divider when it starts a day. */
export function MessageRow(props: MessageRowProps): React.JSX.Element {
  const { message, t } = props
  const divider = props.startOfDay ? <li className="im-day">{dayLabelOf(message.createdAt, t)}</li> : null
  if (message.kind === 'system') {
    return <>{divider}<li className="im-line im-line-system"><span className="im-system">{message.body}</span></li></>
  }
  return <>{divider}<Bubble {...props} /></>
}

/** A human or agent message with its copy action. */
function Bubble(props: MessageRowProps): React.JSX.Element {
  const { message, t } = props
  const [copied, setCopied] = useState(false)
  const author = participantLabel(message.authorId, props.people, t)
  const own = message.authorId === 'human:owner'
  const agent = message.authorId.startsWith('agent:')
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(message.body)
      setCopied(true)
      globalThis.setTimeout(() => { setCopied(false) }, 1200)
    } catch {
      // 剪贴板被拒（无安全上下文）：静默失败，不伪造「已复制」。
      // Clipboard denied (no secure context): fail quietly rather than claiming success.
    }
  }
  return (
    <li className={own ? 'im-line im-line-own' : 'im-line'}>
      {!own && <Avatar name={author} kind={agent ? 'agent' : 'human'} size="sm" />}
      <span className="im-line-text">
        <span className="im-line-meta">
          {author} · {clockOf(message.createdAt)}
          <button
            type="button"
            className="im-line-action"
            aria-label={`${t('copy')} ${author}`}
            onClick={() => void copy()}
          >
            {copied ? t('copied') : t('copy')}
          </button>
        </span>
        <span className={own ? 'im-bubble im-bubble-own' : 'im-bubble'}>{message.body}</span>
      </span>
    </li>
  )
}
