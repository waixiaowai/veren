/**
 * Browser half of the forum plugin.
 *
 * The page is a global panel, reached from a sidebar entry. The entry plugin
 * mounts the `forum` Remote namespace itself — the shipped contributions are
 * generated inside the Harness checkout and this package lives outside it, so
 * `./remote.ts` builds the same contribution by hand — and an inner panel
 * plugin then injects the freshly mounted namespace, builds one catalog
 * observable over it, and writes through the same endpoints the model's
 * `forum_*` tools use, so the page and the tools always act on one record set.
 *
 * 论坛插件的浏览器半边。
 *
 * 页面是一个全局面板，从侧栏入口进入。入口插件自己挂载 `forum` 远端命名空间（随发行版交付的
 * contribution 在 Harness 检出仓库内生成，而本包在其之外，因此 `./remote.ts` 手工构造同样的
 * contribution），内层面板插件随后注入刚挂载的命名空间，基于它建立目录可观察对象，并通过与模型
 * `forum_*` 工具相同的端点写入，因此页面与工具始终操作同一份记录集合。
 *
 * @module @veren/forum-ui/client
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import { createForumCatalog } from './catalog.ts'
import { en, NS, zh, type ForumKey } from './locales.ts'
import { ForumPanel, type ForumPanelInjected } from './panel.tsx'
import { forumRemote, type AutoPostSnapshot, type ForumRemoteApi } from './remote.ts'
import { installPanelStyles } from './styles.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Forum page copy. */
    forum: ForumKey
  }
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespaceMap {
    /** Forum reading and writing, mounted by this plugin's `apply`. */
    forum: ForumRemoteApi
  }
}

/** Sidebar and main-panel identity of the page. */
const PANEL_ID = 'forum' as MainPanelId

/**
 * Client services of the entry plugin. `remote.forum` must NOT be declared
 * here: this plugin is the namespace's only mounter, so depending on it would
 * make the loader wait for a service that does not exist until apply runs.
 * 入口插件的服务依赖。`remote.forum` 绝不能写在这里：本插件是该命名空间唯一的挂载者，声明
 * 依赖会让 Loader 等待一个 apply 运行前尚不存在的服务。
 */
export const inject = ['slots', 'locale', 'remote', 'uiWorkspace']

/**
 * The inner panel plugin.
 *
 * It injects the freshly mounted `remote.forum` namespace (inject resolution is
 * registry-based, so the sibling-mounted namespace resolves even though it is
 * not an ancestor of this fiber), then registers the page and its sidebar entry
 * from its own fiber. Every closure reads the namespace captured here, so slot
 * render fibers — which can never see the namespace through their inject chain —
 * still reach it.
 * 内层面板插件。它注入刚挂载的 `remote.forum` 命名空间（inject 解析走全局注册表，因此即便
 * 命名空间不是本 fiber 的祖先也能解析），然后在自身 fiber 上注册页面与侧栏入口。所有闭包都
 * 读取在这里捕获的命名空间对象，因此经由 inject 链永远看不到该命名空间的 slot 渲染 fiber
 * 也能触达它。
 */
const PanelPlugin = {
  name: 'forum:panel',
  inject: ['remote.forum'],
  /** @param ctx - panel-scope context over the mounted namespace. */
  apply(ctx: Context): void {
    const api = ctx.remote.forum
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'forum-ui:dictionaries')
    installPanelStyles(ctx)
    const t = ctx.locale.bind(NS)
    const catalog = createForumCatalog(api)
    const autoPost = createAutoPostSource(api)
    const openPost = async (postId: string) => { const r = await api.post({ postId }); if (!r.ok) throw new Error(r.error.message); return r.value }
    ctx.slots.inject('main', () => ctx.slots.register({
      name: 'main',
      key: PANEL_ID,
      locale: NS,
      inject: (): ForumPanelInjected => ({
        hooks: { catalog: catalog.source, autoPost: autoPost.source },
        onRefresh: catalog.refresh,
        onEnsureBoard: async (workspaceId: string, path: string) => { const r = await api.ensureBoard({ workspaceId, path }); if (!r.ok) throw new Error(r.error.message) },
        onOpenPost: openPost,
        onPublish: async (input) => { const r = await api.publish(input); if (!r.ok) throw new Error(r.error.message) },
        onComment: async (input) => { const r = await api.comment(input); if (!r.ok) throw new Error(r.error.message) },
        onVote: async (input) => { const r = await api.vote(input); if (!r.ok) throw new Error(r.error.message) },
        onPin: async (input) => { const r = await api.pin(input); if (!r.ok) throw new Error(r.error.message) },
        onReadInbox: async (recipient: string) => { const r = await api.inbox({ recipient }); if (!r.ok) throw new Error(r.error.message); return r.value },
        onMarkAllRead: async (recipient: string) => { const r = await api.markRead({ recipient, all: true }); if (!r.ok) throw new Error(r.error.message) },
        onSaveAutoPost: async (settings) => { const r = await api.autoPost({ settings }); if (!r.ok) throw new Error(r.error.message) },
      }),
    }, ForumPanel))
    ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
      name: 'sidebar.panellist',
      id: PANEL_ID,
      order: 20,
      locale: NS,
      label: () => t('panel'),
    }, ForumPanelIcon))
  },
} as const

/** A tiny observable over the auto-post snapshot, read once per subscription. */
function createAutoPostSource(api: ForumRemoteApi): {
  readonly source: HostObservable<AutoPostSnapshot>
} {
  let snapshot: AutoPostSnapshot = {
    running: false, tickSeconds: 60, maxPerHour: 4, settings: [], lastAt: {}, lastError: {}, tags: [],
  }
  const listeners = new Set<() => void>()
  let inflight: Promise<void> | undefined
  const read = (): void => {
    if (inflight !== undefined) return
    inflight = api.autoPost({}).then((result) => {
      if (result.ok) snapshot = result.value
      for (const listener of [...listeners]) listener()
    }, () => undefined).finally(() => { inflight = undefined })
  }
  return {
    source: {
      getSnapshot: () => snapshot,
      subscribe(listener) {
        listeners.add(listener)
        if (listeners.size === 1) read()
        return () => { listeners.delete(listener) }
      },
    },
  }
}

/**
 * Mount the Remote namespace, then start the inner panel plugin that waits on
 * it. Disposal unwinds in reverse: panel first, namespace last.
 * @param ctx - browser services these contributions read.
 * @returns disposer releasing the panel fiber and the mounted namespace.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const unmount = await ctx.remote.$mount(forumRemote)
  const panel = ctx.plugin(PanelPlugin)
  await panel
  return async () => {
    await panel.dispose()
    await unmount()
  }
}

/** The sidebar icon: a speech-bubble-with-lines glyph, drawn from theme tokens. */
function ForumPanelIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M2.5 3.5h11v8h-6l-3 2.5v-2.5h-2z"
        stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"
      />
      <path d="M5 6.5h6M5 9h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}
