/**
 * Browser half of the IM plugin.
 *
 * The page is a global panel reached from a sidebar entry. The entry plugin
 * mounts the `im` Remote namespace by hand (the shipped contributions are
 * generated inside the Harness checkout; this package lives outside it), and an
 * inner panel plugin then injects the freshly mounted namespace, builds one
 * observable over it, and drives the bind wizard's poll loop from that
 * observable's subscribers.
 *
 * IM 插件的浏览器半边。
 *
 * 页面是一个全局面板，从侧栏入口进入。入口插件手工挂载 `im` 远端命名空间（随发行版交付的
 * contribution 在 Harness 检出仓库内生成，本包在其之外），内层面板插件注入刚挂载的命名空间，
 * 基于它建立可观察对象，并从该对象的订阅驱动绑定向导的轮询循环。
 *
 * @module @veren/im-ui/client
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import { NS, en, zh, type ImKey } from './locales.ts'
import { ImPanel } from './panel.tsx'
import { imRemote, type ImPanelInjected, type ImRemoteApi, type ImSnapshot } from './remote.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** IM page copy. */
    im: ImKey
  }
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespaceMap {
    /** IM reading and writing, mounted by this plugin's `apply`. */
    im: ImRemoteApi
  }
}

/** Sidebar and main-panel identity of the page. */
const PANEL_ID = 'im' as MainPanelId

/** How long the open page waits between catalog re-reads, in milliseconds. */
const POLL_MS = 5_000

/** How long the bind wizard waits between bind polls while open. */
const BIND_POLL_MS = 2_000

/**
 * Client services of the entry plugin. `remote.im` must NOT be declared here:
 * this plugin is the namespace's only mounter, so depending on it would make
 * the loader wait for a service that does not exist until apply runs.
 * 入口插件的服务依赖。`remote.im` 绝不能写在这里：本插件是该命名空间唯一的挂载者，
 * 声明依赖会让 Loader 等待一个 apply 运行前尚不存在的服务。
 */
export const inject = ['slots', 'locale', 'remote']

/**
 * The inner panel plugin: it injects the freshly mounted namespace, then
 * registers the page and its sidebar entry from its own fiber.
 */
const PanelPlugin = {
  name: 'im:panel',
  inject: ['remote.im'],
  /** @param ctx - panel-scope context over the mounted namespace. */
  apply(ctx: Context): void {
    const api = ctx.remote.im
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'im-ui:dictionaries')
    installPanelStyles(ctx)
    const t = ctx.locale.bind(NS)
    const im = createImSource(api)
    ctx.slots.inject('main', () => ctx.slots.register({
      name: 'main',
      key: PANEL_ID,
      locale: NS,
      inject: (): ImPanelInjected => ({
        hooks: { im: im.source },
        onStartBind: im.startBind,
        onCloseBind: im.closeBind,
        onSubmitCode: im.submitCode,
        onLink: im.link,
        onUnbindBinding: im.unbindBinding,
        onUnbindAccount: im.unbindAccount,
        onRefresh: im.refresh,
      }),
    }, ImPanel))
    ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
      name: 'sidebar.panellist',
      id: PANEL_ID,
      order: 22,
      locale: NS,
      label: () => t('panel'),
    }, ImPanelIcon))
  },
} as const

/** Build the page's single observable over the Remote namespace. */
function createImSource(api: ImRemoteApi): {
  readonly source: HostObservable<ImSnapshot>
  readonly startBind: () => void
  readonly closeBind: () => void
  readonly submitCode: (code: string) => void
  readonly link: (conversationId: string) => void
  readonly unbindBinding: (bindingId: string) => void
  readonly unbindAccount: (accountId: string) => void
  readonly refresh: () => void
} {
  let snapshot: ImSnapshot = {
    catalog: { accounts: [], bindings: [], conversations: [], intake: emptyIntake() },
    status: 'loading', settled: false, error: '', bind: undefined,
  }
  let epoch = 0
  let catalogTimer: ReturnType<typeof globalThis.setInterval> | undefined
  let bindTimer: ReturnType<typeof globalThis.setInterval> | undefined
  const listeners = new Set<() => void>()
  const publish = (next: Partial<ImSnapshot>): void => {
    snapshot = { ...snapshot, ...next }
    for (const listener of [...listeners]) listener()
  }
  const readCatalog = async (mine: number): Promise<void> => {
    const result = await api.catalog({})
    if (mine !== epoch) return
    if (!result.ok) {
      publish({ status: 'error', error: result.error.message })
      return
    }
    publish({ catalog: result.value, status: 'ready', settled: true, error: '' })
  }
  const load = (): void => {
    const mine = ++epoch
    if (!snapshot.settled) publish({ status: 'loading' })
    void readCatalog(mine)
  }
  const pollBind = async (bindId: string): Promise<void> => {
    const result = await api.pollBind({ bindId })
    if (mine0() !== epoch || snapshot.bind?.bindId !== bindId) return
    if (!result.ok) {
      publish({ bind: { ...snapshot.bind!, status: 'failed', error: result.error } })
      stopBindTimer()
      return
    }
    publish({ bind: result.value })
    if (result.value.status === 'bound' || result.value.status === 'expired' || result.value.status === 'failed') {
      stopBindTimer()
      void readCatalog(epoch)
    }
  }
  const mine0 = (): number => epoch
  const stopBindTimer = (): void => {
    if (bindTimer === undefined) return
    globalThis.clearInterval(bindTimer)
    bindTimer = undefined
  }
  return {
    source: {
      getSnapshot: () => snapshot,
      subscribe(listener) {
        listeners.add(listener)
        if (listeners.size === 1) {
          load()
          catalogTimer = globalThis.setInterval(load, POLL_MS)
        }
        return () => {
          listeners.delete(listener)
          stopBindTimer()
          if (listeners.size !== 0) return
          if (catalogTimer !== undefined) globalThis.clearInterval(catalogTimer)
          catalogTimer = undefined
          epoch += 1
        }
      },
    },
    startBind: () => {
      void (async () => {
        const result = await api.beginBind({ label: 'WeChat' })
        if (!result.ok) {
          publish({ bind: { bindId: '', status: 'failed', error: result.error } })
          return
        }
        publish({ bind: result.value })
        stopBindTimer()
        bindTimer = globalThis.setInterval(() => void pollBind(result.value.bindId), BIND_POLL_MS)
      })()
    },
    closeBind: () => {
      stopBindTimer()
      publish({ bind: undefined })
    },
    submitCode: (code) => {
      const bind = snapshot.bind
      if (bind === undefined) return
      void (async () => {
        const result = await api.submitBindCode({ bindId: bind.bindId, code })
        if (!result.ok) {
          publish({ bind: { ...bind, error: result.error } })
          return
        }
        publish({ bind: result.value })
      })()
    },
    link: (conversationId) => {
      const account = snapshot.catalog.accounts.find(entry => entry.provider === 'wechat') ?? snapshot.catalog.accounts[0]
      if (account === undefined) return
      void api.link({ accountId: account.id, conversationId }).then(load)
    },
    unbindBinding: (bindingId) => {
      void api.unbindBinding({ bindingId }).then(load)
    },
    unbindAccount: (accountId) => {
      void api.unbindAccount({ accountId }).then(() => { stopBindTimer(); load() })
    },
    refresh: () => { load() },
  }
}

/** The intake view shape before the first catalog lands. */
function emptyIntake(): ImSnapshot['catalog']['intake'] {
  return { enabled: false, counts: {}, recent: [] }
}

/**
 * Mount the Remote namespace, then start the inner panel plugin that waits on
 * it. Disposal unwinds in reverse: panel first, namespace last.
 * @param ctx - browser services these contributions read.
 * @returns disposer releasing the panel fiber and the mounted namespace.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const unmount = await ctx.remote.$mount(imRemote)
  const panel = ctx.plugin(PanelPlugin)
  await panel
  return async () => {
    await panel.dispose()
    await unmount()
  }
}

/** The sidebar icon: a speech bubble with two lines. */
function ImPanelIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2 3.5h12v8H8l-3.5 3v-3H2z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M4.5 6.5h7M4.5 9h4.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

/** Marker attribute so a re-activation replaces its own sheet rather than stacking. */
const STYLE_MARKER = 'data-im-panel'

/** The page stylesheet, inlined by `scripts/bundle.mjs` from `panel.css`. */
declare const __IM_CSS__: string

/**
 * Install the page stylesheet once, replacing any previous activation's copy.
 * @param ctx - the plugin's client context, whose effect owns the element.
 */
function installPanelStyles(ctx: Context): void {
  ctx.effect(() => {
    const style = document.createElement('style')
    style.setAttribute(STYLE_MARKER, '')
    style.textContent = __IM_CSS__
    document.head.append(style)
    return () => { style.remove() }
  }, 'im-ui:styles')
}
