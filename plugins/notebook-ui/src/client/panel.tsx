/**
 * The notebook page: the header, one view mode (canvas by default, the list as
 * the index/accessible face), and one editor seat.
 *
 * A presentation component fed by one observable and the inject face's
 * callbacks; it holds only view state and never touches `ctx`. Assembly only:
 * the view state lives in `use-notebook-view.ts`, the header in
 * `panel-header.tsx`, the editor seat in `panel-editor-seat.tsx`, the canvas
 * in `canvas.tsx` + `canvas-dock.tsx`, and the list and editor in their own
 * files.
 *
 * 记事本页面：头部、一个视图模式（默认画布，列表作索引/无障碍等价面）与一个
 * 编辑器席位。
 *
 * 由可观察对象和注入面回调驱动的展示组件；只持有视图状态，不碰 `ctx`。
 * 本文件只做组装：视图状态在 `use-notebook-view.ts`，头部在 `panel-header.tsx`，
 * 编辑器席位在 `panel-editor-seat.tsx`，画布在 `canvas.tsx` + `canvas-dock.tsx`，
 * 列表与编辑器各自成文件。
 *
 * @module @veren/notebook-ui/client/panel
 */

import { useRef, useState } from 'react'
import { CanvasDock } from './canvas-dock.tsx'
import { CanvasGraph } from './canvas.tsx'
import { useMinWidth } from './canvas-viewport-auto.ts'
import { NoteList } from './note-list.tsx'
import { NoteLinks } from './note-links.tsx'
import type {
  InjectFace, PropsLocale, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import { NotebookErrorBanner, NotebookHeader } from './panel-header.tsx'
import type { NotebookHeaderProps } from './panel-header.tsx'
import { NotebookEditorSeat } from './panel-editor-seat.tsx'
import { useNotebookView } from './use-notebook-view.ts'
import type { BodyProps } from './use-notebook-view.ts'
import type { CanvasNodeView, NotebookPanelInjected } from './remote.ts'

/** Props of {@link NotebookPanel}, derived from the framework shares. */
export type NotebookPanelProps = PropsRuntime<'main'>
  & InjectFace<NotebookPanelInjected>
  & PropsLocale<'notebook'>

/** Below this viewport width the canvas yields to the list (the fallback). 低于此视口宽度画布让位给列表（回退面）。 */
const CANVAS_MIN_WIDTH = 720

/** Render the page shell and resolve the framework seat once. */
export function NotebookPanel(props: NotebookPanelProps) {
  const state = props.useNotebook(snapshot => snapshot)
  return <NotebookBody state={state} t={props.t} actions={props} />
}

/** The page header, derived from the framework seat, the view, and the actions. 由框架席位、视图与动作派生的页面头部。 */
function NotebookPageHeader({ state, t, actions, busy, onChooseOwner, onStartNew, mode }: {
  readonly state: BodyProps['state']
  readonly t: BodyProps['t']
  readonly actions: BodyProps['actions']
  readonly busy: boolean
  readonly onChooseOwner: (owner: string) => void
  readonly onStartNew: () => void
  readonly mode?: NonNullable<NotebookHeaderProps['mode']> | undefined
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
      exportLabel={t('exportLabel')}
      owners={state.owners}
      owner={state.owner}
      ownerDisabled={state.owner === undefined || busy}
      onChooseOwner={onChooseOwner}
      onRefresh={() => { actions.onRefresh() }}
      onStartNew={onStartNew}
      onExport={(owner) => { void actions.onExport(owner) }}
      mode={mode}
    />
  )
}

/** Follow a link or a canvas node: resolve the id against the already-loaded box and select it. 顺链接或画布节点走：在已加载的盒里按 id 找回并选中。 */
function openByIdIn(state: BodyProps['state'], view: ReturnType<typeof useNotebookView>): (id: string) => void {
  return (id: string) => {
    const note = state.notes.find(candidate => candidate.id === id)
    if (note !== undefined) view.openFromList(note)
  }
}

/** The dock's queue: overdue cards, oldest first. 进料口的队列：过期卡，最早优先。 */
function overdueQueue(graphNodes: readonly CanvasNodeView[]): readonly CanvasNodeView[] {
  return graphNodes
    .filter(node => node.aging === 'overdue')
    .sort((left, right) => (left.updatedAt < right.updatedAt ? -1 : 1))
}

/** The canvas face: the full-bleed draggable graph and the intake dock
 * beneath — no editing on the canvas at all (the user's ruling). The empty
 * state's action borrows the list (the writing surface) for a new draft.
 * 画面：全幅可拖拽图区与其下的进料口——画布上没有任何编辑（用户裁定）。
 * 空态的动作借用列表（创作面）开始新草稿。 */
function CanvasColumn({ state, t, view, onStartNew }: {
  readonly state: BodyProps['state']
  readonly t: BodyProps['t']
  readonly view: ReturnType<typeof useNotebookView>
  readonly onStartNew: () => void
}) {
  const graphNodes = state.graph?.nodes ?? []
  return (
    <div className="notebook-canvas-column">
      <div className="notebook-canvas-wrap">
        <CanvasGraph
          t={t}
          nodes={graphNodes}
          edges={state.graph?.edges ?? []}
          viewKey={state.owner ?? ''}
          loading={state.status === 'loading'}
          onCreate={onStartNew}
        />
      </div>
      <CanvasDock
        t={t}
        overdue={overdueQueue(graphNodes)}
        busy={view.busy}
        onPromote={(id) => { void view.promoteCard(id) }}
        onTrash={(id) => { void view.removeCard(id) }}
      />
    </div>
  )
}

/** The editor column: the seat plus the selected card's link sections. 编辑器列：席位加选中卡的链接两段。 */
function EditorColumn({ state, t, view, actions, onSave }: {
  readonly state: BodyProps['state']
  readonly t: BodyProps['t']
  readonly view: ReturnType<typeof useNotebookView>
  readonly actions: BodyProps['actions']
  readonly onSave: () => void
}) {
  return (
    <div className="notebook-editor-column">
      <NotebookEditorSeat
        t={t}
        owner={state.owner}
        active={view.editingNew || view.selectedId !== undefined}
        view={view}
        onSave={onSave}
      />
      {!view.editingNew && (
        <NoteLinks
          t={t}
          owner={state.owner}
          selectedId={view.selectedId}
          editingNew={view.editingNew}
          fetchLinks={actions.onCardLinks}
          onOpenCard={openByIdIn(state, view)}
        />
      )}
    </div>
  )
}

/** The mode-aware layout: canvas mode is the canvas face alone (the user's
 * ruling); list mode keeps the list + editor columns. 模式感知布局：画布模式
 * 只有画布面（用户裁定）；列表模式保留列表+编辑器双栏。 */
function NotebookLayout({ state, t, view, actions, mode, onStartNew, onSave }: {
  readonly state: BodyProps['state']
  readonly t: BodyProps['t']
  readonly view: ReturnType<typeof useNotebookView>
  readonly actions: BodyProps['actions']
  readonly mode: 'canvas' | 'list'
  readonly onStartNew: () => void
  readonly onSave: () => void
}) {
  if (mode === 'canvas') {
    return (
      <div className="notebook-layout is-canvas">
        <CanvasColumn state={state} t={t} view={view} onStartNew={onStartNew} />
      </div>
    )
  }
  return (
    <div className="notebook-layout is-list">
      <NoteList
        t={t}
        notes={state.notes}
        graphNodes={state.graph?.nodes ?? []}
        selectedId={view.selectedId}
        busy={view.busy}
        canCreate={state.owner !== undefined}
        onOpen={view.openFromList}
        onCreate={view.startNew}
      />
      <EditorColumn state={state} t={t} view={view} actions={actions} onSave={onSave} />
    </div>
  )
}

/** The view mode: the user's choice, forced to the list below the fallback width. 视图模式：用户的选择，低于回退宽度时强制列表。 */
function useViewMode(): { readonly mode: 'canvas' | 'list'; readonly wide: boolean; readonly setMode: (mode: 'canvas' | 'list') => void } {
  const [mode, setMode] = useState<'canvas' | 'list'>('canvas')
  const wide = useMinWidth(CANVAS_MIN_WIDTH)
  // The narrow viewport falls back to the list; the toggle hides with it.
  // 窄视口回退到列表；切换钮随之隐藏。
  return { mode: wide ? mode : 'list', wide, setMode }
}

/** The authoring state machine: a draft started from the canvas returns to the
 * canvas once saved (idle → authoring(list) → saved(canvas)). A draft started
 * in the list stays in the list. 创作状态机：从画布开始的草稿保存后回到画布
 * （idle → authoring(list) → saved(canvas)）；从列表开始的草稿留在列表。 */
function useAuthoringMode(mode: 'canvas' | 'list', setMode: (mode: 'canvas' | 'list') => void, view: ReturnType<typeof useNotebookView>): {
  readonly startNew: () => void
  readonly chooseOwner: (owner: string) => void
  readonly changeMode: (next: 'canvas' | 'list') => void
  readonly save: () => void
} {
  const returnToCanvas = useRef(false)
  const startNew = (): void => {
    if (mode === 'canvas') returnToCanvas.current = true
    setMode('list')
    view.startNew()
  }
  const chooseOwner = (owner: string): void => {
    returnToCanvas.current = false
    view.chooseOwner(owner)
  }
  const changeMode = (next: 'canvas' | 'list'): void => {
    if (next === 'canvas') returnToCanvas.current = false
    setMode(next)
  }
  const save = (): void => {
    void view.save().then((saved) => {
      if (!saved || !returnToCanvas.current) return
      returnToCanvas.current = false
      setMode('canvas')
    })
  }
  return { startNew, chooseOwner, changeMode, save }
}

/** The page body: it holds the view state, so only it re-renders on selection. */
function NotebookBody({ state, t, actions }: BodyProps) {
  const view = useNotebookView(state, t, actions)
  const { mode, wide, setMode } = useViewMode()
  const authoring = useAuthoringMode(mode, setMode, view)
  return (
    <div className="notebook-page">
      <NotebookPageHeader
        state={state}
        t={t}
        actions={actions}
        busy={view.busy}
        onChooseOwner={authoring.chooseOwner}
        onStartNew={authoring.startNew}
        mode={wide
          ? {
            value: mode,
            canvasLabel: t('modeCanvas'),
            listLabel: t('modeList'),
            onChange: authoring.changeMode,
          }
          : undefined}
      />
      {state.status === 'error' && (
        <NotebookErrorBanner failedLabel={t('failed')} error={state.error} retryLabel={t('retry')} onRefresh={() => { actions.onRefresh() }} />
      )}
      <NotebookLayout
        state={state} t={t} view={view} actions={actions} mode={mode}
        onStartNew={authoring.startNew} onSave={authoring.save}
      />
    </div>
  )
}
