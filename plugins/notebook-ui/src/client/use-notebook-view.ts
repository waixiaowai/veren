/**
 * The notebook page's view state: one custom hook holding the selection, the
 * draft, and every handler the header/list/editor render. Pure view state on
 * top of the inject face's callbacks — it never touches `ctx`, and a re-render
 * on selection change stays local to the body that calls the hook. The two
 * lifecycle effects and the shared reset live in their own named helpers so
 * every function here stays small.
 *
 * 记事本页面的视图状态：一个自定义钩子，持有选中项、草稿与头部/列表/编辑器
 * 渲染所需的全部处理器。它只是注入面回调之上的纯视图状态——绝不碰 `ctx`，
 * 选中变化引起的重渲染也只落在调用钩子的页面主体上。两个生命周期副作用与
 * 共用重置各自成命名助手，保证这里每个函数都很小。
 *
 * 职责分域：状态原子（快照值 + setter）打包成 ViewAtoms 在钩子与模块级助手间
 * 传递；选中迁移、保存/删除流程与处理器铸造各自是模块级纯函数；钩子本体只留
 * React 粘合（useState / ref / effects / 装配）。
 * Duty domains: the state atoms (snapshot values + setters) travel as ViewAtoms
 * between the hook and the module-level helpers; the selection moves, the
 * save/remove flows, and the handler minting are module-level pure functions;
 * the hook body keeps only the React glue (useState / ref / effects / assembly).
 *
 * @module @veren/notebook-ui/client/use-notebook-view
 */

import { useEffect, useRef, useState } from 'react'
import { EMPTY_DRAFT } from './editor.tsx'
import type { Draft } from './editor.tsx'
import type { NoteView, NotebookPanelInjected, NotebookSnapshot } from './remote.ts'
import type { NotebookKey } from './locales.ts'

/** Everything the page body needs, with the inject face already resolved. */
export interface BodyProps {
  readonly state: NotebookSnapshot
  readonly t: (key: NotebookKey) => string
  readonly actions: Omit<NotebookPanelInjected, 'hooks'>
}

/** The view state and handlers the page body renders from. 页面主体渲染所依据的视图状态与处理器。 */
export interface NotebookView {
  readonly selectedId: string | undefined
  readonly editingNew: boolean
  readonly draft: Draft
  readonly dirty: boolean
  readonly busy: boolean
  readonly error: string
  readonly notice: string
  readonly confirmDelete: boolean
  openNote(note: NoteView): void
  openFromList(note: NoteView): void
  startNew(): void
  chooseOwner(owner: string): void
  edit(patch: Partial<Pick<Draft, 'title' | 'body'>>): void
  save(): Promise<void>
  remove(): Promise<void>
}

/** Render one failure as a single line. */
function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && error !== null && 'message' in error) return String(error.message)
  return String(error)
}

/** A different owner means a different notebook: drop the old draft first.
 * 归属变了就是另一本笔记：先丢掉旧草稿。 */
function useOwnerChangeReset(owner: string | undefined, resetAll: () => void): void {
  useEffect(() => { resetAll() }, [owner, resetAll])
}

/** Inputs of the follow effect, flattened so the dependency list stays explicit.
 * 跟随副作用的输入，平铺开让依赖列表保持显式。 */
interface FollowInputs {
  readonly notes: NotebookSnapshot['notes']
  readonly selectedId: string | undefined
  readonly editingNew: boolean
  readonly dirty: boolean
  readonly draftUpdatedAt: Draft['updatedAt']
}

/** The follow effect: select the first note once a notebook has notes, and
 * follow external edits only while the draft is clean — a dirty draft is the
 * user's, not the poll's. 跟随副作用：笔记本有笔记后选中第一条；只在草稿干净时
 * 跟随外部编辑——脏草稿属于用户，不属于轮询。 */
function useNoteFollowEffect(inputs: FollowInputs, openNote: (note: NoteView) => void, resetSelection: () => void, deleted: { current: string | undefined }, setNotice: (notice: string) => void): void {
  useEffect(() => {
    const { notes, selectedId, editingNew, dirty, draftUpdatedAt } = inputs
    if (editingNew) return
    if (selectedId === undefined) {
      const first = notes[0]
      if (first !== undefined) openNote(first)
      return
    }
    const current = notes.find(note => note.id === selectedId)
    if (current === undefined) {
      // A note this page deleted disappears from the refreshed list; pick the next one.
      if (deleted.current !== undefined && !notes.some(note => note.id === deleted.current)) {
        deleted.current = undefined
        setNotice('')
        const first = notes[0]
        if (first !== undefined) openNote(first)
        else resetSelection()
      }
      return
    }
    if (!dirty && current.updatedAt !== draftUpdatedAt) openNote(current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputs.notes, inputs.selectedId, inputs.editingNew, inputs.dirty, inputs.draftUpdatedAt])
}

/** 钩子与模块级助手共享的状态原子束：快照值、setter、动作面与删除标记。
 * The atom bundle shared by the hook and the module-level helpers: snapshot
 * values, setters, the action face, and the deletion marker. */
interface ViewAtoms {
  readonly state: NotebookSnapshot
  readonly t: (key: NotebookKey) => string
  readonly actions: Omit<NotebookPanelInjected, 'hooks'>
  readonly selectedId: string | undefined
  readonly draft: Draft
  readonly editingNew: boolean
  readonly dirty: boolean
  readonly busy: boolean
  readonly error: string
  readonly notice: string
  readonly confirmDelete: boolean
  readonly setSelectedId: (id: string | undefined) => void
  readonly setDraft: (draft: Draft | ((current: Draft) => Draft)) => void
  readonly setEditingNew: (editing: boolean) => void
  readonly setDirty: (dirty: boolean) => void
  readonly setBusy: (busy: boolean) => void
  readonly setError: (error: string) => void
  readonly setNotice: (notice: string) => void
  readonly setConfirmDelete: (confirm: boolean) => void
  readonly deleted: { current: string | undefined }
}

/** 选中一条笔记：记下选中、载入草稿并清掉残留的编辑态。
 * Select one note: remember the selection, load its draft, and clear the
 * leftover edit state. */
function applyNoteSelection(atoms: ViewAtoms, note: NoteView): void {
  atoms.setSelectedId(note.id)
  atoms.setEditingNew(false)
  atoms.setDraft({ title: note.title, body: note.body, updatedAt: note.updatedAt })
  atoms.setDirty(false)
  atoms.setConfirmDelete(false)
  atoms.setError('')
}

/** 选中/新建之外的落定形状（不动 notice）。
 * The settled shape outside a selection or a new draft (notice untouched). */
function applySelectionReset(atoms: ViewAtoms): void {
  atoms.setSelectedId(undefined)
  atoms.setEditingNew(false)
  atoms.setDraft(EMPTY_DRAFT)
  atoms.setDirty(false)
  atoms.setConfirmDelete(false)
  atoms.setError('')
}

/**
 * 保存流程的执行段：busy/错误行置位、按新建或更新写入、成功后选中并刷新。
 * The execution half of the save flow: set busy/error lines, write as create or
 * update, then select the saved note and refresh.
 */
async function runSaveFlow(atoms: ViewAtoms, owner: string, title: string, openNote: (note: NoteView) => void): Promise<void> {
  const { t, actions, editingNew, selectedId, draft } = atoms
  atoms.setBusy(true)
  atoms.setError('')
  atoms.setNotice('')
  try {
    const note = editingNew
      ? await actions.onCreate({ owner, title, body: draft.body })
      : selectedId === undefined
        ? undefined
        : await actions.onUpdate({
          owner,
          id: selectedId,
          title,
          body: draft.body,
          ...draft.updatedAt === undefined ? {} : { expectedUpdatedAt: draft.updatedAt },
        })
    if (note === undefined) return
    openNote(note)
    atoms.setNotice(t('saved'))
    actions.onRefresh()
  } catch (cause: unknown) {
    atoms.setError(messageOf(cause))
  } finally {
    atoms.setBusy(false)
  }
}

/** 保存入口：先校验归属与标题，通过后进入执行段。
 * The save entry: validate the owner and title first, then run the flow. */
async function saveCurrent(atoms: ViewAtoms, openNote: (note: NoteView) => void): Promise<void> {
  const owner = atoms.state.owner
  if (owner === undefined) return
  const title = atoms.draft.title.trim()
  if (title === '') {
    atoms.setError(atoms.t('titleRequired'))
    return
  }
  await runSaveFlow(atoms, owner, title, openNote)
}

/**
 * 删除流程：首次点击只挂确认，确认后写删除、标记已删、复位选中并刷新。
 * The remove flow: the first click only arms the confirmation; once confirmed,
 * write the removal, mark the note deleted, reset the selection, and refresh.
 */
async function removeCurrent(atoms: ViewAtoms): Promise<void> {
  const owner = atoms.state.owner
  const id = atoms.selectedId
  if (owner === undefined || id === undefined) return
  if (!atoms.confirmDelete) {
    atoms.setConfirmDelete(true)
    return
  }
  atoms.setBusy(true)
  atoms.setError('')
  atoms.setNotice('')
  try {
    await atoms.actions.onRemove({ owner, id })
    atoms.deleted.current = id
    applySelectionReset(atoms)
    atoms.setNotice(atoms.t('deleted'))
    atoms.actions.onRefresh()
  } catch (cause: unknown) {
    atoms.setError(messageOf(cause))
  } finally {
    atoms.setBusy(false)
  }
}

/**
 * 由状态原子铸出页面处理器；纯工厂，不含任何 hook。
 * Mint the page handlers from the state atoms; a pure factory with no hooks.
 */
function createNotebookHandlers(atoms: ViewAtoms): NotebookView {
  const openNote = (note: NoteView): void => { applyNoteSelection(atoms, note) }
  const resetSelection = (): void => { applySelectionReset(atoms) }
  // Full reset, notice included (owner switch / start new). 全量重置，含 notice（换归属/新建）。
  const resetAll = (): void => { resetSelection(); atoms.setNotice('') }
  return {
    selectedId: atoms.selectedId, editingNew: atoms.editingNew, draft: atoms.draft, dirty: atoms.dirty,
    busy: atoms.busy, error: atoms.error, notice: atoms.notice, confirmDelete: atoms.confirmDelete,
    openNote,
    openFromList: (note: NoteView): void => { atoms.deleted.current = undefined; openNote(note) },
    startNew: (): void => {
      atoms.deleted.current = undefined
      atoms.setEditingNew(true)
      resetAll()
    },
    chooseOwner: (owner: string): void => {
      atoms.deleted.current = undefined
      atoms.actions.onSelect(owner)
      resetAll()
    },
    edit: (patch: Partial<Pick<Draft, 'title' | 'body'>>): void => {
      atoms.setDraft(current => ({ ...current, ...patch }))
      atoms.setDirty(true)
      atoms.setConfirmDelete(false)
      atoms.setError('')
    },
    save: () => saveCurrent(atoms, openNote),
    remove: () => removeCurrent(atoms),
  }
}

/** Hold the page's whole view state and derive its handlers. 持有页面全部视图状态并派生其处理器。 */
export function useNotebookView(state: NotebookSnapshot, t: (key: NotebookKey) => string, actions: Omit<NotebookPanelInjected, 'hooks'>): NotebookView {
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined)
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [editingNew, setEditingNew] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  // The note this page just deleted, until the refreshed list drops it.
  // 本页刚删除的笔记，直到刷新后的列表不再包含它。
  const deleted = useRef<string | undefined>(undefined)
  const atoms: ViewAtoms = {
    state, t, actions, selectedId, draft, editingNew, dirty, busy, error, notice, confirmDelete,
    setSelectedId, setDraft, setEditingNew, setDirty, setBusy, setError, setNotice, setConfirmDelete,
    deleted,
  }
  useOwnerChangeReset(state.owner, () => { applySelectionReset(atoms); atoms.setNotice('') })
  useNoteFollowEffect(
    { notes: state.notes, selectedId, editingNew, dirty, draftUpdatedAt: draft.updatedAt },
    note => { applyNoteSelection(atoms, note) },
    () => { applySelectionReset(atoms) },
    deleted,
    setNotice,
  )
  return createNotebookHandlers(atoms)
}
