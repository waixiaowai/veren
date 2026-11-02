/**
 * The note list beside the editor (the canvas's index/accessible face).
 *
 * A presentation component: it renders the selected notebook's notes and hands
 * two intents back to the panel. It holds no state and never talks to the Host.
 * The inbound badges and the fleeting aging chips derive from the graph face —
 * the same read the canvas draws, so the two projections can never disagree.
 *
 * 编辑器旁的笔记列表（画布的索引/无障碍等价面）。
 *
 * 展示组件：渲染当前记事本的笔记，并把两个意图交回面板。它不持有状态，也从不
 * 与宿主通信。入链角标与闪念老化章都派生自图面——与画布同源的一次读，两个投影
 * 永远不会各执一词。
 *
 * 组合拆分：空态（含新建按钮）在 EmptyNotes，条目集合在 NoteItems。
 * Composition split: the empty state (with the create button) lives in
 * EmptyNotes, the item collection in NoteItems.
 *
 * @module @veren/notebook-ui/client/note-list
 */

import { agingLabelOf, agingText } from './aging.ts'
import { formatTime } from './editor.tsx'
import type { NotebookKey } from './locales.ts'
import type { CanvasNodeView, NoteView } from './remote.ts'

/** Everything the list renders and the two actions it triggers. */
export interface NoteListProps {
  readonly t: (key: NotebookKey) => string
  readonly notes: readonly NoteView[]
  /** The graph face's nodes — badge counts and aging chips derive from them. 图面节点——角标与老化章的来源。 */
  readonly graphNodes: readonly CanvasNodeView[]
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
  readonly nodesById: ReadonlyMap<string, CanvasNodeView>
  readonly selectedId: string | undefined
  readonly onOpen: (note: NoteView) => void
  readonly t: (key: NotebookKey) => string
}

/** 条目集合：每条笔记一个可点按钮，带类别徽章、入链数角标与闪念老化章。
 * The item collection: one clickable button per note, with the kind badge, the
 * inbound-link badge, and the fleeting aging chip. */
function NoteItems(props: NoteItemsProps): React.ReactElement {
  const { notes, nodesById, selectedId, onOpen, t } = props
  return (
    <div className="notebook-items">
      {notes.map(note => (
        <NoteRow
          key={note.id}
          note={note}
          node={nodesById.get(note.id)}
          selected={note.id === selectedId}
          onOpen={onOpen}
          t={t}
        />
      ))}
    </div>
  )
}

/** One list row: the kind badge, the inbound badge, and the aging chip. 一行列表：类别徽章、入链角标与老化章。 */
function NoteRow({ note, node, selected, onOpen, t }: {
  readonly note: NoteView
  readonly node: CanvasNodeView | undefined
  readonly selected: boolean
  readonly onOpen: (note: NoteView) => void
  readonly t: (key: NotebookKey) => string
}): React.ReactElement {
  const kindKey = { fleeting: 'kindFleeting', permanent: 'kindPermanent', project: 'kindProject' } as const
  const aging = node?.aging !== undefined && node.expiresAt !== undefined
    ? agingLabelOf(node.expiresAt, Date.now())
    : undefined
  return (
    <button
      type="button"
      className={`notebook-item${node?.aging === 'overdue' ? ' is-overdue' : ''}`}
      aria-current={selected}
      onClick={() => { onOpen(note) }}
    >
      <span className="notebook-item-title">{note.title}</span>
      <span className={`notebook-item-kind is-${note.kind}`}>{t(kindKey[note.kind])}</span>
      {(node?.inbound ?? 0) > 0 && (
        <span className="notebook-item-links">{`⟲ ${String(node?.inbound ?? 0)}`}</span>
      )}
      {aging !== undefined && (
        <span className={`notebook-item-aging is-${node?.aging ?? 'fresh'}`}>
          {agingText(aging, t)}
        </span>
      )}
      {note.body !== '' && <span className="notebook-item-excerpt">{note.body}</span>}
      <span className="notebook-item-time">{formatTime(note.updatedAt)}</span>
    </button>
  )
}

/** Render one notebook's note list. */
export function NoteList(props: NoteListProps) {
  const { t, notes, graphNodes, selectedId, busy, canCreate } = props
  const nodesById = new Map(graphNodes.map(node => [node.id, node]))
  return (
    <section className="notebook-list" aria-label={t('notes')}>
      <div className="notebook-list-head">
        <span>{t('notes')}</span>
        <span className="notebook-count">{notes.length}</span>
      </div>
      {notes.length === 0
        ? <EmptyNotes t={t} canCreate={canCreate} busy={busy} onCreate={props.onCreate} />
        : <NoteItems notes={notes} nodesById={nodesById} selectedId={selectedId} onOpen={props.onOpen} t={t} />}
    </section>
  )
}
