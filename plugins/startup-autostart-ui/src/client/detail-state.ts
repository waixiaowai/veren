/**
 * The detail pane's interaction state: the draft editor, the busy/note/confirm
 * flags, and the three operations (save, run, remove) the pane's buttons drive.
 *
 * Every operation writes nothing itself; each reaches the Host through the
 * injected action callbacks and reports its result as the pane's status note,
 * so the pane stays a pure view over Host-committed state.
 *
 * 详情面板的交互状态：草稿编辑器、忙碌/提示/确认三组标志，以及面板按钮驱动的三个
 * 操作（保存、运行、删除）。
 *
 * 每个操作自身都不写数据：都经注入的动作回调触达宿主，并把结果作为面板的状态提示，
 * 因此面板始终是宿主已提交状态的纯视图。
 *
 * @module @veren/startup-autostart/client/detail-state
 */

import { useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { StartupModelOption } from './choices.ts'
import type { StartupItemRequest, StartupItemView } from './remote.ts'
import { changedFields, draftOf, validateDraft } from './detail-draft.ts'
import type { Draft, EditDraft } from './detail-draft.ts'

/**
 * Actions the detail pane performs through the plugin's injected callbacks.
 * Declared here because the state hook drives them; the pane component
 * re-exports the type for the panel.
 */
export interface StartupDetailActions {
  /** Persist an edit; resolves to a failure message, or `undefined` on success. */
  readonly onUpdate: (request: StartupItemRequest & { readonly id: string }) => Promise<string | undefined>
  /** Delete one item; resolves to a failure message, or `undefined` on success. */
  readonly onDelete: (id: string) => Promise<string | undefined>
  /** Run one item now; resolves to the retained outcome. */
  readonly onRun: (id: string) => Promise<{ readonly ok: boolean; readonly detail: string }>
}

/** Everything the state hook needs: the committed item, copy, and the actions. */
export interface StartupDetailDeps extends StartupDetailActions {
  readonly item: StartupItemView
  readonly t: PropsLocale<'startup.panel'>['t']
  /** Model routes for the model dropdown's diffing. */
  readonly models: readonly StartupModelOption[]
}

/** The view and interaction state one detail pane renders from. */
export interface StartupDetailPane {
  readonly draft: Draft
  readonly dirty: boolean
  readonly note: string | undefined
  readonly bad: boolean
  readonly busy: boolean
  readonly confirming: boolean
  readonly edit: EditDraft
  readonly revert: () => void
  readonly save: () => Promise<void>
  readonly run: () => Promise<void>
  readonly remove: () => Promise<void>
  readonly setConfirming: (next: boolean) => void
}

/** The status setters the operations write their result through. */
interface StatusSetters {
  setBad: (bad: boolean) => void
  setNote: (note: string | undefined) => void
}

/** The busy latch every operation holds while its Host call is in flight. */
function useBusyGate(): { readonly busy: boolean; readonly during: (work: () => Promise<void>) => Promise<void> } {
  const [busy, setBusy] = useState(false)
  const during = async (work: () => Promise<void>): Promise<void> => {
    setBusy(true)
    try {
      await work()
    } finally {
      setBusy(false)
    }
  }
  return { busy, during }
}

/** The draft editor: the editable copy of the committed item and its dirty flag. */
function useDraftEditor(item: StartupItemView): {
  readonly draft: Draft
  readonly edit: EditDraft
  readonly revert: () => void
  readonly dirty: boolean
} {
  const [draft, setDraft] = useState<Draft>(() => draftOf(item))
  const edit: EditDraft = (key, value) => { setDraft(current => ({ ...current, [key]: value })) }
  const revert = (): void => { setDraft(draftOf(item)) }
  const dirty = JSON.stringify(draft) !== JSON.stringify(draftOf(item))
  return { draft, edit, revert, dirty }
}

/**
 * The save operation: validate first, then persist the draft and re-seed it
 * from the Host's answer.
 */
function saveOp(
  deps: StartupDetailDeps,
  draft: Draft,
  during: (work: () => Promise<void>) => Promise<void>,
  status: StatusSetters,
): () => Promise<void> {
  return async () => {
    // A required field left blank stops here with a readable message.
    // 必填字段为空时在这里停下并给出可读提示。
    const violation = validateDraft(draft, deps.t)
    if (violation !== undefined) {
      status.setBad(true)
      status.setNote(violation)
      return
    }
    await during(async () => {
      const failure = await deps.onUpdate(changedFields(deps.item, draft, deps.models))
      status.setBad(failure !== undefined)
      status.setNote(failure ?? deps.t('panel.detail.saved'))
    })
  }
}

/** The run operation: run the item once and surface the retained outcome. */
function runOp(
  deps: StartupDetailDeps,
  during: (work: () => Promise<void>) => Promise<void>,
  status: StatusSetters,
): () => Promise<void> {
  return () => during(async () => {
    const outcome = await deps.onRun(deps.item.id)
    status.setBad(!outcome.ok)
    status.setNote(deps.t(outcome.ok ? 'panel.detail.run.ok' : 'panel.detail.run.failed', { detail: outcome.detail }))
  })
}

/** The remove operation: delete after the confirmation, surfacing any failure. */
function removeOp(
  deps: StartupDetailDeps,
  during: (work: () => Promise<void>) => Promise<void>,
  status: StatusSetters,
  setConfirming: (next: boolean) => void,
): () => Promise<void> {
  return () => during(async () => {
    const failure = await deps.onDelete(deps.item.id)
    status.setBad(failure !== undefined)
    status.setNote(failure ?? deps.t('panel.detail.deleted'))
    setConfirming(false)
  })
}

/**
 * Build the pane's whole interaction state from the committed item and the
 * injected actions.
 * @param deps - the committed item, localized copy, and the Host actions.
 * @returns the draft, flags, and operations the pane renders from.
 */
export function useStartupDetailPane(deps: StartupDetailDeps): StartupDetailPane {
  const editor = useDraftEditor(deps.item)
  const gate = useBusyGate()
  const [note, setNote] = useState<string | undefined>(undefined)
  const [bad, setBad] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const status: StatusSetters = { setBad, setNote }
  const edit: EditDraft = (key, value) => {
    editor.edit(key, value)
    setNote(undefined)
  }
  return {
    draft: editor.draft,
    dirty: editor.dirty,
    note,
    bad,
    busy: gate.busy,
    confirming,
    edit,
    revert: (): void => { editor.revert(); setNote(undefined) },
    save: saveOp(deps, editor.draft, gate.during, status),
    run: runOp(deps, gate.during, status),
    remove: removeOp(deps, gate.during, status, setConfirming),
    setConfirming,
  }
}
