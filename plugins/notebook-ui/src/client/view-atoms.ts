/**
 * The view hook's state atoms and the module-level flows that move them: the
 * atom bundle travels between the hook (React glue, in `use-notebook-view`)
 * and these pure flows, so every function stays small and hook-free.
 *
 * Flows living here: the selection moves, the save flow, the remove flow, and
 * the promote flow — the intake dock's and the editor's one compounding step.
 * None of them touch `ctx`; every host write rides the inject face's
 * callbacks the atoms carry.
 *
 * 视图钩子的状态原子束与推动它们的模块级流程：原子束在钩子（React 粘合，见
 * `use-notebook-view`）与这些纯流程之间穿行，每个函数都保持小而无钩子。
 *
 * 这里的流程：选中迁移、保存流程、删除流程与炼成流程——进料口与编辑器共用的
 * 那一步化合。它们都不碰 `ctx`；每次宿主写入都经原子束携带的注入面回调。
 *
 * @module @veren/notebook-ui/client/view-atoms
 */

import { EMPTY_DRAFT } from './editor.tsx'
import type { Draft } from './editor.tsx'
import type { NoteView, NotebookPanelInjected, NotebookSnapshot } from './remote.ts'
import type { NotebookKey } from './locales.ts'

/** 钩子与模块级助手共享的状态原子束：快照值、setter、动作面与删除标记。
 * The atom bundle shared by the hook and the module-level helpers: snapshot
 * values, setters, the action face, and the deletion marker. */
export interface ViewAtoms {
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
  /** Whether any card was selected since the last owner switch — gates the
   * auto-select-first so an explicit clear stays cleared. 自上次换归属以来是否
   * 选中过卡——给「自动选中第一条」上闸，显式清除后不再自动回选。 */
  readonly everSelected: { current: boolean }
}

/** Render one failure as a single line. */
export function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && error !== null && 'message' in error) return String(error.message)
  return String(error)
}

/** 选中一条笔记：记下选中、载入草稿并清掉残留的编辑态。
 * Select one note: remember the selection, load its draft, and clear the
 * leftover edit state. */
export function applyNoteSelection(atoms: ViewAtoms, note: NoteView): void {
  atoms.everSelected.current = true
  atoms.setSelectedId(note.id)
  atoms.setEditingNew(false)
  atoms.setDraft({ title: note.title, body: note.body, updatedAt: note.updatedAt })
  atoms.setDirty(false)
  atoms.setConfirmDelete(false)
  atoms.setError('')
}

/** 选中/新建之外的落定形状（不动 notice）。
 * The settled shape outside a selection or a new draft (notice untouched). */
export function applySelectionReset(atoms: ViewAtoms): void {
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
export async function runSaveFlow(atoms: ViewAtoms, owner: string, title: string, openNote: (note: NoteView) => void): Promise<void> {
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
export async function saveCurrent(atoms: ViewAtoms, openNote: (note: NoteView) => void): Promise<void> {
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
export async function removeCurrent(atoms: ViewAtoms): Promise<void> {
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
 * 炼成流程：把一张闪念卡交给完整写入纪律；成功即选中炼成的永久卡并刷新，失败
 * （如 link-unresolved）落错误行——错误消息里带着相近标题，改完再炼。
 * The promote flow: hand one fleeting card to the full write-time discipline;
 * success selects the promoted permanent card and refreshes, a refusal (say
 * link-unresolved) lands on the error line — the message names close titles,
 * fix and promote again.
 */
export async function promoteCard(atoms: ViewAtoms, id: string, openNote: (note: NoteView) => void): Promise<void> {
  const owner = atoms.state.owner
  if (owner === undefined) return
  atoms.setBusy(true)
  atoms.setError('')
  atoms.setNotice('')
  try {
    const note = await atoms.actions.onPromote({ owner, id })
    openNote(note)
    atoms.setNotice(atoms.t('promoted'))
    atoms.actions.onRefresh()
  } catch (cause: unknown) {
    atoms.setError(messageOf(cause))
  } finally {
    atoms.setBusy(false)
  }
}

/**
 * 按 id 删除流程（进料口的「扔」）：确认归 dock 挂，这里只执行——标记已删、
 * 复位选中并刷新；拒绝（如 card-referenced）落错误行。
 * The by-id remove flow (the dock's "trash"): the confirmation lives in the
 * dock, this only executes — mark deleted, reset the selection, refresh; a
 * refusal (say card-referenced) lands on the error line.
 */
export async function removeCardById(atoms: ViewAtoms, id: string): Promise<void> {
  const owner = atoms.state.owner
  if (owner === undefined) return
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
