/**
 * One selectable roster: a titled column of toggle rows with an avatar per
 * entry.
 *
 * Shared by the new-conversation picker (who gets seated at creation) and the
 * group invite control (who gets seated later), so both render the same row.
 *
 * 一份可选名册：带标题的一列开关行，每行一个头像。
 *
 * 新建会话选择器（创建时谁入座）与群聊邀请控件（之后谁入座）共用本组件，两处的行长得一模一样。
 *
 * @module @veren/im-ui/client/member-pick-list
 */

import { Avatar } from './avatar.tsx'

/** One selectable member. */
/** 一个可选成员。 */
export interface MemberOption {
  readonly id: string
  readonly label: string
  readonly kind: 'human' | 'agent'
}

/** Props of {@link MemberPickList}. */
export interface MemberPickListProps {
  readonly title: string
  readonly options: readonly MemberOption[]
  readonly picked: readonly string[]
  readonly onToggle: (id: string) => void
  /** A direct room seats nobody else, so its people rows stay non-selectable. */
  /** 私聊不再坐人，因此它的人员行不可选。 */
  readonly disabled?: boolean
}

/** One titled list of toggle rows. */
/** 一份带标题的开关行清单。 */
export function MemberPickList(props: MemberPickListProps): React.JSX.Element {
  return (
    <div className="im-member-pick">
      <span className="im-label">{props.title}</span>
      <ul className="im-pick-list" role="list">
        {props.options.map(option => (
          <li key={option.id}>
            <MemberRow
              option={option}
              active={props.picked.includes(option.id)}
              disabled={props.disabled === true && !props.picked.includes(option.id)}
              onToggle={props.onToggle}
            />
          </li>
        ))}
      </ul>
    </div>
  )
}

/** One row: avatar, name, and the check mark while picked. */
/** 一行：头像、名字，选中时带勾。 */
function MemberRow(props: {
  readonly option: MemberOption
  readonly active: boolean
  readonly disabled: boolean
  readonly onToggle: (id: string) => void
}): React.JSX.Element {
  const { option } = props
  return (
    <button
      type="button"
      className={props.active ? 'im-pick im-pick-active' : 'im-pick'}
      aria-pressed={props.active}
      disabled={props.disabled}
      onClick={() => props.onToggle(option.id)}
    >
      <Avatar name={option.label} kind={option.kind} size="sm" glyph />
      <span>{option.label}</span>
      {props.active && <span className="im-pick-mark" aria-hidden="true">✓</span>}
    </button>
  )
}
