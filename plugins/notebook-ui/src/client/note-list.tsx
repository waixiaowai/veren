/**
 * The note list beside the editor.
 *
 * A presentation component: it renders the selected notebook's notes and hands
 * two intents back to the panel. It holds no state and never talks to the Host.
 *
 * 编辑器旁的笔记列表。
 *
 * 展示组件：渲染当前记事本的笔记，并把两个意图交回面板。它不持有状态，也从不与宿主通信。
 *
 * 组合拆分：空态（含新建按钮）在 EmptyNotes，条目集合在 NoteItems。
 * Composition split: the empty state (with the create button) lives in
 * EmptyNotes, the item collection in NoteItems.
 *
 * @module @veren/notebook-ui/client/note-list
 */

import { formatTime } from './editor.tsx'
import type { NotebookKey } from './locales.ts'
import type { NoteView } from './remote.ts'

/** Everything the list renders and the two actions it triggers. */
export interface NoteListProps {
  readonly t: (key: NotebookKey) => string
  readonly notes: readonly NoteView[]
  readonly selectedId: string | undefined
  readonly busy: boolean
  readonly canCreate: boolean
  readonly onOpen: (note: NoteView) => void
  readonly onCreate: () => void
}

/** Props of {@link EmptyNotes}. */
interface EmptyNotesProps {
  readonly t: (key: NotebookKey) => string
  readonly canCreate: boolean
  readonly busy: boolean
  readonly onCreate: () => void
}

/** 空态：说明文案与新建入口。The empty state: the explainer copy and the create entry. */
function EmptyNotes(props: EmptyNotesProps): React.ReactElement {
  const { t, canCreate, busy, onCreate } = props
  return (
    <div className="notebook-empty">
      <h3>{t('noNotes')}</h3>
      <p>{t('noNotesHint')}</p>
      <button
        type="button" className="notebook-btn is-primary"
        disabled={!canCreate || busy}
        onClick={onCreate}
      >
        {t('newNote')}
      </button>
    </div>
  )
}

/** Props of {@link NoteItems}. */
interface NoteItemsProps {
  readonly notes: readonly NoteView[]
  readonly selectedId: string | undefined
  readonly onOpen: (note: NoteView) => void
}

/** 条目集合：每条笔记一个可点按钮。The item collection: one clickable button per note. */
function NoteItems(props: NoteItemsProps): React.ReactElement {
  const { notes, selectedId, onOpen } = props
  return (
    <div className="notebook-items">
      {notes.map(note => (
        <button
          key={note.id}
          type="button"
          className="notebook-item"
          aria-current={note.id === selectedId}
          onClick={() => { onOpen(note) }}
        >
          <span className="notebook-item-title">{note.title}</span>
          {note.body !== '' && <span className="notebook-item-excerpt">{note.body}</span>}
          <span className="notebook-item-time">{formatTime(note.updatedAt)}</span>
        </button>
      ))}
    </div>
  )
}

/** Render one notebook's note list. */
export function NoteList(props: NoteListProps) {
  const { t, notes, selectedId, busy, canCreate } = props
  return (
    <section className="notebook-list" aria-label={t('notes')}>
      <div className="notebook-list-head">
        <span>{t('notes')}</span>
        <span className="notebook-count">{notes.length}</span>
      </div>
      {notes.length === 0
        ? <EmptyNotes t={t} canCreate={canCreate} busy={busy} onCreate={props.onCreate} />
        : <NoteItems notes={notes} selectedId={selectedId} onOpen={props.onOpen} />}
    </section>
  )
}
