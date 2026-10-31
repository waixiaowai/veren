/**
 * The notebook page: an owner selector, a note list, and one editor.
 *
 * A presentation component fed by one observable and the inject face's
 * callbacks; it holds only view state and never touches `ctx`. Assembly only:
 * the view state lives in `use-notebook-view.ts`, the header in
 * `panel-header.tsx`, the editor seat in `panel-editor-seat.tsx`, and the list
 * and editor in their own files.
 *
 * 记事本页面：归属选择器、笔记列表与一个编辑器。
 *
 * 由可观察对象和注入面回调驱动的展示组件；只持有视图状态，不碰 `ctx`。
 * 本文件只做组装：视图状态在 `use-notebook-view.ts`，头部在 `panel-header.tsx`，
 * 编辑器席位在 `panel-editor-seat.tsx`，列表与编辑器各自成文件。
 *
 * @module @veren/notebook-ui/client/panel
 */

import { NoteList } from './note-list.tsx'
import type {
  InjectFace, PropsLocale, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import { NotebookErrorBanner, NotebookHeader } from './panel-header.tsx'
import { NotebookEditorSeat } from './panel-editor-seat.tsx'
import { useNotebookView } from './use-notebook-view.ts'
import type { BodyProps } from './use-notebook-view.ts'
import type { NotebookPanelInjected } from './remote.ts'

/** Props of {@link NotebookPanel}, derived from the framework shares. */
export type NotebookPanelProps = PropsRuntime<'main'>
  & InjectFace<NotebookPanelInjected>
  & PropsLocale<'notebook'>

/** Render the page shell and resolve the framework seat once. */
export function NotebookPanel(props: NotebookPanelProps) {
  const state = props.useNotebook(snapshot => snapshot)
  return <NotebookBody state={state} t={props.t} actions={props} />
}

/** The page header, derived from the framework seat, the view, and the actions. 由框架席位、视图与动作派生的页面头部。 */
function NotebookPageHeader({ state, t, actions, busy, onChooseOwner, onStartNew }: {
  readonly state: BodyProps['state']
  readonly t: BodyProps['t']
  readonly actions: BodyProps['actions']
  readonly busy: boolean
  readonly onChooseOwner: (owner: string) => void
  readonly onStartNew: () => void
}) {
  return (
    <NotebookHeader
      heading={t('panel')}
      subtitle={t('panelSubtitle')}
      ownerLabel={t('owner')}
      ownerHint={t('ownerHint')}
      removedLabel={t('removed')}
      refreshLabel={t('refresh')}
      newLabel={t('newNote')}
      owners={state.owners}
      owner={state.owner}
      ownerDisabled={state.owner === undefined || busy}
      onChooseOwner={onChooseOwner}
      onRefresh={() => { actions.onRefresh() }}
      onStartNew={onStartNew}
    />
  )
}

/** The two-column layout: the note list on the left, the editor seat on the right. 双栏布局：左列笔记列表，右列编辑器席位。 */
function NotebookLayout({ state, t, view }: {
  readonly state: BodyProps['state']
  readonly t: BodyProps['t']
  readonly view: ReturnType<typeof useNotebookView>
}) {
  const active = view.editingNew || view.selectedId !== undefined
  return (
    <div className="notebook-layout">
      <NoteList
        t={t}
        notes={state.notes}
        selectedId={view.selectedId}
        busy={view.busy}
        canCreate={state.owner !== undefined}
        onOpen={view.openFromList}
        onCreate={view.startNew}
      />

      <NotebookEditorSeat
        t={t}
        owner={state.owner}
        active={active}
        view={view}
      />
    </div>
  )
}

/** The page body: it holds the view state, so only it re-renders on selection. */
function NotebookBody({ state, t, actions }: BodyProps) {
  const view = useNotebookView(state, t, actions)
  return (
    <div className="notebook-page">
      <NotebookPageHeader
        state={state}
        t={t}
        actions={actions}
        busy={view.busy}
        onChooseOwner={view.chooseOwner}
        onStartNew={view.startNew}
      />

      {state.status === 'error' && (
        <NotebookErrorBanner failedLabel={t('failed')} error={state.error} retryLabel={t('retry')} onRefresh={() => { actions.onRefresh() }} />
      )}

      <NotebookLayout state={state} t={t} view={view} />
    </div>
  )
}
