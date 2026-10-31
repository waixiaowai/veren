/**
 * The notebook page's single observable over the Remote namespace.
 *
 * One source serves the whole page: it polls the owner roster and the selected
 * owner's notes, keeps the selected owner when it still exists (else prefers a
 * declared preset), and republishes on every round. The snapshot keeps its
 * identity until a fact moves, so components re-render only on real change.
 *
 * 记事本页面的唯一可观察对象。一个源服务整个页面：轮询归属名册与当前归属的笔记，
 * 归属仍存在就保持选中（否则优先声明过的预设），每轮重新发布。事实未变时快照引用
 * 保持不变，因此只有真正变化才会触发重渲染。
 *
 * 实现按步骤拆分：发布、单轮读取、装载与订阅/退订各自是模块级函数，经
 * NotebookSourceState 共享可变状态。
 * The implementation is split by step: publish, one round, the load trigger,
 * and subscribe/unsubscribe are module-level functions sharing mutable state
 * through NotebookSourceState.
 *
 * @module @veren/notebook-ui/client/source
 */

import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { NoteView, NotebookRemoteApi, NotebookSnapshot, OwnerView } from './remote.ts'

/** How long the open page waits before re-reading, in milliseconds. */
const POLL_MS = 8_000

/** The observable plus the owner selection and manual refresh the page uses. */
export interface NotebookSource {
  readonly source: HostObservable<NotebookSnapshot>
  readonly select: (owner: string) => void
  readonly refresh: () => void
}

/** 源的内部可变状态。Internal mutable state of the notebook source. */
interface NotebookSourceState {
  snapshot: NotebookSnapshot
  owner: string | undefined
  epoch: number
  timer: ReturnType<typeof globalThis.setInterval> | undefined
  readonly listeners: Set<() => void>
}

/** 初值快照；每次调用都给新对象，保持原来的引用语义。The initial snapshot; a new object per call keeps the original reference semantics. */
const initialSnapshot = (): NotebookSnapshot => ({
  owners: [], owner: undefined, notes: [], status: 'loading', settled: false, error: '',
})

/** 向全部监听者广播一次快照更新。Broadcast one snapshot update to every listener. */
function publishSnapshot(state: NotebookSourceState, next: Partial<NotebookSnapshot>): void {
  state.snapshot = { ...state.snapshot, ...next }
  for (const listener of [...state.listeners]) listener()
}

/**
 * 单轮读取：解析归属、读笔记并发布；epoch 已前进的过期轮按丢弃处理。
 * One round: resolve the owner, read the notes, and publish; a round whose
 * epoch has moved on is discarded.
 */
async function runRound(api: NotebookRemoteApi, state: NotebookSourceState, mine: number): Promise<void> {
  try {
    const owners = await readOwners(api)
    const chosen = chooseOwner(owners, state.owner)
    state.owner = chosen
    if (chosen === undefined) {
      if (mine === state.epoch) {
        publishSnapshot(state, { owners, owner: undefined, notes: [], status: 'ready', settled: true, error: '' })
      }
      return
    }
    const notes = await readNotes(api, chosen)
    if (mine !== state.epoch) return
    publishSnapshot(state, { owners, owner: chosen, notes, status: 'ready', settled: true, error: '' })
  } catch (error: unknown) {
    if (mine === state.epoch) publishSnapshot(state, { status: 'error', error: messageOf(error) })
  }
}

/** 触发一轮读取：前进 epoch，未落定时先发布 loading。Start one round: advance the epoch and publish `loading` first while not yet settled. */
function loadRound(api: NotebookRemoteApi, state: NotebookSourceState): void {
  const mine = ++state.epoch
  if (!state.snapshot.settled) publishSnapshot(state, { status: 'loading' })
  void runRound(api, state, mine)
}

/** 末位退订：停轮询并前进 epoch。The last unsubscribe: stop the poll and advance the epoch. */
function unsubscribeSource(state: NotebookSourceState, listener: () => void): void {
  state.listeners.delete(listener)
  if (state.listeners.size !== 0) return
  if (state.timer !== undefined) globalThis.clearInterval(state.timer)
  state.timer = undefined
  state.epoch += 1
}

/**
 * Build the page's single observable over the Remote namespace.
 * @param api - the mounted `remote.notebook` namespace.
 * @returns the observable, its owner selection, and its manual refresh.
 */
export function createNotebookSource(api: NotebookRemoteApi): NotebookSource {
  const state: NotebookSourceState = { snapshot: initialSnapshot(), owner: undefined, epoch: 0, timer: undefined, listeners: new Set() }
  return {
    source: {
      getSnapshot: () => state.snapshot,
      subscribe(listener) {
        state.listeners.add(listener)
        if (state.listeners.size === 1) {
          loadRound(api, state)
          state.timer = globalThis.setInterval(() => { loadRound(api, state) }, POLL_MS)
        }
        return () => { unsubscribeSource(state, listener) }
      },
    },
    select: (next) => { state.owner = next; loadRound(api, state) },
    refresh: () => { loadRound(api, state) },
  }
}

/** Keep the selected owner when it still exists, else prefer a declared preset. */
function chooseOwner(owners: readonly OwnerView[], current: string | undefined): string | undefined {
  if (current !== undefined && owners.some(owner => owner.id === current)) return current
  return owners.find(owner => owner.declared)?.id ?? owners[0]?.id
}

/** Read the owner list or throw the Host's message. */
async function readOwners(api: NotebookRemoteApi): Promise<readonly OwnerView[]> {
  const result = await api.owners({})
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

/** Read one owner's notes or throw the Host's message. */
async function readNotes(api: NotebookRemoteApi, owner: string): Promise<readonly NoteView[]> {
  const result = await api.list({ owner })
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

/** Render one failure as a single line. */
function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && error !== null && 'message' in error) return String(error.message)
  return String(error)
}
