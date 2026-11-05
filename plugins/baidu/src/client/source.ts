/**
 * 面板的唯一可观察对象与动作面。一份快照对象发布给所有监听者；概览
 * （登录状态/资料/容量）在仍有订阅者时按 30s 间隔重读，任务按 1.5s 轮询
 * 且仅在有 running 任务时维持；目录/检索读取由动作触发（requestSeq 守卫，
 * 过期响应直接丢弃——设计 §12 公共约定）。一次性操作（分享/重命名/删除…）
 * 的结果经 ActionResult 交回调用方视图，不进共享快照。
 * The panel's single observable and action face. One snapshot publishes to
 * every listener; the overview (auth/profile/quota) re-reads on a 30s
 * interval while subscribed, jobs poll at 1.5s and only while a running job
 * exists; directory/search reads are action-driven (requestSeq guard — stale
 * responses are dropped, design §12's common covenant). One-shot operations
 * (share/rename/delete…) return ActionResult to the calling view instead of
 * entering the shared snapshot.
 *
 * @module @veren/baidu-pan/client/source
 */

import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  AccountProfile, AuthStateView, BaiduApiResult, BaiduPanRemoteApi, FileEntry, JobStartedView,
  QuotaSnapshot, ShareReceipt, SignInStartView, TransferJobSnapshot,
} from './remote.ts'

/** 概览重读间隔（毫秒）。The overview re-read interval (ms). */
const OVERVIEW_POLL_MS = 30_000

/** 任务轮询间隔（毫秒）。The job poll interval (ms). */
const JOB_POLL_MS = 1_500

/** 领域失败（与内层业务信封同构）。A domain failure (the inner business envelope's failure arm). */
export interface DomainFailure {
  readonly code: string
  readonly message: string
  readonly retryable: boolean
}

/** 一次性动作的结果：值或领域失败。One action's result: a value or a domain failure. */
export type ActionResult<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly failure: DomainFailure }

/** 目录列表的取数状态。The directory listing's fetch state. */
export interface ListingState {
  readonly entries: readonly FileEntry[]
  readonly loading: boolean
  readonly error: DomainFailure | undefined
}

/** 检索的取数状态（保留查询词与页码）。The search fetch state (query and page kept). */
export interface SearchState {
  readonly keyword: string
  readonly page: number
  readonly total: number
  readonly entries: readonly FileEntry[]
  readonly loading: boolean
  readonly error: DomainFailure | undefined
}

/** 页面快照：服务端事实 + 取数状态，视图状态（草稿/弹层）不进这里。The page snapshot: server facts plus fetch state; view state (drafts/dialogs) never enters. */
export interface BaiduSnapshot {
  readonly status: 'loading' | 'ready' | 'error'
  /** 是否有一次权威读成功过。Whether one authoritative read has ever succeeded. */
  readonly settled: boolean
  readonly error: string
  readonly auth: AuthStateView | undefined
  readonly profile: AccountProfile | undefined
  readonly quota: QuotaSnapshot | undefined
  /** 当前目录（服务端路径）；空串表示尚未打开过。The current directory (server path); empty until first opened. */
  readonly dir: string
  readonly listing: ListingState
  readonly search: SearchState | undefined
  readonly jobs: readonly TransferJobSnapshot[]
}

/** source 各闭包共享的可变状态。Mutable state shared by the source's closures. */
interface BaiduSourceState {
  snapshot: BaiduSnapshot
  epoch: number
  dirSeq: number
  searchSeq: number
  overviewTimer: ReturnType<typeof globalThis.setInterval> | undefined
  jobTimer: ReturnType<typeof globalThis.setInterval> | undefined
  listeners: Set<() => void>
}

/** 把载体信封 + 业务信封两层拆成 ActionResult。Unwraps the carrier and business envelopes into ActionResult. */
function unwrap<Value>(result: BaiduApiResult<Value>): ActionResult<Value> {
  if (!result.ok) {
    return { ok: false, failure: { code: result.error.code, message: result.error.message, retryable: false } }
  }
  if (!result.value.ok) {
    return { ok: false, failure: { code: result.value.code, message: result.value.message, retryable: result.value.retryable } }
  }
  return { ok: true, value: result.value.value }
}

/** 合并一份部分快照并通知所有监听者。Merges one partial snapshot and notifies every listener. */
function publish(state: BaiduSourceState, next: Partial<BaiduSnapshot>): void {
  state.snapshot = { ...state.snapshot, ...next }
  for (const listener of [...state.listeners]) listener()
}

/** 概览读取：登录状态必读，已登录才补资料与容量。One overview read: auth always, profile+quota only when authorized. */
async function readOverview(api: BaiduPanRemoteApi, state: BaiduSourceState, mine: number): Promise<void> {
  const authResult = await api.authState()
  if (mine !== state.epoch) return
  if (!authResult.ok || !authResult.value.ok) {
    publish(state, { status: 'error', error: carrierMessage(authResult) })
    return
  }
  const auth = authResult.value.value
  const settled = { status: 'ready' as const, settled: true, error: '', auth }
  if (!auth.authorized) {
    publish(state, { ...settled, profile: undefined, quota: undefined })
    return
  }
  const [profile, quota] = await Promise.all([api.whoami(), api.quota()])
  if (mine !== state.epoch) return
  publish(state, {
    ...settled,
    profile: profile.ok && profile.value.ok ? profile.value.value : state.snapshot.profile,
    quota: quota.ok && quota.value.ok ? quota.value.value : state.snapshot.quota,
  })
}

/** 载体/业务两层失败里取一条可读文案。Picks one readable message from the two failure layers. */
function carrierMessage(result: BaiduApiResult<unknown>): string {
  if (!result.ok) return result.error.message
  return result.value.ok ? '' : result.value.message
}

/** 目录读取：过期响应直接丢弃（requestSeq 守卫）。One directory read: stale responses drop (the requestSeq guard). */
async function readDir(api: BaiduPanRemoteApi, state: BaiduSourceState, mine: number, dir: string): Promise<void> {
  const result = await api.list({ dir })
  if (mine !== state.dirSeq) return
  if (!result.ok || !result.value.ok) {
    const failure = result.ok && !result.value.ok
      ? { code: result.value.code, message: result.value.message, retryable: result.value.retryable }
      : { code: 'gateway/internal', message: result.ok ? '' : result.error.message, retryable: false }
    publish(state, { listing: { entries: state.snapshot.listing.entries, loading: false, error: failure } })
    return
  }
  publish(state, { dir: result.value.value.dir, listing: { entries: result.value.value.entries, loading: false, error: undefined } })
}

/** 打开一个目录（失败也保留旧条目并标过期——设计 §10.3）。Opens one directory (failures keep the old rows marked stale — design §10.3). */
function openDir(api: BaiduPanRemoteApi, state: BaiduSourceState, dir: string): void {
  state.dirSeq += 1
  publish(state, { dir, listing: { entries: [], loading: true, error: undefined } })
  void readDir(api, state, state.dirSeq, dir)
}

/** 检索读取：旧响应按 requestSeq 丢弃。One search read: stale responses drop by requestSeq. */
async function readSearch(api: BaiduPanRemoteApi, state: BaiduSourceState, mine: number, keyword: string, page: number, dir?: string): Promise<void> {
  const result = await api.search({ keyword, page, num: 20, ...(dir === undefined ? {} : { dir }) })
  if (mine !== state.searchSeq) return
  const base = { keyword, page }
  if (!result.ok || !result.value.ok) {
    const failure = result.ok && !result.value.ok
      ? { code: result.value.code, message: result.value.message, retryable: result.value.retryable }
      : { code: 'gateway/internal', message: result.ok ? '' : result.error.message, retryable: false }
    publish(state, { search: { ...base, total: 0, entries: [], loading: false, error: failure } })
    return
  }
  publish(state, {
    search: { ...base, total: result.value.value.total, entries: result.value.value.entries, loading: false, error: undefined },
  })
}

/** 发起检索：筛选变化把页码重置为 1（设计 §12.6）。Starts a search: filter changes reset the page to 1 (design §12.6). */
function runSearch(api: BaiduPanRemoteApi, state: BaiduSourceState, keyword: string, page: number): void {
  state.searchSeq += 1
  publish(state, { search: { keyword, page, total: 0, entries: [], loading: true, error: undefined } })
  void readSearch(api, state, state.searchSeq, keyword, page)
}

/** 任务读取，并在仍有 running 任务时维持轮询定时器。One job read; keeps the poll timer alive while a running job exists. */
async function readJobs(api: BaiduPanRemoteApi, state: BaiduSourceState): Promise<void> {
  const result = await api.jobs()
  if (!result.ok || !result.value.ok) return
  publish(state, { jobs: result.value.value.jobs })
  if (result.value.value.jobs.some(job => job.phase === 'running')) ensureJobTimer(api, state)
  else stopJobTimer(state)
}

/** 启动任务轮询定时器（幂等）。Starts the job poll timer (idempotent). */
function ensureJobTimer(api: BaiduPanRemoteApi, state: BaiduSourceState): void {
  if (state.jobTimer !== undefined) return
  state.jobTimer = globalThis.setInterval(() => void readJobs(api, state), JOB_POLL_MS)
}

/** 停止任务轮询定时器。Stops the job poll timer. */
function stopJobTimer(state: BaiduSourceState): void {
  if (state.jobTimer === undefined) return
  globalThis.clearInterval(state.jobTimer)
  state.jobTimer = undefined
}

/** 订阅：首个监听者拉概览与任务并挂概览定时器；最后一个监听者清理一切。Subscribes: the first listener pulls overview+jobs and mounts the overview timer; the last cleans up. */
function subscribe(api: BaiduPanRemoteApi, state: BaiduSourceState, listener: () => void): () => void {
  state.listeners.add(listener)
  if (state.listeners.size === 1) {
    state.epoch += 1
    void readOverview(api, state, state.epoch)
    state.overviewTimer = globalThis.setInterval(() => {
      state.epoch += 1
      void readOverview(api, state, state.epoch)
    }, OVERVIEW_POLL_MS)
    void readJobs(api, state)
    ensureJobTimer(api, state)
  }
  return () => {
    state.listeners.delete(listener)
    if (state.listeners.size !== 0) return
    if (state.overviewTimer !== undefined) globalThis.clearInterval(state.overviewTimer)
    state.overviewTimer = undefined
    stopJobTimer(state)
    state.epoch += 1
  }
}

/** 执行一次性动作并按需回读概览（登录态变化）。Runs one one-shot action, re-reading the overview when the auth state may have moved. */
async function runAction<Value>(
  api: BaiduPanRemoteApi, state: BaiduSourceState, action: () => Promise<BaiduApiResult<Value>>,
  reauth: boolean,
): Promise<ActionResult<Value>> {
  const result = unwrap(await action())
  if (result.ok && reauth) {
    state.epoch += 1
    void readOverview(api, state, state.epoch)
  }
  return result
}

/**
 * 构建面板的唯一可观察对象与动作面。
 * Builds the panel's single observable and action face.
 */
export function createBaiduSource(api: BaiduPanRemoteApi): {
  readonly source: HostObservable<BaiduSnapshot>
  readonly refreshOverview: () => void
  readonly refreshJobs: () => void
  readonly openDir: (dir: string) => void
  readonly reloadDir: () => void
  readonly runSearch: (keyword: string, page: number) => void
  readonly clearSearch: () => void
  readonly beginSignIn: () => Promise<ActionResult<SignInStartView>>
  readonly submitSignInCode: (code: string) => Promise<ActionResult<AuthStateView>>
  readonly signOut: () => Promise<ActionResult<{ readonly signedOut: true }>>
  readonly createDir: (path: string) => Promise<ActionResult<{ readonly fsid: string; readonly path: string }>>
  readonly renameEntry: (path: string, newName: string) => Promise<ActionResult<{ readonly path: string }>>
  readonly transferEntry: (op: 'copy' | 'move', sourcePath: string, destDir: string, newName?: string) => Promise<ActionResult<{ readonly path: string }>>
  readonly removeItems: (paths: readonly string[], confirmPaths: readonly string[]) => Promise<ActionResult<{ readonly paths: readonly string[] }>>
  readonly shareItems: (paths: readonly string[], period?: number) => Promise<ActionResult<ShareReceipt>>
  readonly startUpload: (localPath: string, remotePath: string, overwrite: boolean) => Promise<ActionResult<JobStartedView>>
  readonly startDownload: (remotePath: string, localPath: string) => Promise<ActionResult<JobStartedView>>
} {
  const state: BaiduSourceState = {
    snapshot: {
      status: 'loading', settled: false, error: '', auth: undefined, profile: undefined, quota: undefined,
      dir: '', listing: { entries: [], loading: false, error: undefined }, search: undefined, jobs: [],
    },
    epoch: 0, dirSeq: 0, searchSeq: 0,
    overviewTimer: undefined, jobTimer: undefined, listeners: new Set(),
  }
  const mutate = async <V>(action: () => Promise<BaiduApiResult<V>>, reload: boolean): Promise<ActionResult<V>> => {
    const result = unwrap(await action())
    if (result.ok && reload) openDir(api, state, state.snapshot.dir)
    return result
  }
  return {
    source: {
      getSnapshot: () => state.snapshot,
      subscribe: (listener: () => void) => subscribe(api, state, listener),
    },
    refreshOverview: () => {
      state.epoch += 1
      void readOverview(api, state, state.epoch)
    },
    refreshJobs: () => { void readJobs(api, state) },
    openDir: dir => { openDir(api, state, dir) },
    reloadDir: () => { openDir(api, state, state.snapshot.dir) },
    runSearch: (keyword, page) => { runSearch(api, state, keyword, page) },
    clearSearch: () => {
      state.searchSeq += 1
      publish(state, { search: undefined })
    },
    beginSignIn: () => runAction(api, state, () => api.beginSignIn(), false),
    submitSignInCode: code => runAction(api, state, () => api.submitSignInCode({ code }), true),
    signOut: () => runAction(api, state, () => api.signOut(), true),
    createDir: path => mutate(() => api.makeDir({ path }), true),
    renameEntry: (path, newName) => mutate(() => api.rename({ path, newName }), true),
    transferEntry: (op, sourcePath, destDir, newName) => mutate(() => api.transfer({ op, sourcePath, destDir, ...(newName === undefined ? {} : { newName }) }), true),
    removeItems: (paths, confirmPaths) => mutate(() => api.remove({ paths, confirmPaths }), true),
    shareItems: (paths, period) => runAction(api, state, () => api.share({ paths, ...(period === undefined ? {} : { period }) }), false),
    startUpload: async (localPath, remotePath, overwrite) => {
      const result = await runAction(api, state, () => api.startUpload({ localPath, remotePath, overwrite }), false)
      if (result.ok) void readJobs(api, state)
      return result
    },
    startDownload: async (remotePath, localPath) => {
      const result = await runAction(api, state, () => api.startDownload({ remotePath, localPath }), false)
      if (result.ok) void readJobs(api, state)
      return result
    },
  }
}
