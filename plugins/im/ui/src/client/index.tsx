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
 * The observable and its poll loops live in `source.ts`; this file keeps the
 * plugin assembly.
 * 可观察对象与轮询循环在 `source.ts`；本文件保留插件装配。
 *
 * @module @veren/im-ui/client
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import { NS, en, zh, type ImKey } from './locales.ts'
import { ImPanel } from './panel.tsx'
import { imRemote, type ImPanelInjected, type ImRemoteApi } from './remote.ts'
import { createImSource } from './source.ts'

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
        onUnbindAccount: im.unbindAccount,
        onRenamePerson: im.renamePerson,
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
