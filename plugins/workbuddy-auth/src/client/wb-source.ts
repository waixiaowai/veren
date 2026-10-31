/**
 * 卡片状态源：describe+poll 合成一个可观察快照，外加 begin/cancel 等动作面。
 * 职责单一：只管状态机（轮询节拍、武装自动打开、动作分发），不管挂载与样式。
 * The card's state source: describe+poll composed into one observable snapshot
 * plus the action face (begin/cancel/…). Single responsibility: only the state
 * machine (poll cadence, the armed auto-open, action dispatch) — never
 * mounting or styles.
 *
 * @module @veren/workbuddy-auth/client/wb-source
 */
import type { Context } from '@deepseek-ai/cordis'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { WbCardSnapshot } from './card.tsx'
import type { WbDescribe, WbPoll } from './remote.ts'

/** 进行中卡片的轮询间隔。The poll interval while the card is in flight. */
const POLL_MS = 1_500

/** createWbSource 的可变内核：原闭包共享态显式收拢成一处。The mutable core of createWbSource: the closure-shared state gathered explicitly in one place. */
interface WbSourceState {
  describe: WbDescribe | undefined
  poll: WbPoll | undefined
  error: string
  errorCode: string | undefined
  timer: ReturnType<typeof globalThis.setInterval> | undefined
  // 自动打开只认**本页发起的**登录：begin 成功即武装，开过或尝试结束即解除。
  // 页面刷新后未武装——宿主缓冲的旧授权 URL 绝不会把用户带离应用（真机教训）。
  // Auto-open only arms for a sign-in THIS page started: armed at begin success,
  // disarmed after opening or when the attempt ends. A refreshed page is never
  // armed, so the host's buffered URL can never drag the user away (a
  // live-taught lesson).
  armed: boolean
  openedNoticeUrl: string | undefined
  current: WbCardSnapshot
}

/**
 * 可观察外壳：getSnapshot 必须返回稳定引用——状态保持在 current 里，变更整
 * 对象替换后再逐个通知（React #185）。
 * The observable shell: getSnapshot must return a stable reference — state
 * lives in `current`, replaced whole on change, then listeners notified
 * (React #185).
 */
function createObservableState(): {
  readonly state: WbSourceState
  readonly source: HostObservable<WbCardSnapshot>
  readonly commit: (next: Partial<WbCardSnapshot>) => void
} {
  const listeners = new Set<() => void>()
  const state: WbSourceState = {
    describe: undefined,
    poll: undefined,
    error: '',
    errorCode: undefined,
    timer: undefined,
    armed: false,
    openedNoticeUrl: undefined,
    current: { describe: undefined, poll: undefined, error: '', errorCode: undefined, credits: {}, probe: {} },
  }
  const source: HostObservable<WbCardSnapshot> = {
    getSnapshot: () => state.current,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
  const commit = (next: Partial<WbCardSnapshot>): void => {
    state.current = { ...state.current, ...next }
    for (const listener of [...listeners]) listener()
  }
  return { state, source, commit }
}

/** 停掉进行中的轮询定时器。Stops the running poll timer. */
function stopWbPolling(state: WbSourceState): void {
  if (state.timer === undefined) return
  globalThis.clearInterval(state.timer)
  state.timer = undefined
}

/**
 * 授权流一交出 URL 就跳系统浏览器/新标签（用户不该手动复制粘贴）；仅在
 * 武装窗口内开一次。IAB/桌面壳的 window.open 都落在系统浏览器面。
 * Jump to the system browser / a new tab as soon as the flow hands out the
 * URL (copy-paste is not the user's job); opens once per armed window only.
 */
function openAuthorizationUrl(state: WbSourceState): void {
  if (!state.armed) return
  const url = state.poll?.notices.find(notice => notice.url !== undefined)?.url
  if (url === undefined) return
  state.armed = false
  state.openedNoticeUrl = url
  window.open(url, '_blank', 'noopener')
}

/** 尝试结束（终局/失败/取消）即解除武装。Disarms when the attempt settles. */
function disarmIfSettled(state: WbSourceState): void {
  if (state.poll?.inFlight === false && (state.poll?.settled !== undefined || state.poll?.failed !== undefined)) state.armed = false
}

/** 轮询一拍：并取 describe+poll、写回快照，随后处理武装解除与自动打开。One poll tick: describe+poll together, write the snapshot back, then disarm/auto-open handling. */
async function wbReadOnce(api: Context['remote']['workbuddyAuth'], state: WbSourceState, commit: (next: Partial<WbCardSnapshot>) => void): Promise<void> {
  try {
    const [description, pollState] = await Promise.all([api.describe(), api.poll()])
    if (description.ok) state.describe = description.value
    if (pollState.ok) {
      state.poll = pollState.value
      state.error = ''
      state.errorCode = undefined
      if (!pollState.value.inFlight) stopWbPolling(state)
    } else {
      state.error = pollState.error.message
      state.errorCode = pollState.error.code
      stopWbPolling(state)
    }
    commit({ describe: state.describe, poll: state.poll, error: state.error, errorCode: state.errorCode })
    disarmIfSettled(state)
    openAuthorizationUrl(state)
  } catch {
    // 传输层失败（节点重启窗口等）：人话 + 重试，不与授权错误混淆。
    // A transport failure: human copy + retry, never conflated with auth errors.
    state.errorCode = 'TRANSPORT'
    stopWbPolling(state)
    commit({ errorCode: state.errorCode })
  }
}

/** 启轮询：先立即读一拍，再起固定节拍。Starts polling: one immediate read, then the fixed cadence. */
async function startWbPolling(api: Context['remote']['workbuddyAuth'], state: WbSourceState, commit: (next: Partial<WbCardSnapshot>) => void): Promise<void> {
  await wbReadOnce(api, state, commit)
  stopWbPolling(state)
  state.timer = setInterval(() => { void wbReadOnce(api, state, commit) }, POLL_MS)
}

/** begin 一步：inFlight 时重接（此时缝必拒 begin），否则 begin 成功后武装自动打开并起轮询。The begin step: re-attach when inFlight (the seam refuses begin then), else begin, arm auto-open and start polling. */
async function wbBegin(api: Context['remote']['workbuddyAuth'], state: WbSourceState, commit: (next: Partial<WbCardSnapshot>) => void, method: string): Promise<void> {
  if (state.describe?.inFlight === true) {
    // inFlight 时 begin 必被缝拒绝——重接是唯一正解，错误态不可表达。
    // With inFlight the seam refuses begin — re-attach is the only answer.
    await startWbPolling(api, state, commit)
    return
  }
  const started = await api.begin({ method })
  if (!started.ok) {
    state.error = started.error.message
    state.errorCode = started.error.code
    commit({ error: state.error, errorCode: state.errorCode })
    return
  }
  // 本页发起的登录：武装自动打开（开过或终局即解除）。
  // A sign-in this page started: arm auto-open (disarmed after opening or settlement).
  state.armed = true
  state.openedNoticeUrl = undefined
  await startWbPolling(api, state, commit)
}

/** 流程动作面：start/attach/cancel/dismiss（轮询与武装窗口归它管）。The flow actions: start/attach/cancel/dismiss (polling and the armed window are its business). */
function createWbFlowActions(api: Context['remote']['workbuddyAuth'], state: WbSourceState, commit: (next: Partial<WbCardSnapshot>) => void): {
  readonly start: (method: string) => void
  readonly attach: () => void
  readonly cancel: () => void
  readonly dismiss: () => void
} {
  return {
    start: (method) => { void wbBegin(api, state, commit, method) },
    attach: () => { void startWbPolling(api, state, commit) },
    cancel: () => {
      void api.cancel().then((result) => {
        if (!result.ok) state.error = result.error.message
        void wbReadOnce(api, state, commit)
      })
    },
    dismiss: () => {
      state.poll = state.poll === undefined ? undefined : { ...state.poll, settled: undefined }
      commit({ poll: state.poll })
    },
  }
}

/** 账号动作面：signOut/toggle/credits/probe；失败都写回错误并重读一拍。The account actions: signOut/toggle/credits/probe; failures write the error back and re-read a tick. */
function createWbAccountActions(api: Context['remote']['workbuddyAuth'], state: WbSourceState, commit: (next: Partial<WbCardSnapshot>) => void): {
  readonly signOut: (uid: string) => void
  readonly toggle: (uid: string, disabled: boolean) => void
  readonly credits: (uid: string) => void
  readonly probe: (uid: string, model: string) => void
} {
  return {
    signOut: (uid) => {
      void api.signOut({ uid }).then((result) => {
        if (!result.ok) state.error = result.error.message
        void wbReadOnce(api, state, commit)
      })
    },
    toggle: (uid, disabled) => {
      void api.toggle({ uid, disabled }).then((result) => {
        if (!result.ok) state.error = result.error.message
        void wbReadOnce(api, state, commit)
      })
    },
    credits: (uid) => {
      commit({ credits: { ...state.current.credits, [uid]: 'pending' } })
      void api.credits({ uid }).then((result) => {
        if (result.ok) commit({ credits: { ...state.current.credits, [uid]: result.value } })
        else commit({ credits: { ...state.current.credits, [uid]: 'error' } })
      })
    },
    probe: (uid, model) => {
      commit({ probe: { ...state.current.probe, [uid]: 'running' } })
      void api.probe({ uid, model }).then((result) => {
        if (result.ok) commit({ probe: { ...state.current.probe, [uid]: result.value } })
        else commit({ probe: { ...state.current.probe, [uid]: { validation: 'unknown', efforts: [], requests: 0, reason: result.error.message } } })
      })
    },
  }
}

/** 组合 describe+poll+动作的单一可观察状态源（可观察不变式见 createObservableState）。Composes describe+poll+actions into one observable state source (the observable invariant lives in createObservableState). */
export function createWbSource(api: Context['remote']['workbuddyAuth']): {
  readonly source: HostObservable<WbCardSnapshot>
  readonly start: (method: string) => void
  readonly attach: () => void
  readonly cancel: () => void
  readonly dismiss: () => void
  readonly signOut: (uid: string) => void
  readonly toggle: (uid: string, disabled: boolean) => void
  readonly credits: (uid: string) => void
  readonly probe: (uid: string, model: string) => void
} {
  const { state, source, commit } = createObservableState()
  void wbReadOnce(api, state, commit)
  const flow = createWbFlowActions(api, state, commit)
  const account = createWbAccountActions(api, state, commit)
  return {
    source,
    start: flow.start,
    attach: flow.attach,
    cancel: flow.cancel,
    dismiss: flow.dismiss,
    signOut: account.signOut,
    toggle: account.toggle,
    credits: account.credits,
    probe: account.probe,
  }
}
