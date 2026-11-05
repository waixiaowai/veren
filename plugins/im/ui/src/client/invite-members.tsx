/**
 * The invite control on the conversation info rail: a group room seats more
 * people and agents after creation, one picker at a time.
 *
 * A direct room never renders it — its two seats are the room itself. Agents
 * and people share the rows of the new-conversation picker; the hint repeats
 * what being seated in a group means: an agent still wakes only when mentioned.
 *
 * 会话信息侧栏上的邀请控件：群聊在创建之后继续收起人与智能体，一次一个选择器。
 *
 * 私聊永不渲染它——两个座位就是房间本身。智能体与人员共用新建会话选择器的行；提示重申群聊的
 * 座位含义：智能体仍然只在被点名时醒来。
 *
 * @module @veren/im-ui/client/invite-members
 */

import { useState } from 'react'
import { inviteCandidates } from './invite-candidates.ts'
import type { InviteCandidate } from './invite-candidates.ts'
import type { ImKey } from './locales.ts'
import { MemberPickList } from './member-pick-list.tsx'
import type { ImParticipant, ImPersonView, Room } from './remote.ts'

/** Props of {@link InviteMembers}. */
export interface InviteMembersProps {
  readonly room: Room
  readonly t: (key: ImKey) => string
  readonly people: readonly ImPersonView[]
  readonly participants: readonly ImParticipant[]
  /** Seat the picked ids; resolves whether they joined (failure keeps the picker). */
  /** 让选中的 id 入座；返回是否成功（失败时选择器保持打开）。 */
  readonly onInvite: (roomId: string, memberIds: readonly string[]) => Promise<boolean>
}

/** The invite button plus its picker, or nothing when no candidate remains. */
/** 邀请按钮及其选择器；没有候选可邀请时什么都不渲染。 */
export function InviteMembers(props: InviteMembersProps): React.JSX.Element | null {
  const { room, t } = props
  const [open, setOpen] = useState(false)
  const [picked, setPicked] = useState<readonly string[]>([])
  const [sending, setSending] = useState(false)
  const options = inviteCandidates(room, props.people, props.participants, t)
  // 钩子必须跑在早退之前；私聊与「全都已在群里」都收起入口。
  // Hooks run before any early return; a direct room and an exhausted roster
  // both drop the entry point.
  if (room.kind !== 'group' || options.length === 0) return null
  const close = (): void => { setOpen(false); setPicked([]) }
  const submit = submitInvite(props, picked, sending, setSending, close)
  return (
    <InvitePanel
      open={open}
      t={t}
      options={options}
      picked={picked}
      sending={sending}
      onToggleOpen={() => { if (open) close(); else setOpen(true) }}
      onToggle={id => setPicked(picked.includes(id) ? picked.filter(item => item !== id) : [...picked, id])}
      onSubmit={() => void submit()}
      onCancel={close}
    />
  )
}

/** The invite entry: the toggle button plus the picker while it is open. */
function InvitePanel(props: {
  readonly open: boolean
  readonly t: (key: ImKey) => string
  readonly options: readonly InviteCandidate[]
  readonly picked: readonly string[]
  readonly sending: boolean
  readonly onToggleOpen: () => void
  readonly onToggle: (id: string) => void
  readonly onSubmit: () => void
  readonly onCancel: () => void
}): React.JSX.Element {
  return (
    <div className="im-invite">
      <button type="button" className="im-button" onClick={props.onToggleOpen}>
        {props.t('inviteMembers')}
      </button>
      {props.open && (
        <InvitePicker
          options={props.options}
          picked={props.picked}
          sending={props.sending}
          t={props.t}
          onToggle={props.onToggle}
          onSubmit={props.onSubmit}
          onCancel={props.onCancel}
        />
      )}
    </div>
  )
}

/** The send action: seat the pick, keep the picker open when the host refuses. */
function submitInvite(
  props: InviteMembersProps,
  picked: readonly string[],
  sending: boolean,
  setSending: (sending: boolean) => void,
  close: () => void,
): () => Promise<void> {
  return async () => {
    if (sending || picked.length === 0) return
    setSending(true)
    const joined = await props.onInvite(props.room.id, picked)
    setSending(false)
    if (joined) close()
  }
}

/** The open picker: every remaining candidate, the group hint, and the two actions. */
/** 打开的选择器：全部剩余候选、群聊提示与两个动作。 */
function InvitePicker(props: {
  readonly options: readonly InviteCandidate[]
  readonly picked: readonly string[]
  readonly sending: boolean
  readonly t: (key: ImKey) => string
  readonly onToggle: (id: string) => void
  readonly onSubmit: () => void
  readonly onCancel: () => void
}): React.JSX.Element {
  const { t } = props
  return (
    <div className="im-invite-picker">
      <MemberPickList title={t('invitePick')} options={props.options} picked={props.picked} onToggle={props.onToggle} />
      <p className="im-hint">{t('groupHint')}</p>
      <div className="im-row">
        <button
          type="button"
          className="im-button im-button-primary"
          disabled={props.picked.length === 0 || props.sending}
          onClick={props.onSubmit}
        >
          {t('inviteConfirm')}
        </button>
        <button type="button" className="im-button" onClick={props.onCancel}>{t('cancel')}</button>
      </div>
    </div>
  )
}
