/**
 * Browser half of the application toolbar plugin.
 *
 * One dropdown lives beside the input toolbar (`conversation.input.left`). It
 * reads the installed-app catalog through the `appHost` Remote namespace the
 * host assembly exposes, and selecting an app opens its entry page: the host
 * creates the page session (agent active, tools mounted, instance title
 * committed), the `app-host/focus` event arrives through the Remote carrier,
 * and this plugin performs the actual GUI switch with
 * `ctx.uiWorkspace.openSession` — that is the focus port's real implementation.
 *
 * 应用工具栏插件的浏览器半边。一个下拉住在输入工具栏旁（`conversation.input.left`）。
 * 它经宿主装配暴露的 `appHost` 远程命名空间读已装应用目录；选中某个应用即打开其
 * 入口页：宿主创建页面会话（agent 激活、工具挂载、实例标题落盘），`app-host/focus`
 * 事件经 Remote 载体到达，本插件用 `ctx.uiWorkspace.openSession` 执行真正的界面
 * 切换——这就是 focus 端口的真实实现。
 * @module @veren/app-host-ui/client
 */

import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { createAppCatalog } from './catalog.ts'
import { en, NS, zh, type AppPickerKey } from './locales.ts'
import { openAppPage } from './open.ts'
import { AppPicker } from './picker.tsx'
import { appHostRemote, type AppEntryView, type AppHostResult, type AppOpenView } from './remote.ts'
import { installPickerStyles } from './styles.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Application toolbar dropdown copy. */
    'app-host-ui': AppPickerKey
  }
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespaceMap {
    /** App catalog + entry-page open, mounted by this plugin's `apply`. */
    appHost: import('./remote.ts').AppHostRemoteApi
  }
}

/** Input-toolbar slot and component identity of the dropdown. */
const PICKER_ID = 'app-picker'

/**
 * Client services of the toolbar plugin. `remote.appHost` must NOT be declared
 * here: this plugin is the namespace's only mounter, so depending on it would
 * make the loader wait for a service that does not exist until apply runs —
 * waiting on itself, pending forever.
 * 工具栏插件的客户端服务依赖。`remote.appHost` 绝不能写在这里：本插件是该命名
 * 空间唯一的挂载者，声明依赖会让 Loader 等待一个 apply 运行前尚不存在的服务——
 * 自己等自己，永远 pending。
 */
export const inject = ['slots', 'locale', 'remote', 'uiWorkspace']

/**
 * The inner panel plugin: registers the dropdown into the input toolbar and
 * follows the host's focus events. Every closure reads the namespace captured
 * here, so slot render fibers — which can never see it through their inject
 * chain — still reach it.
 * 内层面板插件：把下拉注册进输入工具栏，并跟随宿主的 focus 事件。所有闭包都
 * 读取在这里捕获的命名空间对象，因此经由 inject 链永远看不到它的 slot 渲染
 * fiber 也能触达它。
 */
const PickerPlugin = {
  name: 'app-host-ui:picker',
  // Per-namespace declarations: the property proxy admits exactly the
  // namespaces the fiber names, so plain `remote` is not enough.
  // 按命名空间声明：属性代理只放行 fiber 点名的命名空间，单写 remote 不够。
  inject: ['remote.appHost', 'slots', 'locale', 'uiWorkspace'],
  /** @param ctx - panel-scope context over the mounted namespace. */
  apply(ctx: Context): void {
    const appHost = ctx.remote.appHost
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'app-host-ui: dictionaries')
    installPickerStyles(ctx)
    const catalog = createAppCatalog(appHost, (listener) => ctx.on('connection/reset', listener))
    ctx.effect(() => catalog.dispose(), 'app-host-ui: catalog invalidation listener')
    const onOpen = async (appId: string): Promise<string | undefined> => {
      // 运行期信封在 direct 调用上有两种历史形态（包裹/裸值）：在这里一次性
      // 收窄成 AppHostResult，后续代码只看一种形状（跨边界收窄，非类型逃逸）。
      // The runtime envelope of a direct call has two historical shapes
      // (wrapped / bare value): narrow once here to AppHostResult so the code
      // below sees one shape (a boundary narrowing, not a type escape).
      //
      // 调用必须占满声明参数（见 open.ts）：短调用会被客户端网关按 arity 拒绝，
      // 表现就是"选中应用没反应"。
      // The call must supply every declared parameter (see open.ts): a short
      // call is rejected by the client gateway on arity, which surfaced as
      // "picking an app does nothing".
      const raw: unknown = await openAppPage(appHost, appId)
      const result = (typeof raw === 'object' && raw !== null && 'ok' in raw)
        ? raw as AppHostResult<AppOpenView>
        : { ok: true as const, value: raw as AppOpenView }
      // 失败说人话：Remote 信封把网关抛的稳定 code 翻成 {ok:false,error}。
      // Failures speak: the Remote envelope turns the gateway's stable code
      // into {ok:false,error}.
      if (!result.ok) return `${result.error.code}: ${result.error.message}`
      // focus 的执行半边就在这里：宿主建好页面会话（agent 已激活、工具已挂、
      // 标题已落盘），客户端直接切换过去——宿主侧的 app-host/focus 事件发给
      // 之后经模型 app_open 打开时的跟随路径，同一处理在下方 $on 监听里。
      // This is the executing half of focus: the host has built the page
      // session (agent active, tools mounted, title committed) and the client
      // switches straight to it. The host's app-host/focus event covers the
      // follow path when the model opens a page via app_open — same handling
      // in the $on listener below.
      ctx.uiWorkspace.openSession(result.value.sessionId as SessionId)
      return undefined
    }
    ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
      name: 'conversation.input.left',
      id: PICKER_ID,
      order: 20,
      locale: NS,
      inject: () => ({
        hooks: { catalog: { getSnapshot: catalog.getSnapshot, subscribe: catalog.subscribe } },
        onOpen,
        onRetry: catalog.refresh,
        // 当前会话所属应用（页面会话）：工具栏据此显示"已选应用"并锁定下拉。
        // 读失败返回 null → 组件退回下拉，显示能力不阻塞输入栏。
        // The app owning the current session (a page session): the toolbar shows
        // and locks "selected app". A failed read returns null → the component
        // keeps the dropdown; the display never blocks the input bar.
        resolveApp: async (sessionId: string): Promise<AppEntryView | null> => {
          const raw: unknown = await appHost.sessionApp(sessionId)
          const result = (typeof raw === 'object' && raw !== null && 'ok' in raw)
            ? raw as AppHostResult<AppEntryView | null>
            : { ok: true as const, value: raw as AppEntryView | null }
          return result.ok ? result.value : null
        },
      }),
    }, AppPicker))
    // focus 端口的 GUI 半边：宿主发「切到某会话」，这里执行真正的界面切换。
    // The GUI half of the focus port: the host says "switch to this session",
    // this listener performs the actual switch.
    ctx.remote.$on('app-host/focus', (payload) => {
      // 跨边界 id 在此一次性收窄为 brand / one brand narrowing at this boundary
      ctx.uiWorkspace.openSession(payload.sessionId as SessionId)
    })
  },
} as const

/**
 * Mount the Remote namespace, then start the inner panel plugin that waits on
 * it. Disposal unwinds in reverse: panel first, namespace last.
 * @param ctx - browser services this contribution reads.
 * @returns disposer releasing the panel fiber and the mounted namespace.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const unmount = await ctx.remote.$mount(appHostRemote)
  const picker = ctx.plugin(PickerPlugin)
  await picker
  return async () => {
    // 逆序清理：先停面板 fiber，再卸载命名空间。
    // Reverse-order cleanup: stop the panel fiber, then unmount the namespace.
    await picker.dispose()
    await unmount()
  }
}
