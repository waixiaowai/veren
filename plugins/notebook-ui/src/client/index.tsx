/**
 * Browser half of the notebook plugin.
 *
 * The page is a global panel reached from a sidebar entry. The entry plugin
 * mounts the `notebook` Remote namespace itself — the shipped contributions are
 * generated inside the Harness checkout and this package lives outside it, so
 * `./remote.ts` builds the same contribution by hand — and an inner panel plugin
 * then injects the freshly mounted namespace, builds one observable over it, and
 * writes through the same endpoints the model's `notebook_*` tools use.
 *
 * 记事本插件的浏览器半边。
 *
 * 页面是一个全局面板，从侧栏入口进入。入口插件自己挂载 `notebook` 远端命名空间（随发行版
 * 交付的 contribution 在 Harness 检出仓库内生成，而本包在其之外，因此 `./remote.ts` 手工
 * 构造同样的 contribution），内层面板插件随后注入刚挂载的命名空间，基于它建立一个可观察对象，
 * 并通过与模型 `notebook_*` 工具相同的端点写入。
 *
 * @module @veren/notebook-ui/client
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import { NS, en, zh, type NotebookKey } from './locales.ts'
import { NotebookPanel } from './panel.tsx'
import { createNotebookSource } from './source.ts'
// 页面唯一可观察对象归 source.ts 所有；这里保留薄 re-export，导出面不变。
// The page's single observable is owned by source.ts; this stays a thin
// re-export so the export face is unchanged.
export type { NotebookSource } from './source.ts'
import {
  notebookRemote, type NotebookPanelInjected, type NotebookRemoteApi, type NotebookRemoteResult,
} from './remote.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Notebook page copy. */
    notebook: NotebookKey
  }
}

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespaceMap {
    /** Notebook reading and writing, mounted by this plugin's `apply`. */
    notebook: NotebookRemoteApi
  }
}

/** Sidebar and main-panel identity of the page. */
const PANEL_ID = 'notebook' as MainPanelId

/**
 * Client services of the entry plugin. `remote.notebook` must NOT be declared
 * here: this plugin is the namespace's only mounter, so depending on it would
 * make the loader wait for a service that does not exist until apply runs.
 * 入口插件的服务依赖。`remote.notebook` 绝不能写在这里：本插件是该命名空间唯一的挂载者，
 * 声明依赖会让 Loader 等待一个 apply 运行前尚不存在的服务。
 */
export const inject = ['slots', 'locale', 'remote']

/**
 * The inner panel plugin: it injects the freshly mounted namespace, then
 * registers the page and its sidebar entry from its own fiber.
 */
const PanelPlugin = {
  name: 'notebook:panel',
  inject: ['remote.notebook'],
  /** @param ctx - panel-scope context over the mounted namespace. */
  apply(ctx: Context): void {
    const api = ctx.remote.notebook
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'notebook-ui:dictionaries')
    installPanelStyles(ctx)
    const t = ctx.locale.bind(NS)
    const notebook = createNotebookSource(api)
    ctx.slots.inject('main', () => ctx.slots.register({
      name: 'main',
      key: PANEL_ID,
      locale: NS,
      inject: (): NotebookPanelInjected => ({
        hooks: { notebook: notebook.source },
        onSelect: notebook.select,
        onRefresh: notebook.refresh,
        onCreate: async input => unwrap(api.create(input)),
        onUpdate: async input => unwrap(api.update(input)),
        onRemove: async input => unwrap(api.deleteNote(input)),
      }),
    }, NotebookPanel))
    ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
      name: 'sidebar.panellist',
      id: PANEL_ID,
      order: 21,
      locale: NS,
      label: () => t('panel'),
    }, NotebookPanelIcon))
  },
} as const

/** Unwrap one write result, raising the Host's message on refusal. */
async function unwrap<T>(result: Promise<NotebookRemoteResult<T>>): Promise<T> {
  const settled = await result
  if (!settled.ok) throw new Error(settled.error.message)
  return settled.value
}

/**
 * Mount the Remote namespace, then start the inner panel plugin that waits on
 * it. Disposal unwinds in reverse: panel first, namespace last.
 * @param ctx - browser services these contributions read.
 * @returns disposer releasing the panel fiber and the mounted namespace.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  try {
    const unmount = await ctx.remote.$mount(notebookRemote)
    const panel = ctx.plugin(PanelPlugin)
    await panel
    return async () => {
      await panel.dispose()
      await unmount()
    }
  } catch (error: unknown) {
    console.error('notebook-ui apply failed', error)
    throw error
  }
}

/** The sidebar icon: a small notebook with a bookmark and ruled lines. */
function NotebookPanelIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3.5 2.5h8v11h-8z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M7.5 2.5v4l1.2-.9 1.3.9v-4" fill="currentColor" />
      <path d="M5.5 9h5M5.5 11h3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

/** Marker attribute so a re-activation replaces its own sheet rather than stacking. */
const STYLE_MARKER = 'data-notebook-panel'

/** The page stylesheet, inlined by `scripts/bundle.mjs` from `panel.css`. */
declare const __NOTEBOOK_CSS__: string

/**
 * Install the page stylesheet once, replacing any previous activation's copy.
 * @param ctx - the plugin's client context, whose effect owns the element.
 */
function installPanelStyles(ctx: Context): void {
  ctx.effect(() => {
    const style = document.createElement('style')
    style.setAttribute(STYLE_MARKER, '')
    style.textContent = __NOTEBOOK_CSS__
    document.head.append(style)
    return () => { style.remove() }
  }, 'notebook-ui:styles')
}
