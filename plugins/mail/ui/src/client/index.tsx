/**
 * Browser half of the mail plugin.
 *
 * The page is a global panel reached from a sidebar entry. The entry plugin
 * mounts the `mail` Remote namespace by hand (the shipped contributions are
 * generated inside the Harness checkout; this package lives outside it), and
 * an inner panel plugin then injects the freshly mounted namespace, builds one
 * observable over it, and drives the panel's actions from it.
 *
 * 邮件插件的浏览器半边。
 *
 * 页面是一个全局面板，从侧栏入口进入。入口插件手工挂载 `mail` 远端命名空间（随发行版交付的
 * contribution 在 Harness 检出仓库内生成；本包在其之外），内层面板插件注入刚挂载的命名空间，
 * 基于它建立唯一可观察对象，并从该对象驱动面板的动作。
 *
 * The observable and its poll loop live in `source.ts`; this file keeps the
 * plugin assembly.
 *
 * 可观察对象与轮询循环在 `source.ts`；本文件保留插件装配。
 *
 * @module @veren/mail-ui/client
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import { NS, en, zh, type MailKey } from './locales.ts'
import { MailPanel } from './panel.tsx'
import { mailRemote, type MailPanelInjected, type MailRemoteApi } from './remote.ts'
import { createMailSource } from './source.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Mail page copy. */
    'mail-ui': MailKey
  }
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespaceMap {
    /** Mail reading and writing, mounted by this plugin's `apply`. */
    mail: MailRemoteApi
  }
}

/** Sidebar and main-panel identity of the page. */
const PANEL_ID = 'mail' as MainPanelId

/**
 * Client services of the entry plugin. `remote.mail` must NOT be declared
 * here: this plugin is the namespace's only mounter, so depending on it would
 * make the loader wait for a service that does not exist until apply runs.
 *
 * 入口插件的服务依赖。`remote.mail` 绝不能写在这里：本插件是该命名空间唯一的挂载者，
 * 声明依赖会让 Loader 等待一个 apply 运行前尚不存在的服务。
 */
export const inject = ['slots', 'locale', 'remote']

/**
 * The inner panel plugin: it injects the freshly mounted namespace, then
 * registers the page and its sidebar entry from its own fiber.
 */
const PanelPlugin = {
  name: 'mail:panel',
  inject: ['remote.mail'],
  /**
   * @param ctx - panel-scope context over the mounted namespace / 挂载命名空间上的面板作用域上下文
   */
  apply(ctx: Context): void {
    const api = ctx.remote.mail
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'mail-ui:dictionaries')
    installPanelStyles(ctx)
    const t = ctx.locale.bind(NS)
    const mail = createMailSource(api)
    // 连接代际重置（重连成功）即重读目录：面板的轮询只兜底 5 秒，重置信号让恢复即时发生。
    // A connection-generation reset (a successful reconnect) re-reads the
    // catalog: polling alone would leave up to a 5s stale window, the reset
    // signal makes the recovery immediate.
    ctx.on('connection/reset', () => { mail.refresh() })
    ctx.slots.inject('main', () => ctx.slots.register({
      name: 'main',
      key: PANEL_ID,
      locale: NS,
      inject: (): MailPanelInjected => ({
        hooks: { mail: mail.source },
        onRefresh: mail.refresh,
        onMark: mail.mark,
      }),
    }, MailPanel))
    ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
      name: 'sidebar.panellist',
      id: PANEL_ID,
      order: 24,
      locale: NS,
      label: () => t('panel'),
    }, MailPanelIcon))
  },
} as const

/**
 * Mount the Remote namespace, then start the inner panel plugin that waits on
 * it. Disposal unwinds in reverse: panel first, namespace last.
 *
 * @param ctx - browser services these contributions read / 这些 contribution 读取的浏览器服务
 * @returns disposer releasing the panel fiber and the mounted namespace / 释放面板 fiber 与已挂载命名空间的 disposer
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const unmount = await ctx.remote.$mount(mailRemote)
  const panel = ctx.plugin(PanelPlugin)
  await panel
  return async () => {
    await panel.dispose()
    await unmount()
  }
}

/** The sidebar icon: an envelope. */
function MailPanelIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2" y="3.5" width="12" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M2.5 4.5 8 8.5l5.5-4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

/** Marker attribute so a re-activation replaces its own sheet rather than stacking. */
const STYLE_MARKER = 'data-mail-panel'

/** The page stylesheet, inlined by `scripts/bundle.mjs` from `panel.css`. */
declare const __MAIL_CSS__: string

/**
 * Install the page stylesheet once, replacing any previous activation's copy.
 *
 * @param ctx - the plugin's client context, whose effect owns the element / 本插件的客户端上下文，其 effect 拥有该元素
 */
function installPanelStyles(ctx: Context): void {
  ctx.effect(() => {
    const style = document.createElement('style')
    style.setAttribute(STYLE_MARKER, '')
    style.textContent = __MAIL_CSS__
    document.head.append(style)
    return () => { style.remove() }
  }, 'mail-ui:styles')
}
