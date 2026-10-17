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
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import { NS, en, zh, type NotebookKey } from './locales.ts'
import { NotebookPanel } from './panel.tsx'
import {
  notebookRemote, type NoteView, type NotebookPanelInjected, type NotebookRemoteApi, type NotebookRemoteResult,
  type NotebookSnapshot, type OwnerView,
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

/** How long the open page waits before re-reading, in milliseconds. */
const POLL_MS = 8_000

/** The observable plus the owner selection and manual refresh the page uses. */
export interface NotebookSource {
  readonly source: HostObservable<NotebookSnapshot>
  readonly select: (owner: string) => void
  readonly refresh: () => void
}

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

/**
 * Build the page's single observable over the Remote namespace.
 * @param api - the mounted `remote.notebook` namespace.
 * @returns the observable, its owner selection, and its manual refresh.
 */
function createNotebookSource(api: NotebookRemoteApi): NotebookSource {
  let snapshot: NotebookSnapshot = {
    owners: [], owner: undefined, notes: [], status: 'loading', settled: false, error: '',
  }
  let owner: string | undefined
  let epoch = 0
  let timer: ReturnType<typeof globalThis.setInterval> | undefined
  const listeners = new Set<() => void>()
  const publish = (next: Partial<NotebookSnapshot>): void => {
    snapshot = { ...snapshot, ...next }
    for (const listener of [...listeners]) listener()
  }
  const run = async (mine: number): Promise<void> => {
    try {
      const owners = await readOwners(api)
      const chosen = chooseOwner(owners, owner)
      owner = chosen
      if (chosen === undefined) {
        if (mine === epoch) {
          publish({ owners, owner: undefined, notes: [], status: 'ready', settled: true, error: '' })
        }
        return
      }
      const notes = await readNotes(api, chosen)
      if (mine !== epoch) return
      publish({ owners, owner: chosen, notes, status: 'ready', settled: true, error: '' })
    } catch (error: unknown) {
      if (mine === epoch) publish({ status: 'error', error: messageOf(error) })
    }
  }
  const load = (): void => {
    const mine = ++epoch
    if (!snapshot.settled) publish({ status: 'loading' })
    void run(mine)
  }
  return {
    source: {
      getSnapshot: () => snapshot,
      subscribe(listener) {
        listeners.add(listener)
        if (listeners.size === 1) {
          load()
          timer = globalThis.setInterval(load, POLL_MS)
        }
        return () => {
          listeners.delete(listener)
          if (listeners.size !== 0) return
          if (timer !== undefined) globalThis.clearInterval(timer)
          timer = undefined
          epoch += 1
        }
      },
    },
    select: (next) => { owner = next; load() },
    refresh: () => { load() },
  }
}

/** Keep the selected owner when it still exists, else prefer a declared preset. */
function chooseOwner(owners: readonly OwnerView[], current: string | undefined): string | undefined {
  if (current !== undefined && owners.some(owner => owner.id === current)) return current
  return owners.find(owner => owner.declared)?.id ?? owners[0]?.id
}

/** Read the owner list or throw the Host's message. */
async function readOwners(api: NotebookRemoteApi): Promise<readonly OwnerView[]> {
  const result = await api.owners({})
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

/** Read one owner's notes or throw the Host's message. */
async function readNotes(api: NotebookRemoteApi, owner: string): Promise<readonly NoteView[]> {
  const result = await api.list({ owner })
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

/** Unwrap one write result, raising the Host's message on refusal. */
async function unwrap<T>(result: Promise<NotebookRemoteResult<T>>): Promise<T> {
  const settled = await result
  if (!settled.ok) throw new Error(settled.error.message)
  return settled.value
}

/** Render one failure as a single line. */
function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && error !== null && 'message' in error) return String(error.message)
  return String(error)
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
