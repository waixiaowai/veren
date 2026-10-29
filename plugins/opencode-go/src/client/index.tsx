/**
 * 浏览器半边：挂载 `opencodeGo` 远端命名空间，在设置 → 模型 页脚注册
 * 登录卡片，并以单一可观察对象驱动轮询。铁律六：往别人的 slot 注册必须经
 * `ctx.slots.inject`。
 *
 * The browser half: mounts the `opencodeGo` Remote namespace, registers the
 * sign-in card in the Models settings footer, and drives polling from one
 * observable. Iron law six: registering into someone else's slot must go
 * through `ctx.slots.inject`.
 *
 * @module @veren/opencode-go/client
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots/client'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import { NS, en, zh, type OgKey } from './locales.ts'
import { OpencodeGoCard, type OgCardInjected, type OgCardSnapshot } from './card.tsx'
import { opencodeGoRemote, type OgDescribe, type OgPoll, type OgRemoteResult } from './remote.ts'

declare module '@deepseek-ai/dsh-client-locale/client' {
  interface LocaleNamespaceMap {
    /** OpenCode Go sign-in card copy. */
    'opencode-go': OgKey
  }
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespaceMap {
    /** Sign-in gateway, mounted by this plugin's client apply. */
    opencodeGo: {
      describe(): Promise<OgRemoteResult<OgDescribe>>
      begin(request: { readonly method?: string }): Promise<OgRemoteResult<{ readonly status: string }>>
      poll(): Promise<OgRemoteResult<OgPoll>>
      answer(request: { readonly value: string }): Promise<OgRemoteResult<{ readonly answered: boolean }>>
      cancel(): Promise<OgRemoteResult<{ readonly cancelled: boolean }>>
      signOut(): Promise<OgRemoteResult<{ readonly signedOut: boolean }>>
    }
  }
}

/** 进行中卡片的轮询间隔。The poll interval while the card is in flight. */
const POLL_MS = 1_500

/** Marker attribute so a re-activation replaces its own sheet rather than stacking. */
const STYLE_MARKER = 'data-opencode-go-card'

/** The card stylesheet, inlined by `scripts/bundle.mjs` from `card.css`. */
declare const __OG_CSS__: string

/**
 * Client services. `remote.opencodeGo` must NOT be declared here: this plugin
 * is the namespace's only mounter, so depending on it would make the loader
 * wait for a service that does not exist until apply runs.
 * 客户端服务依赖。`remote.opencodeGo` 绝不能写在这里：本插件是该命名空间唯一
 * 的挂载者，声明依赖会让 Loader 等待一个 apply 运行前尚不存在的服务。
 */
export const inject = ['slots', 'locale', 'remote']

/**
 * Mount the Remote namespace, then start the card plugin that waits on it.
 * Disposal unwinds in reverse: card first, namespace last.
 * @param ctx - browser services these contributions read.
 * @returns disposer releasing the card fiber and the mounted namespace.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const unmount = await ctx.remote.$mount(opencodeGoRemote)
  const card = ctx.plugin(CardPlugin)
  return async () => {
    await card.dispose()
    await unmount()
  }
}

/** Install the card stylesheet once, replacing any previous activation's copy. */
function installCardStyles(ctx: Context): void {
  ctx.effect(() => {
    const style = document.createElement('style')
    style.setAttribute(STYLE_MARKER, '')
    style.textContent = __OG_CSS__
    document.head.append(style)
    return () => { style.remove() }
  }, 'opencode-go:styles')
}

/** 组合 describe+poll 的单一可观察状态与动作。Composes describe+poll into one observable state plus actions. */
function createOgSource(api: Context['remote']['opencodeGo']): {
  readonly source: HostObservable<OgCardSnapshot>
  readonly start: (method: string) => void
  readonly attach: () => void
  readonly answer: (value: string) => void
  readonly cancel: () => void
  readonly dismiss: () => void
  readonly signOut: () => void
} {
  let describe: OgDescribe | undefined
  let poll: OgPoll | undefined
  let error = ''
  let errorCode: string | undefined
  // useSyncExternalStore 的 getSnapshot 必须返回稳定引用：状态保持在
  // `current` 里，变更整对象替换后再 notify——每次调用新建对象会触发
  // React #185（Maximum update depth）。
  // useSyncExternalStore's getSnapshot must return a stable reference: state
  // lives in `current` and is replaced whole on change — building a fresh
  // object per call trips React #185 (Maximum update depth).
  let current: OgCardSnapshot = { describe: undefined, poll: undefined, error: '', errorCode: undefined }
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
  const stopPolling = (): void => {
    if (timer === undefined) return
    globalThis.clearInterval(timer)
    timer = undefined
  }
  let timer: ReturnType<typeof globalThis.setInterval> | undefined
  const readOnce = async (): Promise<void> => {
    const [description, state] = await Promise.all([
      api.describe(),
      api.poll(),
    ])
    if (description.ok) describe = description.value
    if (state.ok) {
      poll = state.value
      error = ''
      errorCode = undefined
      if (!state.value.inFlight) stopPolling()
    } else {
      error = state.error.message
      errorCode = state.error.code
      stopPolling()
    }
    commit({ describe, poll, error, errorCode })
  }
  /** 启动轮询循环（begin 成功与重接共用）。Starts the poll loop (shared by begin success and re-attach). */
  const startPolling = async (): Promise<void> => {
    await readOnce()
    stopPolling()
    timer = setInterval(() => { void readOnce() }, POLL_MS)
  }
  // 挂载即取一次状态：卡片首帧就有登录态与方法列表。
  // One fetch at mount: the card's first frame already knows sign-in state and methods.
  void readOnce()
  return {
    source,
    start: (method) => {
      void (async () => {
        // inFlight 时 begin 必被缝拒绝——重接是唯一正解，错误态不可表达。
        // With inFlight the seam refuses begin — re-attach is the only right
        // answer; the error state must not be expressible.
        if (describe?.inFlight === true) {
          error = ''
          errorCode = undefined
          await startPolling()
          return
        }
        error = ''
        errorCode = undefined
        commit({ error, errorCode })
        const started = await api.begin({ method })
        if (!started.ok) {
          error = started.error.message
          errorCode = started.error.code
          commit({ error, errorCode })
          return
        }
        await startPolling()
      })()
    },
    attach: () => {
      error = ''
      errorCode = undefined
      void startPolling()
    },
    answer: (value) => {
      void api.answer({ value }).then((result) => {
        if (!result.ok) {
          error = result.error.message
          errorCode = result.error.code
          commit({ error, errorCode })
        }
      })
    },
    cancel: () => {
      void api.cancel().then((result) => {
        if (!result.ok) error = result.error.message
        void readOnce()
      })
    },
    dismiss: () => {
      poll = poll === undefined ? undefined : { ...poll, settled: undefined }
      commit({ poll })
    },
    signOut: () => {
      void api.signOut().then((result) => {
        if (!result.ok) error = result.error.message
        void readOnce()
      })
    },
  }
}

/** 卡片插件：等命名空间就绪，注册页脚 slot 与双语字典。 */
const CardPlugin = {
  name: 'opencode-go:card',
  inject: ['remote.opencodeGo', 'slots', 'locale'],
  /** @param ctx - card-scope context over the mounted namespace. */
  apply(ctx: Context): void {
    const api = ctx.remote.opencodeGo
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'opencode-go:dictionaries')
    installCardStyles(ctx)
    const og = createOgSource(api)
    const injected = (): OgCardInjected => ({
      hooks: { og: og.source },
      onStart: (method) => og.start(method),
      onAttach: () => og.attach(),
      onAnswer: (value) => og.answer(value),
      onCancel: () => og.cancel(),
      onDismiss: () => og.dismiss(),
      onSignOut: () => og.signOut(),
    })
    ctx.slots.inject('settings.models.footer', () => ctx.slots.register({
      name: 'settings.models.footer',
      key: '@veren/opencode-go',
      id: 'opencode-go',
      order: 50,
      locale: NS,
      inject: injected,
    }, OpencodeGoCard))
  },
} as const
