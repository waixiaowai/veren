/**
 * Browser half of the startup-autostart plugin.
 *
 * The panel is a global page, reached from a sidebar entry beside the shipped
 * "Automated tasks" page. It mounts the `startup` Remote namespace itself —
 * see `./remote.ts` for why the contribution is hand-built — then reads one
 * catalog observable built over that namespace and writes through the same
 * endpoints the model's `startup_*` tools use, so the page and the tools always
 * act on one Host-owned record set.
 *
 * 启动自启动插件的浏览器半边。面板是一个全局页面，从侧栏入口进入，与随发行版交付的
 * 「自动化任务」页面并列。它自己挂载 `startup` Remote 命名空间（contribution 为何手工
 * 构造见 `./remote.ts`），然后基于该命名空间建立一个目录可观察对象，并通过与模型
 * `startup_*` 工具相同的端点写入，因此页面与工具始终操作同一份宿主持有的记录集合。
 *
 * @module @veren/startup-autostart/client
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import { createStartupCatalog } from './catalog.ts'
import { StartupPanelIcon } from './icon.tsx'
import { en, NS, zh, type StartupPanelKey } from './locales.ts'
import { StartupPanel } from './panel.tsx'
import { startupRemote, type StartupItemRequest, type StartupRemoteApi } from './remote.ts'
import { installPanelStyles } from './styles.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Startup panel copy. */
    'startup.panel': StartupPanelKey
  }
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespaceMap {
    /** Startup-item management, mounted by this plugin's `apply`. */
    startup: StartupRemoteApi
  }
}

/** Sidebar and main-panel identity of the page. */
const PANEL_ID = 'startup' as MainPanelId

/** Client services this plugin uses; `remote.startup` is mounted by `apply`. */
// cordis 的 reflect 门禁：访问 ctx.remote.startup 必须显式声明 `remote.startup`，
// 只声明 `remote` 会在运行期抛 "cannot get property remote.startup without inject"。
// cordis's reflect gate: reading ctx.remote.startup requires declaring
// `remote.startup`; declaring `remote` alone throws "without inject" at runtime.
export const inject = ['slots', 'locale', 'remote', 'remote.startup', 'uiWorkspace']

/** Render one Host failure as the panel's status line. */
function reported(error: { readonly code: string; readonly message: string }): string {
  return `${error.code}: ${error.message}`
}

/**
 * Mount the Remote namespace, register the page, its sidebar entry, and copy.
 * @param ctx - browser services these contributions read.
 * @returns disposer releasing the mounted namespace.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const unmount = await ctx.remote.$mount(startupRemote)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'startup-autostart: dictionaries')
  installPanelStyles(ctx)
  const t = ctx.locale.bind(NS)
  const catalog = createStartupCatalog({
    list: () => ctx.remote.startup.catalog(),
    // The Host emits this after every committed write and the Web application
    // forwards it, so the list follows the Host without polling.
    subscribeChanged: listener => ctx.remote.$on('startup-autostart/changed', listener),
    subscribeReset: listener => ctx.on('connection/reset', listener),
  })
  const onUpdate = async (request: StartupItemRequest & { readonly id: string }): Promise<string | undefined> => {
    const result = await ctx.remote.startup.update(request)
    return result.ok ? undefined : reported(result.error)
  }
  const onDelete = async (id: string): Promise<string | undefined> => {
    const result = await ctx.remote.startup.delete({ id })
    return result.ok ? undefined : reported(result.error)
  }
  const onRun = async (id: string): Promise<{ readonly ok: boolean; readonly detail: string }> => {
    const result = await ctx.remote.startup.run({ id })
    if (!result.ok) return { ok: false, detail: reported(result.error) }
    return { ok: result.value.outcome?.status === 'ok', detail: result.value.outcome?.detail ?? '' }
  }
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: PANEL_ID,
    locale: NS,
    inject: () => ({
      hooks: { catalog: catalog.source },
      onRetry: catalog.refresh,
      // The page has no creation form of its own: a new item starts in a
      // session, where the model registers it with `startup_create`.
      onNew: () => { ctx.uiWorkspace.startSession() },
      onUpdate,
      onDelete,
      onRun,
    }),
  }, StartupPanel))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: 10,
    locale: NS,
    label: () => t('panel'),
  }, StartupPanelIcon))
  return async () => { await unmount() }
}
