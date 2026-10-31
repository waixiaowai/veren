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
  /** The note this page just deleted, until the refreshed list drops it. */
  const deleted = useRef<string | undefined>(undefined)
  const openNote = (note: NoteView): void => {
    setSelectedId(note.id)
    setEditingNew(false)
    setDraft({ title: note.title, body: note.body, updatedAt: note.updatedAt })
    setDirty(false)
    setConfirmDelete(false)
    setError('')
  }
  /** The settled shape outside a selection or a new draft (no notice change).
   * 选中/新建之外的落定形状（不动 notice）。 */
  const resetSelection = (): void => {
    setSelectedId(undefined)
    setEditingNew(false)
    setDraft(EMPTY_DRAFT)
    setDirty(false)
    setConfirmDelete(false)
    setError('')
  }
  /** Full reset, notice included (owner switch / start new). 全量重置，含 notice（换归属/新建）。 */
  const resetAll = (): void => {
    resetSelection()
    setNotice('')
  }
  useOwnerChangeReset(state.owner, resetAll)
  useNoteFollowEffect(
    { notes: state.notes, selectedId, editingNew, dirty, draftUpdatedAt: draft.updatedAt },
    openNote, resetSelection, deleted, setNotice,
  )
  const startNew = (): void => {
    deleted.current = undefined
    setEditingNew(true)
    resetAll()
  }
  const chooseOwner = (owner: string): void => {
    deleted.current = undefined
    actions.onSelect(owner)
    resetAll()
  }
  const edit = (patch: Partial<Pick<Draft, 'title' | 'body'>>): void => {
    setDraft(current => ({ ...current, ...patch }))
    setDirty(true)
    setConfirmDelete(false)
    setError('')
  }
  const runSave = async (owner: string, title: string): Promise<void> => {
    setBusy(true)
    setError('')
    setNotice('')
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
      setNotice(t('saved'))
      actions.onRefresh()
    } catch (cause: unknown) {
      setError(messageOf(cause))
    } finally {
      setBusy(false)
    }
  }
  const save = async (): Promise<void> => {
    const owner = state.owner
    if (owner === undefined) return
    const title = draft.title.trim()
    if (title === '') {
      setError(t('titleRequired'))
      return
    }
    await runSave(owner, title)
  }
  const runRemove = async (owner: string, id: string): Promise<void> => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await actions.onRemove({ owner, id })
      deleted.current = id
      resetSelection()
      setNotice(t('deleted'))
      actions.onRefresh()
    } catch (cause: unknown) {
      setError(messageOf(cause))
    } finally {
      setBusy(false)
    }
  }
  const remove = async (): Promise<void> => {
    const owner = state.owner
    const id = selectedId
    if (owner === undefined || id === undefined) return
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    await runRemove(owner, id)
  }
  const openFromList = (note: NoteView): void => {
    deleted.current = undefined
    openNote(note)
  }
  return {
    selectedId, editingNew, draft, dirty, busy, error, notice, confirmDelete,
    openNote, openFromList, startNew, chooseOwner, edit, save, remove,
  }
}
