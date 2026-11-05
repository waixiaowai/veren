/**
 * The person editor: one form that creates a manual contact or rewrites an
 * existing profile.
 *
 * A profile is name, real name, aliases, contacts, bio, and notes. Addresses
 * are provider-owned facts and are shown read-only on the card, never edited
 * here; a brand-new manual contact therefore has contacts but no reachable
 * address until a channel observes one.
 *
 * 人员编辑器：一个表单，既能新建手工联系人，也能重写已有档案。
 *
 * 档案由名字、真名、别名、联系方式、简介与备注组成。地址是 provider 持有的事实，只在卡片上
 * 只读展示，绝不在这里编辑；因此新建的手工联系人只有联系方式，在被渠道观察到之前没有可达地址。
 *
 * @module @veren/im-ui/client/person-editor
 */

import { useState } from 'react'
import type { ReactNode } from 'react'
import type { ImKey } from './locales.ts'
import { contactKindKey } from './person-label.ts'
import type { ImPersonContact, ImPersonView, PersonDraft } from './remote.ts'

/** One contact row while it is being edited. */
/** 编辑中的一行联系方式。 */
interface ContactDraft {
  readonly key: number
  readonly kind: ImPersonContact['kind']
  readonly value: string
  readonly label: string
}

/** Props of {@link PersonEditor}. */
export interface PersonEditorProps {
  /** The profile under edit; absent while creating a new contact. */
  /** 正在编辑的档案；新建时缺省。 */
  readonly person?: ImPersonView
  readonly t: (key: ImKey) => string
  /** Save the draft; resolves to the host's refusal text, or nothing on success. */
  /** 保存草稿；被拒绝时返回宿主文案，成功时无返回。 */
  readonly onSubmit: (draft: PersonDraft) => Promise<string | undefined>
  readonly onCancel: () => void
  /** Called after a successful save, so the page can close the editor. */
  /** 保存成功后调用，页面借此关闭编辑器。 */
  readonly onFinished: () => void
}

/** Contact kinds in the order the editor offers them. */
/** 编辑器里联系方式的呈现顺序。 */
const CONTACT_KINDS: readonly ImPersonContact['kind'][] = ['wechat', 'email', 'phone', 'other']

/** Monotonic key for one editable contact row. */
let nextContactKey = 0

/** Split the aliases field into cleaned, deduplicated names. */
/** 把别名输入框拆成去重后的干净名字。 */
function parseAliases(text: string): string[] {
  const seen = new Set<string>()
  const values: string[] = []
  for (const part of text.split(/[,，、;；]/u)) {
    const value = part.trim()
    const key = value.normalize('NFKC').toLocaleLowerCase()
    if (value === '' || seen.has(key)) continue
    seen.add(key)
    values.push(value)
  }
  return values
}

/** Project one person's stored contacts onto editable rows. */
/** 把一个人已存的联系方式投影成可编辑行。 */
function draftContactsOf(person: ImPersonView | undefined): ContactDraft[] {
  return (person?.contacts ?? []).map(contact => ({
    key: nextContactKey++,
    kind: contact.kind,
    value: contact.value,
    label: contact.label ?? '',
  }))
}

/** One labelled field. */
/** 一个带标签的字段。 */
function Field(props: { readonly label: string; readonly children: ReactNode }): React.JSX.Element {
  return (
    <label className="im-field">
      <span className="im-label">{props.label}</span>
      {props.children}
    </label>
  )
}

/** The editor form. */
export function PersonEditor(props: PersonEditorProps): React.JSX.Element {
  const { person, t } = props
  const [displayName, setDisplayName] = useState(person?.displayName ?? '')
  const [realName, setRealName] = useState(person?.realName ?? '')
  const [aliases, setAliases] = useState((person?.aliases ?? []).join('，'))
  const [contacts, setContacts] = useState<ContactDraft[]>(() => draftContactsOf(person))
  const [bio, setBio] = useState(person?.bio ?? '')
  const [notes, setNotes] = useState(person?.notes ?? '')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const save = async (): Promise<void> => {
    const name = displayName.trim()
    if (name === '' || busy) return
    setBusy(true)
    setError('')
    const failure = await props.onSubmit({
      displayName: name,
      realName: realName.trim(),
      aliases: parseAliases(aliases),
      contacts: contacts
        .filter(contact => contact.value.trim() !== '')
        .map(contact => ({
          kind: contact.kind,
          value: contact.value.trim(),
          ...(contact.label.trim() === '' ? {} : { label: contact.label.trim() }),
        })),
      bio: bio.trim(),
      notes: notes.trim(),
    })
    setBusy(false)
    if (failure === undefined) props.onFinished()
    else setError(failure)
  }

  return (
    <form className="im-editor" onSubmit={event => { event.preventDefault(); void save() }}>
      <div className="im-editor-head">
        <h3 className="im-heading">{person === undefined ? t('newPerson') : t('editPerson')}</h3>
        <p className="im-muted">{t('personEditorHint')}</p>
      </div>
      <div className="im-editor-grid">
        <Field label={t('displayNameLabel')}>
          <input className="im-input" value={displayName} autoFocus required
            placeholder={t('displayNamePlaceholder')}
            onChange={event => setDisplayName(event.target.value)} />
        </Field>
        <Field label={t('realNameLabel')}>
          <input className="im-input" value={realName} placeholder={t('realNamePlaceholder')}
            onChange={event => setRealName(event.target.value)} />
        </Field>
      </div>
      <Field label={t('aliasesLabel')}>
        <input className="im-input" value={aliases} placeholder={t('aliasesPlaceholder')}
          onChange={event => setAliases(event.target.value)} />
      </Field>
      <ContactFields t={t} contacts={contacts} onChange={setContacts} />
      <div className="im-editor-grid">
        <Field label={t('bioLabel')}>
          <textarea className="im-input im-textarea" value={bio} placeholder={t('bioPlaceholder')}
            onChange={event => setBio(event.target.value)} />
        </Field>
        <Field label={t('notesLabel')}>
          <textarea className="im-input im-textarea" value={notes} placeholder={t('notesPlaceholder')}
            onChange={event => setNotes(event.target.value)} />
        </Field>
      </div>
      {error !== '' && <p className="im-error">{error}</p>}
      <div className="im-editor-actions">
        <button type="submit" className="im-button im-button-primary"
          disabled={displayName.trim() === '' || busy}>
          {busy ? t('saving') : t('save')}
        </button>
        <button type="button" className="im-button" onClick={props.onCancel}>{t('cancel')}</button>
      </div>
    </form>
  )
}

/** The editable contact list: one row per method, plus the add action. */
/** 可编辑的联系方式列表：每种方式一行，外加新增动作。 */
function ContactFields(props: {
  readonly t: (key: ImKey) => string
  readonly contacts: readonly ContactDraft[]
  readonly onChange: (contacts: ContactDraft[]) => void
}): React.JSX.Element {
  const { t, contacts, onChange } = props
  const replace = (index: number, patch: Partial<Omit<ContactDraft, 'key'>>): void => {
    onChange(contacts.map((row, position) => position === index ? { ...row, ...patch } : row))
  }
  return (
    <div className="im-field">
      <span className="im-label">{t('contactsLabel')}</span>
      {contacts.map((contact, index) => (
        <div key={contact.key} className="im-contact-row">
          <select className="im-input" value={contact.kind} aria-label={t('contactKindLabel')}
            onChange={event => replace(index, { kind: event.target.value as ImPersonContact['kind'] })}>
            {CONTACT_KINDS.map(kind => (
              <option key={kind} value={kind}>{t(contactKindKey(kind))}</option>
            ))}
          </select>
          <input className="im-input" value={contact.value} placeholder={t('contactValuePlaceholder')}
            aria-label={t('contactValuePlaceholder')}
            onChange={event => replace(index, { value: event.target.value })} />
          <input className="im-input" value={contact.label} placeholder={t('contactLabelPlaceholder')}
            aria-label={t('contactLabelPlaceholder')}
            onChange={event => replace(index, { label: event.target.value })} />
          <button type="button" className="im-button im-button-danger"
            onClick={() => onChange(contacts.filter((_, position) => position !== index))}>
            {t('remove')}
          </button>
        </div>
      ))}
      <button type="button" className="im-button im-contact-add"
        onClick={() => onChange([...contacts, { key: nextContactKey++, kind: 'wechat', value: '', label: '' }])}>
        {t('addContact')}
      </button>
    </div>
  )
}
