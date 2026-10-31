/**
 * The publish composer: the new-post form in a centered modal. It owns only
 * its draft state; the actual publish and the actor choice stay with the page
 * body, so a published post lands on the right board even if the modal closes
 * mid-flight.
 *
 * 发帖写作框：居中模态框里的新帖表单。它只持有草稿状态；真正的发布与身份选择仍归页面体，
 * 因此即便模态框在请求中途关闭，新帖也会落在正确的板块。
 *
 * @module @veren/forum-ui/client/panel-composer
 */

import { useState } from 'react'
import type { FormEvent } from 'react'
import type { BoardView, PersonView } from './remote.ts'
import type { ForumKey } from './locales.ts'
import type { PublishInput } from './panel-model.ts'
import { Modal, ModalActions, NotifySegmented } from './panel-kit.tsx'

/** Split one comma-separated tag field into the list the Host validates. 把逗号分隔的标签输入拆成宿主校验的列表。 */
function splitTags(raw: string): readonly string[] {
  return raw.split(',').map(value => value.trim()).filter(value => value !== '')
}

/** The composer's text fields: the title, the body, and the tag list. 写作框的文本字段：标题、正文与标签列表。 */
function ComposerFields(props: {
  readonly t: (key: ForumKey) => string
  readonly title: string
  readonly onTitle: (value: string) => void
  readonly body: string
  readonly onBody: (value: string) => void
  readonly tags: string
  readonly onTags: (value: string) => void
}) {
  const { t, title, onTitle, body, onBody, tags, onTags } = props
  return (
    <>
      <label className="forum-field">
        <span className="forum-label">{t('title')}</span>
        <input
          className="forum-input" value={title} autoFocus aria-label={t('title')}
          placeholder={t('titlePlaceholder')}
          onChange={event => { onTitle(event.target.value) }}
        />
      </label>
      <label className="forum-field">
        <span className="forum-label">{t('body')}</span>
        <textarea
          className="forum-textarea" value={body} rows={7} aria-label={t('body')}
          placeholder={t('bodyPlaceholder')}
          onChange={event => { onBody(event.target.value) }}
        />
      </label>
      <label className="forum-field">
        <span className="forum-label">{t('tags')}</span>
        <input
          className="forum-input" value={tags} placeholder={t('tagsPlaceholder')}
          onChange={event => { onTags(event.target.value) }}
        />
      </label>
    </>
  )
}

/** The board and acting-as pickers, side by side. 板块与身份选择器，并排一行。 */
function ComposerTargets(props: {
  readonly t: (key: ForumKey) => string
  readonly boards: readonly BoardView[]
  readonly people: readonly PersonView[]
  readonly board: string
  readonly onBoard: (value: string) => void
  readonly actor: string | undefined
  readonly onActor: (value: string) => void
}) {
  const { t, boards, people, board, onBoard, actor, onActor } = props
  return (
    <div className="forum-two">
      <label className="forum-field">
        <span className="forum-label">{t('board')}</span>
        <select className="forum-select" value={board} onChange={event => { onBoard(event.target.value) }}>
          {boards.length === 0 && <option value="">{t('pickBoard')}</option>}
          {boards.map(value => <option key={value.id} value={value.id}>{value.title}</option>)}
        </select>
      </label>
      <label className="forum-field">
        <span className="forum-label">{t('actingAs')}</span>
        <select className="forum-select" value={actor ?? ''} onChange={event => { onActor(event.target.value) }}>
          {people.map(person => <option key={person.name} value={person.name}>{person.name}</option>)}
        </select>
      </label>
    </div>
  )
}

/** The composer's input body: the text fields, the target pickers, and the notify choice. 写作框的输入体：文本字段、目标选择器与通知方式。 */
function ComposerBody(props: {
  readonly t: (key: ForumKey) => string
  readonly boards: readonly BoardView[]
  readonly people: readonly PersonView[]
  readonly title: string
  readonly onTitle: (value: string) => void
  readonly body: string
  readonly onBody: (value: string) => void
  readonly tags: string
  readonly onTags: (value: string) => void
  readonly board: string
  readonly onBoard: (value: string) => void
  readonly actor: string | undefined
  readonly onActor: (value: string) => void
  readonly notify: 'inbox' | 'wake'
  readonly onNotify: (value: 'inbox' | 'wake') => void
  readonly error: string
}) {
  const { t, boards, people, title, onTitle, body, onBody, tags, onTags, board, onBoard, actor, onActor, notify, onNotify, error } = props
  return (
    <div className="forum-modal-body">
      <ComposerFields
        t={t} title={title} onTitle={onTitle} body={body} onBody={onBody} tags={tags} onTags={onTags}
      />
      <ComposerTargets t={t} boards={boards} people={people} board={board} onBoard={onBoard} actor={actor} onActor={onActor} />
      <NotifySegmented t={t} notify={notify} onNotify={onNotify} />
      {error !== '' && <p className="forum-form-error" role="alert">{error}</p>}
    </div>
  )
}

/** The publish form, in a centered modal instead of the always-on feed. 居中模态框里的发布表单，取代常驻信息流的入口。 */
export function ComposerModal(props: {
  readonly t: (key: ForumKey) => string
  readonly boards: readonly BoardView[]
  readonly people: readonly PersonView[]
  readonly actor: string | undefined
  readonly defaultBoard: string | undefined
  readonly readOnly: boolean
  readonly error: string
  readonly onActor: (value: string) => void
  readonly onClose: () => void
  readonly onSubmit: (input: PublishInput) => Promise<boolean>
}) {
  const { t, boards, actor, onActor, onClose, onSubmit, readOnly, error } = props
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [tags, setTags] = useState('')
  const [notify, setNotify] = useState<'inbox' | 'wake'>('inbox')
  const [board, setBoard] = useState(props.defaultBoard ?? boards[0]?.id ?? '')
  const [pending, setPending] = useState(false)
  const canSubmit = !readOnly && !pending && actor !== undefined && board !== '' && title.trim() !== ''
  const submit = (event: FormEvent): void => {
    event.preventDefault()
    if (!canSubmit || actor === undefined) return
    setPending(true)
    void onSubmit({ boardId: board, author: actor, title, body, tags: splitTags(tags), notifyMode: notify })
      .finally(() => { setPending(false) })
  }
  return (
    <Modal title={t('newPost')} subtitle={t('newPostHint')} closeLabel={t('close')} onClose={onClose}>
      <form className="forum-form" onSubmit={submit}>
        <ComposerBody
          t={t} boards={boards} people={props.people} title={title} onTitle={setTitle}
          body={body} onBody={setBody} tags={tags} onTags={setTags} board={board} onBoard={setBoard}
          actor={actor} onActor={onActor} notify={notify} onNotify={setNotify} error={error}
        />
        <ModalActions
          cancelLabel={t('cancel')} confirmLabel={t('publish')} disabled={!canSubmit} onCancel={onClose}
        />
      </form>
    </Modal>
  )
}
