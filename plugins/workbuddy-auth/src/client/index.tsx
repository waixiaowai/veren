/**
 * 浏览器半边：挂载 `workbuddyAuth` 远端命名空间，在设置 → 模型 页脚注册
 * 登录/账号卡片。铁律六：往别人的 slot 注册必须经 `ctx.slots.inject`；
 * `remote.workbuddyAuth` 绝不能出现在 inject 里（本插件是该命名空间唯一
 * 挂载者，声明依赖会让 loader 等一个 apply 前不存在的服务）。
 * The browser half: mounts the `workbuddyAuth` Remote namespace and registers
 * the sign-in/account card in the Models settings footer. Iron law six:
 * registering into someone else's slot goes through `ctx.slots.inject`;
 * `remote.workbuddyAuth` must NOT appear in inject (this plugin is the
 * namespace's only mounter — declaring it would stall the loader on a service
 * that does not exist until apply runs).
 *
 * @module @veren/workbuddy-auth/client
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots/client'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import { NS, en, zh, type WbKey } from './locales.ts'
import { WorkbuddyCard, type WbCardInjected, type WbCardSnapshot } from './card.tsx'
import { workbuddyAuthRemote, type WbCredits, type WbDescribe, type WbPoll, type WbProbeOutcome } from './remote.ts'

declare module '@deepseek-ai/dsh-client-locale/client' {
  interface LocaleNamespaceMap {
    /** WorkBuddy sign-in card copy. */
    'workbuddy-auth': WbKey
  }
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespaceMap {
    /** Sign-in gateway, mounted by this plugin's client apply. */
    workbuddyAuth: {
      describe(): Promise<{ ok: true; value: WbDescribe } | { ok: false; error: { message: string; code?: string } }>
      begin(request: { readonly method?: string }): Promise<{ ok: true; value: { started: boolean; reason?: string } } | { ok: false; error: { message: string; code?: string } }>
      poll(): Promise<{ ok: true; value: WbPoll } | { ok: false; error: { message: string; code?: string } }>
      cancel(): Promise<{ ok: true; value: { cancelled: boolean } } | { ok: false; error: { message: string; code?: string } }>
      signOut(request: { readonly uid: string }): Promise<{ ok: true; value: { signedOut: boolean } } | { ok: false; error: { message: string; code?: string } }>
      toggle(request: { readonly uid: string; readonly disabled: boolean }): Promise<{ ok: true; value: { disabled: boolean } } | { ok: false; error: { message: string; code?: string } }>
      credits(request: { readonly uid: string }): Promise<{ ok: true; value: WbCredits } | { ok: false; error: { message: string; code?: string } }>
      probe(request: { readonly uid: string; readonly model: string }): Promise<{ ok: true; value: WbProbeOutcome } | { ok: false; error: { message: string; code?: string } }>
    }
  }
}

/** 进行中卡片的轮询间隔。The poll interval while the card is in flight. */
const POLL_MS = 1_500

/** Marker attribute so a re-activation replaces its own sheet rather than stacking. */
const STYLE_MARKER = 'data-workbuddy-auth-card'

/** The card stylesheet, inlined by `scripts/bundle.mjs` from `card.css`. */
declare const __WB_CSS__: string

/** 客户端服务依赖（`remote.workbuddyAuth` 刻意缺席，见文件头）。 */
/** Client service deps (`remote.workbuddyAuth` deliberately absent — see the header). */
export const inject = ['slots', 'locale', 'remote']

/** 挂载命名空间，再起等它的卡片插件；卸载逆序：先卡片后命名空间。 */
/** Mounts the namespace, then starts the card plugin that waits on it; disposal unwinds card first, namespace last. */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const unmount = await ctx.remote.$mount(workbuddyAuthRemote)
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
    style.textContent = __WB_CSS__
    document.head.append(style)
    return () => { style.remove() }
  }, 'workbuddy-auth:styles')
}

/**
 * 组合 describe+poll+动作的单一可观察状态。getSnapshot 必须返回稳定引用：
 * 状态保持在 current 里，变更整对象替换后再 notify（React #185）。
 * Composes describe+poll+actions into one observable. getSnapshot must return
 * a stable reference: state lives in `current`, replaced whole on change
 * (React #185).
 */
function createWbSource(api: Context['remote']['workbuddyAuth']): {
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
  let describe: WbDescribe | undefined
  let poll: WbPoll | undefined
  let error = ''
  let errorCode: string | undefined
  let timer: ReturnType<typeof globalThis.setInterval> | undefined
  let current: WbCardSnapshot = { describe: undefined, poll: undefined, error: '', errorCode: undefined, credits: {}, probe: {} }
  const listeners = new Set<() => void>()
  const source: HostObservable<WbCardSnapshot> = {
    getSnapshot: () => current,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
  const commit = (next: Partial<WbCardSnapshot>): void => {
    current = { ...current, ...next }
    for (const listener of [...listeners]) listener()
  }
  const stopPolling = (): void => {
    if (timer === undefined) return
    globalThis.clearInterval(timer)
    timer = undefined
  }
  const readOnce = async (): Promise<void> => {
    try {
      const [description, state] = await Promise.all([api.describe(), api.poll()])
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
    } catch {
      // 传输层失败（节点重启窗口等）：人话 + 重试，不与授权错误混淆。
      // A transport failure: human copy + retry, never conflated with auth errors.
      errorCode = 'TRANSPORT'
      stopPolling()
      commit({ errorCode })
    }
  }
  const startPolling = async (): Promise<void> => {
    await readOnce()
    stopPolling()
    timer = setInterval(() => { void readOnce() }, POLL_MS)
  }
  void readOnce()
  return {
    source,
    start: (method) => {
      void (async () => {
        if (describe?.inFlight === true) {
          // inFlight 时 begin 必被缝拒绝——重接是唯一正解，错误态不可表达。
          // With inFlight the seam refuses begin — re-attach is the only answer.
          await startPolling()
          return
        }
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
    attach: () => { void startPolling() },
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
    signOut: (uid) => {
      void api.signOut({ uid }).then((result) => {
        if (!result.ok) error = result.error.message
        void readOnce()
      })
    },
    toggle: (uid, disabled) => {
      void api.toggle({ uid, disabled }).then((result) => {
        if (!result.ok) error = result.error.message
        void readOnce()
      })
    },
    credits: (uid) => {
      commit({ credits: { ...current.credits, [uid]: 'pending' } })
      void api.credits({ uid }).then((result) => {
        if (result.ok) commit({ credits: { ...current.credits, [uid]: result.value } })
        else commit({ credits: { ...current.credits, [uid]: 'error' } })
      })
    },
    probe: (uid, model) => {
      commit({ probe: { ...current.probe, [uid]: 'running' } })
      void api.probe({ uid, model }).then((result) => {
        if (result.ok) commit({ probe: { ...current.probe, [uid]: result.value } })
        else commit({ probe: { ...current.probe, [uid]: { validation: 'unknown', efforts: [], requests: 0, reason: result.error.message } } })
      })
    },
  }
}

/** 卡片插件：等命名空间就绪，注册页脚 slot 与双语字典。 */
/** The card plugin: waits on the namespace, registers the footer slot and the bilingual dictionary. */
const CardPlugin = {
  name: 'workbuddy-auth:card',
  inject: ['remote.workbuddyAuth', 'slots', 'locale'],
  apply(ctx: Context): void {
    const api = ctx.remote.workbuddyAuth
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'workbuddy-auth:dictionaries')
    installCardStyles(ctx)
    const wb = createWbSource(api)
    const injected = (): WbCardInjected => ({
      hooks: { wb: wb.source },
      onStart: (method) => wb.start(method),
      onAttach: () => wb.attach(),
      onCancel: () => wb.cancel(),
      onDismiss: () => wb.dismiss(),
      onSignOut: (uid) => wb.signOut(uid),
      onToggle: (uid, disabled) => wb.toggle(uid, disabled),
      onCredits: (uid) => wb.credits(uid),
      onProbe: (uid, model) => wb.probe(uid, model),
    })
    ctx.slots.inject('settings.models.footer', () => ctx.slots.register({
      name: 'settings.models.footer',
      key: '@veren/workbuddy-auth',
      id: 'workbuddy-auth',
      order: 51,
      locale: NS,
      inject: injected,
    }, WorkbuddyCard))
  },
} as const
