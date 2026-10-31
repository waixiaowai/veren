/**
 * The cloud tab's people directory: the heading with one person card per
 * directory entry, or the designed empty block — each card carries its address
 * bindings and the inline rename/note editor.
 *
 * 云端页签的人员目录：标题加每条目录一张人员卡，或专门设计的空态块——每张卡带地址绑定
 * 与行内改名/备注编辑器。
 *
 * @module @veren/im-ui/client/cloud-directory
 */

import { useState } from 'react'
import type { CmsAddress, CmsPerson } from './cms.ts'
import type { DirectoryData, EditDraft, Translate } from './cloud-home-types.ts'
import { EmptyBlock } from './cloud-empty.tsx'

/** The people directory: heading + person cards, or the designed empty block. */
/** 人员目录：标题+人员卡，或专门设计的空态块。 */
export function Directory(props: {
  readonly t: Translate
  readonly rows: DirectoryData | undefined
  readonly onSave: (draft: EditDraft) => Promise<boolean>
}): React.JSX.Element {
  const { t, rows } = props
  const [editing, setEditing] = useState<EditDraft | undefined>()
  if (rows === undefined) return <EmptyBlock title={t('loading')} />
  if (rows.people.length === 0) {
    return <EmptyBlock title={t('cloudEmptyTitle')} hint={t('cloudEmptyHint')} />
  }
  return (
    <>
      <h3 className="im-heading">{t('people')}</h3>
      <ul className="im-list">
        {rows.people.map(person => (
          <PersonCard key={person.id} t={t} person={person}
            bound={rows.addresses[person.id] ?? []}
            draft={editing?.id === person.id ? editing : undefined}
            onEdit={() => setEditing({ id: person.id, displayName: person.display_name, note: person.note })}
            onDraft={setEditing}
            onCancel={() => setEditing(undefined)}
            onSave={async draft => {
              if (await props.onSave(draft)) setEditing(undefined)
            }} />
        ))}
      </ul>
    </>
  )
}

/** One person card: identity facts + bindings, or the inline rename/note editor. */
/** 一张人员卡：身份数据+绑定，或行内改名/备注编辑器。 */
function PersonCard(props: {
  readonly t: Translate
  readonly person: CmsPerson
  readonly bound: readonly CmsAddress[]
  readonly draft: EditDraft | undefined
  readonly onEdit: () => void
  readonly onDraft: (draft: EditDraft) => void
  readonly onCancel: () => void
  readonly onSave: (draft: EditDraft) => Promise<void>
}): React.JSX.Element {
  const { t, person, bound, draft } = props
  if (draft !== undefined) {
    return <PersonEditor t={t} draft={draft} onDraft={props.onDraft} onCancel={props.onCancel} onSave={props.onSave} />
  }
  return (
    <li className="im-item">
      <span className="im-strong">{person.display_name}</span>
      {person.claimed_name !== '' && person.claimed_name !== person.display_name
        && <span className="im-muted">{t('cloudSelfReported')}{person.claimed_name}</span>}
      {person.note !== '' && <span className="im-muted">{t('cloudNote')}{person.note}</span>}
      <span className="im-id-mono">{bound.map(address => `${address.provider}/${address.external_id}`).join(' · ')}</span>
      <button type="button" className="im-button" onClick={props.onEdit}>{t('cloudRenameNote')}</button>
    </li>
  )
}

/** The inline rename/note editor one card turns into while a draft is open. */
/** 草稿打开时人员卡变成的行内改名/备注编辑器。 */
function PersonEditor(props: {
  readonly t: Translate
  readonly draft: EditDraft
  readonly onDraft: (draft: EditDraft) => void
  readonly onCancel: () => void
  readonly onSave: (draft: EditDraft) => Promise<void>
}): React.JSX.Element {
  const { t, draft } = props
  return (
    <li className="im-item">
      <div className="im-rename-row">
        <input className="im-input im-rename-input" value={draft.displayName}
          onChange={event => props.onDraft({ ...draft, displayName: event.target.value })} />
        <input className="im-input" value={draft.note} placeholder={t('cloudNotePlaceholder')}
          onChange={event => props.onDraft({ ...draft, note: event.target.value })} />
        <button type="button" className="im-button im-button-primary"
          onClick={() => void props.onSave(draft)}>{t('cloudSave')}</button>
        <button type="button" className="im-button" onClick={props.onCancel}>{t('cloudCancel')}</button>
      </div>
    </li>
  )
}
