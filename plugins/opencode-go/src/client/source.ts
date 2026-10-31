/**
 * The sign-in card's observable source: one stable-snapshot store, the
 * describe+poll loop, and one named factory per user action. `getSnapshot`
 * stability is the load-bearing invariant — see `createOgStore`.
 * 登录卡片的可观察状态源：稳定快照 store、describe+poll 轮询循环，以及每个
 * 用户动作一个具名工厂。`getSnapshot` 的稳定性是承重不变量——见
 * `createOgStore`。
 *
 * @module @veren/opencode-go/client/source
 */
import type { Context } from '@deepseek-ai/cordis'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { OgCardSnapshot } from './card.tsx'
import type { OgDescribe, OgPoll } from './remote.ts'

/** 进行中卡片的轮询间隔。The poll interval while the card is in flight. */
const POLL_MS = 1_500

/** 动作与轮询共享的可变读取状态。The mutable read state shared by actions and polling. */
interface OgReadState {
  describe: OgDescribe | undefined
  poll: OgPoll | undefined
  error: string
  errorCode: string | undefined
  pasteOpen: boolean
}

/** 稳定快照 store 与错误助手。The stable-snapshot store plus error helpers. */
interface OgStore {
  readonly source: HostObservable<OgCardSnapshot>
  readonly commit: (next: Partial<OgCardSnapshot>) => void
  readonly state: OgReadState
  readonly clearError: () => void
  readonly setError: (failure: { readonly message: string, readonly code?: string }) => void
}

/** 动作工厂的共享依赖。The shared dependencies of the action factories. */
interface OgActionDeps {
  readonly api: Context['remote']['opencodeGo']
  readonly state: OgReadState
  readonly commit: (next: Partial<OgCardSnapshot>) => void
  readonly startPolling: () => Promise<void>
  readonly readOnce: () => Promise<void>
  readonly clearError: () => void
  readonly setError: (failure: { readonly message: string, readonly code?: string }) => void
}

/** 轮询循环面。The poll-loop face. */
interface OgPollLoop {
  readonly readOnce: () => Promise<void>
  readonly startPolling: () => Promise<void>
  readonly stopPolling: () => void
}

/**
 * 组合稳定快照 store：状态保持在 `current` 里，变更整对象替换后再 notify。
 * useSyncExternalStore's getSnapshot must return a stable reference: state
 * lives in `current` and is replaced whole on change — building a fresh
 * object per call trips React #185 (Maximum update depth).
 */
function createOgStore(): OgStore {
  const state: OgReadState = { describe: undefined, poll: undefined, error: '', errorCode: undefined, pasteOpen: false }
  let current: OgCardSnapshot = { describe: undefined, poll: undefined, error: '', errorCode: undefined, pasteOpen: false }
  const listeners = new Set<() => void>()
  const source: HostObservable<OgCardSnapshot> = {
    getSnapshot: () => current,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
  const commit = (next: Partial<OgCardSnapshot>): void => {
    current = { ...current, ...next }
    for (const listener of [...listeners]) listener()
  }
  const clearError = (): void => {
    state.error = ''
    state.errorCode = undefined
    commit({ error: '', errorCode: undefined })
  }
  const setError = (failure: { readonly message: string, readonly code?: string }): void => {
    state.error = failure.message
    state.errorCode = failure.code
    commit({ error: state.error, errorCode: state.errorCode })
  }
  return { source, commit, state, clearError, setError }
}

/**
 * 读取一轮 describe+poll 并提交快照；业务失败记录原错误码，传输失败记
 * TRANSPORT 并停轮询（与授权错误语义分离）。
 * Reads one describe+poll round and commits the snapshot; business failures
 * record their original code, transport failures record TRANSPORT and stop
 * polling (kept apart from authorization errors).
 */
async function readOgOnce(
  api: Context['remote']['opencodeGo'],
  state: OgReadState,
  commit: (next: Partial<OgCardSnapshot>) => void,
  stopPolling: () => void,
): Promise<void> {
  try {
    const [description, pollState] = await Promise.all([api.describe(), api.poll()])
    if (description.ok) state.describe = description.value
    if (pollState.ok) {
      state.poll = pollState.value
      state.error = ''
      state.errorCode = undefined
      if (!pollState.value.inFlight) stopPolling()
    } else {
      state.error = pollState.error.message
      state.errorCode = pollState.error.code
      stopPolling()
    }
    commit({ describe: state.describe, poll: state.poll, error: state.error, errorCode: state.errorCode })
  } catch {
    // 传输层失败（节点重启窗口等）：人话 + 重试，不与授权错误混淆。
    // A transport failure (node restart window and alike): human copy +
    // retry, never conflated with authorization errors.
    state.errorCode = 'TRANSPORT'
    stopPolling()
    commit({ errorCode: state.errorCode })
  }
}

/** 组合轮询循环：先取一次，再按间隔轮询。Composes the read loop: one fetch, then interval polling. */
function createOgPollLoop(api: Context['remote']['opencodeGo'], state: OgReadState, commit: (next: Partial<OgCardSnapshot>) => void): OgPollLoop {
  let timer: ReturnType<typeof globalThis.setInterval> | undefined
  const stopPolling = (): void => {
    if (timer === undefined) return
    globalThis.clearInterval(timer)
    timer = undefined
  }
  const readOnce = async (): Promise<void> => readOgOnce(api, state, commit, stopPolling)
  const startPolling = async (): Promise<void> => {
    await readOnce()
    stopPolling()
    timer = setInterval(() => { void readOnce() }, POLL_MS)
  }
  return { readOnce, startPolling, stopPolling }
}

/** startAuto 动作：开授权页并请求宿主自动监听导入。The startAuto action: open the auth page and ask the host to watch-import. */
function ogStartAutoAction(deps: OgActionDeps): () => void {
  return () => {
    window.open('https://opencode.ai/auth', '_blank', 'noopener')
    void (async () => {
      const started = await deps.api.beginAuto()
      if (!started.ok) {
        deps.setError(started.error)
        return
      }
      await deps.startPolling()
    })()
  }
}

/** togglePaste 动作：展开/收起手动方法列表。The togglePaste action: expand/collapse the manual method list. */
function ogTogglePasteAction(deps: OgActionDeps): () => void {
  return () => {
    deps.state.pasteOpen = !deps.state.pasteOpen
    deps.commit({ pasteOpen: deps.state.pasteOpen })
  }
}

/** start 动作：指定方法的一次登录；进行中则重接。The start action: one sign-in for a method; re-attaches while in flight. */
function ogStartAction(deps: OgActionDeps): (method: string) => void {
  return (method) => {
    void (async () => {
      // inFlight 时 begin 必被缝拒绝——重接是唯一正解，错误态不可表达。
      // With inFlight the seam refuses begin — re-attach is the only right
      // answer; the error state must not be expressible.
      if (deps.state.describe?.inFlight === true) {
        deps.state.error = ''
        deps.state.errorCode = undefined
        await deps.startPolling()
        return
      }
      deps.clearError()
      const started = await deps.api.begin({ method })
      if (!started.ok) {
        deps.setError(started.error)
        return
      }
      await deps.startPolling()
    })()
  }
}

/** attach 动作：恢复轮询（传输恢复/重接共用）。The attach action: restores polling (shared by transport recovery and re-attach). */
function ogAttachAction(deps: OgActionDeps): () => void {
  return () => {
    deps.clearError()
    void deps.startPolling()
  }
}

/** answer 动作：提交提问答案，失败记录错误。The answer action: submits the prompt answer, recording failures. */
function ogAnswerAction(deps: OgActionDeps): (value: string) => void {
  return (value) => {
    void deps.api.answer({ value }).then((result) => {
      if (!result.ok) deps.setError(result.error)
    })
  }
}

/** cancel 动作：撤回进行中的尝试并重读状态。The cancel action: withdraws the running attempt and re-reads state. */
function ogCancelAction(deps: OgActionDeps): () => void {
  return () => {
    void deps.api.cancel().then((result) => {
      if (!result.ok) deps.state.error = result.error.message
      void deps.readOnce()
    })
  }
}

/** dismiss 动作：收起终局提示。The dismiss action: folds the settlement notice away. */
function ogDismissAction(deps: OgActionDeps): () => void {
  return () => {
    deps.state.poll = deps.state.poll === undefined ? undefined : { ...deps.state.poll, settled: undefined }
    deps.commit({ poll: deps.state.poll })
  }
}

/** signOut 动作：删除凭据并重读状态。The signOut action: deletes the credential and re-reads state. */
function ogSignOutAction(deps: OgActionDeps): () => void {
  return () => {
    void deps.api.signOut().then((result) => {
      if (!result.ok) deps.state.error = result.error.message
      void deps.readOnce()
    })
  }
}

/**
 * 组合 describe+poll 的单一可观察状态与动作：store（稳定快照）+ 轮询循环 +
 * 每个动作一个具名工厂。
 * Composes describe+poll into one observable state plus actions: the store
 * (stable snapshot) + the poll loop + one named factory per action.
 */
export function createOgSource(api: Context['remote']['opencodeGo']): {
  readonly source: HostObservable<OgCardSnapshot>
  readonly startAuto: () => void
  readonly start: (method: string) => void
  readonly attach: () => void
  readonly answer: (value: string) => void
  readonly cancel: () => void
  readonly dismiss: () => void
  readonly signOut: () => void
  readonly togglePaste: () => void
} {
  const store = createOgStore()
  const loop = createOgPollLoop(api, store.state, store.commit)
  const deps: OgActionDeps = {
    api,
    state: store.state,
    commit: store.commit,
    startPolling: loop.startPolling,
    readOnce: loop.readOnce,
    clearError: store.clearError,
    setError: store.setError,
  }
  // 挂载即取一次状态：卡片首帧就有登录态与方法列表。
  // One fetch at mount: the card's first frame already knows sign-in state and methods.
  void loop.readOnce()
  return {
    source: store.source,
    startAuto: ogStartAutoAction(deps),
    togglePaste: ogTogglePasteAction(deps),
    start: ogStartAction(deps),
    attach: ogAttachAction(deps),
    answer: ogAnswerAction(deps),
    cancel: ogCancelAction(deps),
    dismiss: ogDismissAction(deps),
    signOut: ogSignOutAction(deps),
  }
}
