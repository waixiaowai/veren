/**
 * The notebook page's view state: one custom hook holding the selection, the
 * draft, and every handler the header/canvas/list/editor render. Pure view
 * state on top of the inject face's callbacks — it never touches `ctx`, and a
 * re-render on selection change stays local to the body that calls the hook.
 *
 * The state atoms and the save/remove/promote flows live in `view-atoms.ts`;
 * this file keeps only the React glue (useState / ref / effects / assembly)
 * and the handler factory.
 *
 * 记事本页面的视图状态：一个自定义钩子，持有选中项、草稿与头部/画布/列表/编辑
 * 器渲染所需的全部处理器。它只是注入面回调之上的纯视图状态——绝不碰 `ctx`，
 * 选中变化引起的重渲染也只落在调用钩子的页面主体上。
 *
 * 状态原子束与保存/删除/炼成流程在 `view-atoms.ts`；本文件只留 React 粘合
 * （useState / ref / effects / 装配）与处理器铸造。
 *
 * @module @veren/notebook-ui/client/use-notebook-view
 */

import { useEffect, useRef, useState } from 'react'
import { EMPTY_DRAFT } from './editor.tsx'
import type { Draft } from './editor.tsx'
import type { NoteKind, NoteView, NotebookPanelInjected, NotebookSnapshot } from './remote.ts'
import type { NotebookKey } from './locales.ts'
import {
  applyNoteSelection, applySelectionReset, promoteCard, removeCardById, removeCurrent, saveCurrent,
} from './view-atoms.ts'

/** Everything the page body needs, with the inject face already resolved. */
export interface BodyProps {
  readonly state: NotebookSnapshot
  readonly t: (key: NotebookKey) => string
  readonly actions: Omit<NotebookPanelInjected, 'hooks'>
}

/** The view state and handlers the page body renders from. 页面主体渲染所依据的视图状态与处理器。 */
export interface NotebookView {
  readonly selectedId: string | undefined
  /** The selected card's kind, or `undefined` when nothing is selected. 选中卡的类别，未选中为 `undefined`。 */
  readonly selectedKind: NoteKind | undefined
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
  /** Drop the selection (a click on empty canvas). 清除选中（点在空画布上）。 */
  clearSelection(): void
  /** Promote the selected fleeting card into a permanent card. 把选中的闪念卡炼成永久卡。 */
  promoteSelected(): Promise<void>
  /** Promote one card by id — the intake dock's entry. 按 id 炼成一张卡——进料口的入口。 */
  promoteCard(id: string): Promise<void>
  /** Remove one card by id — the intake dock's confirmed trash. 按 id 删除一张卡——进料口确认过的「扔」。 */
  removeCard(id: string): Promise<void>
}

/** A different owner means a different notebook: drop the old draft first.
 * The reset closure rides a ref so the effect fires on owner changes only —
 * keying the effect on the closure itself re-ran the reset after every render
 * and ping-ponged against the follow effect (select first ↔ clear, forever).
 * 归属变了就是另一本笔记：先丢掉旧草稿。重置闭包走 ref，effect 只在归属变化时
 * 触发——把闭包本身放进依赖会让重置在每次渲染后重跑，与跟随副作用打成
 * 「选中第一条↔清空」的死循环。 */
function useOwnerChangeReset(owner: string | undefined, resetAll: () => void): void {
  const resetRef = useRef(resetAll)
  resetRef.current = resetAll
  useEffect(() => { resetRef.current() }, [owner])
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

/** 选中卡片的类别，从已加载的盒里找回。The selected card's kind, recovered from the loaded box. */
function selectedKindOf(atoms: Parameters<typeof applyNoteSelection>[0]): NotebookView['selectedKind'] {
  return atoms.selectedId === undefined
    ? undefined
    : atoms.state.notes.find(note => note.id === atoms.selectedId)?.kind
}

/** 导航组处理器：开卡、换归属、新建与清除。The navigation handlers: open, choose owner, start new, clear. */
function navigationHandlers(atoms: Parameters<typeof applyNoteSelection>[0], openNote: (note: NoteView) => void, resetAll: () => void): Pick<NotebookView, 'openNote' | 'openFromList' | 'startNew' | 'chooseOwner' | 'clearSelection'> {
  return {
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
    clearSelection: (): void => {
      atoms.deleted.current = undefined
      applySelectionReset(atoms)
    },
  }
}

/** 写入组处理器：编辑、保存、删除与炼成。The write handlers: edit, save, remove, promote. */
function writeHandlers(atoms: Parameters<typeof applyNoteSelection>[0], openNote: (note: NoteView) => void): Pick<NotebookView, 'edit' | 'save' | 'remove' | 'promoteSelected' | 'promoteCard' | 'removeCard'> {
  return {
    edit: (patch: Partial<Pick<Draft, 'title' | 'body'>>): void => {
      atoms.setDraft(current => ({ ...current, ...patch }))
      atoms.setDirty(true)
      atoms.setConfirmDelete(false)
      atoms.setError('')
    },
    save: () => saveCurrent(atoms, openNote),
    remove: () => removeCurrent(atoms),
    promoteSelected: async (): Promise<void> => {
      if (atoms.selectedId !== undefined) await promoteCard(atoms, atoms.selectedId, openNote)
    },
    promoteCard: async (id: string): Promise<void> => { await promoteCard(atoms, id, openNote) },
    removeCard: async (id: string): Promise<void> => { await removeCardById(atoms, id) },
  }
}

/**
 * 由状态原子铸出页面处理器；纯工厂，不含任何 hook。
 * Mint the page handlers from the state atoms; a pure factory with no hooks.
 */
function createNotebookHandlers(atoms: Parameters<typeof applyNoteSelection>[0]): NotebookView {
  const openNote = (note: NoteView): void => { applyNoteSelection(atoms, note) }
  const resetSelection = (): void => { applySelectionReset(atoms) }
  // Full reset, notice included (owner switch / start new). 全量重置，含 notice（换归属/新建）。
  const resetAll = (): void => { resetSelection(); atoms.setNotice('') }
  return {
    selectedId: atoms.selectedId, selectedKind: selectedKindOf(atoms),
    editingNew: atoms.editingNew, draft: atoms.draft, dirty: atoms.dirty,
    busy: atoms.busy, error: atoms.error, notice: atoms.notice, confirmDelete: atoms.confirmDelete,
    ...navigationHandlers(atoms, openNote, resetAll),
    ...writeHandlers(atoms, openNote),
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
  const atoms = {
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
