/**
 * The notebook editor seat: the right-hand column that renders the empty
 * states (no owner / nothing selected) or the live editor, depending on the
 * body's view. A presentation component — facts via props, actions via the
 * view's callbacks.
 *
 * 记事本编辑器席位：右栏，根据页面主体的视图渲染空态（无归属/未选中）或活的
 * 编辑器。展示组件——事实经 props 到达，动作经视图回调发出。
 *
 * @module @veren/notebook-ui/client/panel-editor-seat
 */

import { NoteEditor } from './editor.tsx'
import type { NotebookKey } from './locales.ts'
import type { NotebookView } from './use-notebook-view.ts'

/** Props of {@link NotebookEditorSeat}, derived from the body's view. */
interface NotebookEditorSeatProps {
  readonly t: (key: NotebookKey) => string
  readonly owner: string | undefined
  /** True once a note is open or a new draft started. 打开了一条笔记或开始新草稿即为真。 */
  readonly active: boolean
  readonly view: NotebookView
}

/** One empty-state block: a heading and a hint. 空态块：一个标题一句提示。 */
function EditorEmpty({ heading, hint }: { readonly heading: string; readonly hint: string }) {
  return (
    <div className="notebook-empty">
      <h3>{heading}</h3>
      <p>{hint}</p>
    </div>
  )
}

/** The live editor wired to the view's handlers. 接好视图处理器的活编辑器。 */
function LiveEditor({ t, view }: { readonly t: (key: NotebookKey) => string; readonly view: NotebookView }) {
  return (
    <NoteEditor
      t={t}
      editingNew={view.editingNew}
      draft={view.draft}
      busy={view.busy}
      dirty={view.dirty}
      error={view.error}
      notice={view.notice}
      confirmDelete={view.confirmDelete}
      onEdit={view.edit}
      onSave={() => { void view.save() }}
      onRemove={() => { void view.remove() }}
    />
  )
}

/** The editor column: empty states or the live editor. 编辑器栏：空态或活的编辑器。 */
export function NotebookEditorSeat({ t, owner, active, view }: NotebookEditorSeatProps) {
  return (
    <section className="notebook-editor" aria-label={t('editNote')}>
      {owner === undefined
        ? <EditorEmpty heading={t('noOwners')} hint={t('ownerHint')} />
        : !active
          ? <EditorEmpty heading={t('emptyTitle')} hint={t('emptyBody')} />
          : <LiveEditor t={t} view={view} />}
    </section>
  )
}
