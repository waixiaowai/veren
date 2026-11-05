/**
 * 浏览器半边：百度网盘面板（全局侧栏入口 + 主面板）。
 *
 * 入口插件手工挂载 `baiduPan` 远端命名空间（contribution 在本包
 * `src/client/remote.ts` 手工构造），内层面板插件注入刚挂载的命名空间，
 * 建立唯一可观察对象并注册页面。卸载逆序：面板先退，命名空间最后。
 *
 * The browser half: the Baidu Netdisk panel (a global sidebar entry plus the
 * main panel).
 *
 * The entry plugin mounts the `baiduPan` Remote namespace by hand (the
 * contribution is hand-built in this package's `src/client/remote.ts`); an
 * inner panel plugin then injects the freshly mounted namespace, builds the
 * one observable, and registers the page. Disposal unwinds in reverse: the
 * panel first, the namespace last.
 *
 * @module @veren/baidu-pan/client
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import { NS, en, zh, type BaiduKey } from './locales.ts'
import { BaiduPanel } from './panel.tsx'
import { baiduPanRemote } from './remote.ts'
import { createBaiduSource } from './source.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Baidu Netdisk page copy. */
    baiduPanUi: BaiduKey
  }
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespaceMap {
    /** 网盘读写与登录态，由本插件的 `apply` 挂载。Netdisk reads/writes and the auth state, mounted by this plugin's `apply`. */
    baiduPan: import('./remote.ts').BaiduPanRemoteApi
  }
}

/** Sidebar and main-panel identity of the page. */
const PANEL_ID = 'baiduPan' as MainPanelId

/**
 * Client services of the entry plugin. `remote.baiduPan` must NOT be declared
 * here: this plugin is the namespace's only mounter, so depending on it would
 * make the loader wait for a service that does not exist until apply runs.
 * 入口插件的服务依赖。`remote.baiduPan` 绝不能写在这里：本插件是该命名空间唯一的
 * 挂载者，声明依赖会让 Loader 等待一个 apply 运行前尚不存在的服务。
 */
export const inject = ['slots', 'locale', 'remote']

/**
 * The inner panel plugin: it injects the freshly mounted namespace, then
 * registers the page and its sidebar entry from its own fiber.
 * 内层面板插件：注入刚挂载的命名空间，然后在自己的 fiber 上注册页面与侧栏入口。
 */
const PanelPlugin = {
  name: 'baiduPan:panel',
  inject: ['remote.baiduPan'],
  /** @param ctx - panel-scope context over the mounted namespace. */
  apply(ctx: Context): void {
    const api = ctx.remote.baiduPan
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'baidu-pan-ui:dictionaries')
    installPanelStyles(ctx)
    const t = ctx.locale.bind(NS)
    const source = createBaiduSource(api)
    registerMainPanel(ctx, t, source)
    ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
      name: 'sidebar.panellist',
      id: PANEL_ID,
      order: 24,
      locale: NS,
      label: () => t('panel'),
    }, BaiduPanelIcon))
  },
} as const

/**
 * Register the main panel over the one source.
 * 在唯一数据源之上注册主面板。
 */
function registerMainPanel(
  ctx: Context,
  t: (key: BaiduKey) => string,
  source: ReturnType<typeof createBaiduSource>,
): void {
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: PANEL_ID,
    locale: NS,
    inject: () => ({
      hooks: { baidu: source.source },
      onRefreshOverview: source.refreshOverview,
      onRefreshJobs: source.refreshJobs,
      onOpenDir: source.openDir,
      onReloadDir: source.reloadDir,
      onRunSearch: source.runSearch,
      onClearSearch: source.clearSearch,
      onBeginSignIn: source.beginSignIn,
      onSubmitSignInCode: source.submitSignInCode,
      onSignOut: source.signOut,
      onCreateDir: source.createDir,
      onRenameEntry: source.renameEntry,
      onTransferEntry: source.transferEntry,
      onRemoveItems: source.removeItems,
      onShareItems: source.shareItems,
      onStartUpload: source.startUpload,
      onStartDownload: source.startDownload,
    }),
  }, BaiduPanel))
}

/**
 * Mount the Remote namespace, then start the inner panel plugin that waits on
 * it. Disposal unwinds in reverse: panel first, namespace last.
 * 挂载远端命名空间，再启动等待它的内层面板插件。卸载逆序：面板先退，命名空间最后。
 * @param ctx - browser services these contributions read.
 * @returns disposer releasing the panel fiber and the mounted namespace.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const unmount = await ctx.remote.$mount(baiduPanRemote)
  const panel = ctx.plugin(PanelPlugin)
  await panel
  return async () => {
    await panel.dispose()
    await unmount()
  }
}

/** The sidebar icon: a cloud with an up arrow (16px, currentColor, no emoji). */
function BaiduPanelIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4.5 12.5A2.75 2.75 0 0 1 4.2 7.02a3.6 3.6 0 0 1 7-.9 2.9 2.9 0 0 1 .3 5.7z"
        stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M8 7.5v4M6.2 9.3 8 7.5l1.8 1.8" stroke="currentColor" strokeWidth="1.2"
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Marker attribute so a re-activation replaces its own sheet rather than stacking. */
const STYLE_MARKER = 'data-baidu-pan-panel'

/** The page stylesheet, inlined by `scripts/bundle.mjs` from `panel.css`. */
declare const __BAIDU_CSS__: string

/**
 * Install the page stylesheet once, replacing any previous activation's copy.
 * @param ctx - the plugin's client context, whose effect owns the element.
 */
function installPanelStyles(ctx: Context): void {
  ctx.effect(() => {
    const style = document.createElement('style')
    style.setAttribute(STYLE_MARKER, '')
    style.textContent = __BAIDU_CSS__
    document.head.append(style)
    return () => { style.remove() }
  }, 'baidu-pan-ui:styles')
}
