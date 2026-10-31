/**
 * Browser half of the startup-autostart plugin.
 *
 * The panel is a global page, reached from a sidebar entry beside the shipped
 * "Automated tasks" page. The entry plugin mounts the `startup` Remote
 * namespace itself — see `./remote.ts` for why the contribution is hand-built
 * — and an inner panel plugin then injects the freshly mounted namespace,
 * builds one catalog observable over it, and writes through the same endpoints
 * the model's `startup_*` tools use, so the page and the tools always act on
 * one Host-owned record set.
 *
 * 启动自启动插件的浏览器半边。面板是一个全局页面，从侧栏入口进入，与随发行版交付的
 * 「自动化任务」页面并列。入口插件自己挂载 `startup` Remote 命名空间（contribution
 * 为何手工构造见 `./remote.ts`），内层面板插件随后注入刚挂载的命名空间，基于它建立
 * 目录可观察对象，并通过与模型 `startup_*` 工具相同的端点写入，因此页面与工具始终
 * 操作同一份宿主持有的记录集合。
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
import type { StartupCatalog } from './catalog.ts'
import { createStartupChoices } from './choices.ts'
import type { StartupChoices } from './choices.ts'
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

/**
 * Client services of the entry plugin. `remote.startup` must NOT be declared
 * here: this plugin is the namespace's only mounter, so depending on it would
 * make the loader wait for a service that does not exist until apply runs -
 * waiting on itself, pending forever.
 * 入口插件的服务依赖。`remote.startup` 绝不能写在这里：本插件是该命名空间唯一的
 * 挂载者，声明依赖会让 Loader 等待一个 apply 运行前尚不存在的服务——自己等自己，
 * 永远 pending。
 */
export const inject = ['slots', 'locale', 'remote', 'uiWorkspace']

/** Render one Host failure as the panel's status line. */
function reported(error: { readonly code: string; readonly message: string }): string {
  return `${error.code}: ${error.message}`
}

/** 面板动作回调面：更新/删除/运行，全部走 Remote 端点。The panel action callbacks: update, delete, and run, all through Remote endpoints. */
interface PanelActions {
  readonly onUpdate: (request: StartupItemRequest & { readonly id: string }) => Promise<string | undefined>
  readonly onDelete: (id: string) => Promise<string | undefined>
  readonly onRun: (id: string) => Promise<{ readonly ok: boolean; readonly detail: string }>
}

/**
 * 建立目录源：读挂载命名空间的 catalog，跟随宿主变更事件与连接重置。
 * Build the catalog source: read the mounted namespace's catalog, following
 * the Host's change event and connection resets.
 */
function createPanelCatalog(ctx: Context, startup: StartupRemoteApi): StartupCatalog {
  return createStartupCatalog({
    list: () => startup.catalog(),
    // The Host emits this after every committed write and the Web
    // application forwards it, so the list follows the Host without polling.
    // 宿主在每次提交写入后发出该事件，Web 应用会转发，列表因此无需轮询。
    subscribeChanged: listener => ctx.remote.$on('startup-autostart/changed', listener),
    subscribeReset: listener => ctx.on('connection/reset', listener),
  })
}

/**
 * 建立下拉选项源：读宿主自带的预设名册与模型目录，跟随共享失效事件。
 * Build the choices source: read the host's own preset roster and model
 * catalog, following the shared invalidation events.
 */
function createPanelChoices(ctx: Context): StartupChoices {
  return createStartupChoices({
    listPresets: () => ctx.remote.agentPresets.list(),
    listModels: () => ctx.remote.session.modelCatalog(),
    // The detail form's dropdowns read the same Host surfaces the shipped
    // preset picker and model selector use; any of these events may change
    // them, so one shared invalidation re-reads both.
    // 详情表单的下拉读取与自带预设选择器、模型选择器相同的宿主表面；下列任一事件
    // 都可能改变它们，因此用一条共享失效订阅同时重读两者。
    subscribeInvalidate: listener => [
      ctx.on('connection/reset', listener),
      ctx.remote.$on('llm/adapters-updated', listener),
      ctx.remote.$on('settings/document-updated', listener),
    ].reduce((parent, dispose) => () => { dispose(); parent() }, () => {}),
  })
}

/**
 * 建立面板动作回调：每次写都把 Host 失败渲染成状态行文本。
 * Build the panel action callbacks: each write renders a Host failure into
 * status-line text.
 */
function createPanelActions(startup: StartupRemoteApi): PanelActions {
  const onUpdate = async (request: StartupItemRequest & { readonly id: string }): Promise<string | undefined> => {
    const result = await startup.update(request)
    return result.ok ? undefined : reported(result.error)
  }
  const onDelete = async (id: string): Promise<string | undefined> => {
    const result = await startup.delete({ id })
    return result.ok ? undefined : reported(result.error)
  }
  const onRun = async (id: string): Promise<{ readonly ok: boolean; readonly detail: string }> => {
    const result = await startup.run({ id })
    if (!result.ok) return { ok: false, detail: reported(result.error) }
    return { ok: result.value.outcome?.status === 'ok', detail: result.value.outcome?.detail ?? '' }
  }
  return { onUpdate, onDelete, onRun }
}

/**
 * 注册主页面 slot：注入 hooks 面与动作回调。
 * Register the main-page slot: inject the hooks face and the action callbacks.
 */
function registerMainSlot(ctx: Context, catalog: StartupCatalog, choices: StartupChoices, actions: PanelActions): void {
  ctx.slots.inject('main', () => ctx.slots.register({
    name: 'main',
    key: PANEL_ID,
    locale: NS,
    inject: () => ({
      hooks: { catalog: catalog.source, choices: choices.source },
      onRetry: catalog.refresh,
      // The page has no creation form of its own: a new item starts in a
      // session, where the model registers it with `startup_create`.
      // 页面没有自己的创建表单：新启动项在会话里由模型用 `startup_create` 登记。
      onNew: () => { ctx.uiWorkspace.startSession() },
      onUpdate: actions.onUpdate,
      onDelete: actions.onDelete,
      onRun: actions.onRun,
    }),
  }, StartupPanel))
}

/** 注册侧栏入口 slot。Register the sidebar-entry slot. */
function registerSidebarEntry(ctx: Context, label: () => string): void {
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: 10,
    locale: NS,
    label,
  }, StartupPanelIcon))
}

/**
 * The inner panel plugin. It injects the freshly mounted `remote.startup`
 * namespace (inject resolution is registry-based, so the sibling-mounted
 * namespace resolves even though it is not an ancestor of this fiber), then
 * registers the page, its sidebar entry, and copy from its own fiber. Every
 * closure reads the namespace captured here, so slot render fibers - which can
 * never see the namespace through their inject chain - still reach it.
 * 内层面板插件。它注入刚挂载的 `remote.startup` 命名空间（inject 解析走全局注册表，
 * 因此即便命名空间不是本 fiber 的祖先也能解析），然后在自身 fiber 上注册页面、侧栏
 * 入口与文案。所有闭包都读取在这里捕获的命名空间对象，因此经由 inject 链永远看不到
 * 该命名空间的 slot 渲染 fiber 也能触达它。
 */
const PanelPlugin = {
  name: 'startup-autostart:panel',
  // Per-namespace declarations: the property proxy admits exactly the
  // namespaces the fiber names, so plain `remote` is not enough.
  // 按命名空间声明：属性代理只放行 fiber 点名的命名空间，单写 remote 不够。
  inject: ['remote.startup', 'remote.agentPresets', 'remote.session'],
  /** @param ctx - panel-scope context over the mounted namespace. */
  apply(ctx: Context): void {
    // 捕获命名空间对象：本 fiber 的 inject 链里有 remote.startup，读取放行；
    // 渲染 fiber 没有，所以闭包一律用捕获值。
    // Capture the namespace: readable on this fiber (its inject declares
    // remote.startup); render fibers cannot, so closures use the captured one.
    const startup = ctx.remote.startup
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'startup-autostart: dictionaries')
    installPanelStyles(ctx)
    const t = ctx.locale.bind(NS)
    const catalog = createPanelCatalog(ctx, startup)
    const choices = createPanelChoices(ctx)
    const actions = createPanelActions(startup)
    registerMainSlot(ctx, catalog, choices, actions)
    registerSidebarEntry(ctx, () => t('panel'))
  },
} as const

/**
 * Mount the Remote namespace, then start the inner panel plugin that waits on
 * it. Disposal unwinds in reverse: panel first, namespace last.
 * @param ctx - browser services these contributions read.
 * @returns disposer releasing the panel fiber and the mounted namespace.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const unmount = await ctx.remote.$mount(startupRemote)
  const panel = ctx.plugin(PanelPlugin)
  await panel
  return async () => {
    // 逆序清理：先停面板 fiber，再卸载命名空间。
    // Reverse-order cleanup: stop the panel fiber, then unmount the namespace.
    await panel.dispose()
    await unmount()
  }
}
