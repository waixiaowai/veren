/**
 * 组件页适配器（C5/§3.5）：PageFC + meta → PageDefinition + 每会话实时视图。
 * The component-page adapter (C5/§3.5): a PageFC + meta → a PageDefinition plus
 * a per-session live view.
 *
 * 四件事：
 * - **defineComponentPage**：把"组件即页面"包成既有注册面能收的形状
 *   （PageDefinition + PageLiveBinding）——注册面零新建（C8）；
 * - **页面 hooks（`ctx.page`）**：render 期的 `ctx.page.effect` / `ctx.page.on` /
 *   `ctx.page.tool` 走槽位记账（一次运行/订阅，RFC §5.3）；effect 清理与事件订阅
 *   挂在会话的 `agent.ctx` 作用域上（事件按 agent 过滤，agent 销毁兜底）；ctx 的
 *   固有成员（tools/effect/on）原样保留，不被改写；
 * - **每会话视图**：自有 prompt-core root + MarkdownDocHost——首帧 body 进 PAGE
 *   块，后续渲染 diff 出 PAGE-PATCH；teardown 随视图 unsubscribe 逆序清理；
 * - **useSnapshot**：读 meta.load 的首屏结果（组件与首屏数据的类型化通道）。
 * Four pieces:
 * - **defineComponentPage**: wraps "the component IS the page" into the shape
 *   the existing registration face accepts (PageDefinition + PageLiveBinding) —
 *   zero new registration face (C8);
 * - **the page hooks (`ctx.page`)**: render-time `ctx.page.effect` /
 *   `ctx.page.on` / `ctx.page.tool` are recorded through hook slots (run once /
 *   subscribed once, RFC §5.3); effect cleanups and event subscriptions register
 *   on the session's `agent.ctx` scope (agent-filtered events, agent-disposal
 *   fallback); the ctx's inherent members (tools/effect/on) stay untouched;
 * - **the per-session view**: its own prompt-core root + MarkdownDocHost — the
 *   first-frame body feeds the PAGE block, later renders diff into PAGE-PATCH;
 *   teardown rides the view's unsubscribe in reverse order;
 * - **useSnapshot**: reads meta.load's first-screen result (the typed channel
 *   between component and first screen).
 * @module @veren/prompt-page/component
 */
import { createRoot, runWithHookScope, scheduleRender, useSlot } from '@veren/prompt-core'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { ElementInput, ExternalStore, Fiber, HookCell, PromptRoot } from '@veren/prompt-core'
import type { PageDefinition, PageHostFace, PageJsonValue, PageLiveBinding, PageLoadEnv, PageParams, PageSession } from './types.ts'
import { MarkdownDocHost } from './markdown.ts'
import { formatPath } from './registry.ts'

/**
 * 页面自己的生命周期与工具登记面：**不改写 ctx 的固有成员**。`ctx` 仍是真实的
 * Cordis Context（`ctx.effect` / `ctx.on` / `ctx.tools` 语义原样），页面专用的
 * 记账面只出现在这个独立对象上：
 * - `effect` / `on`：首帧执行/订阅一次；有会话作用域（`agent.ctx`）时经它注册——
 *   事件按 agent 过滤、清理随作用域；否则随视图 teardown。视图提前退订时先执行。
 * - `tool`：记录工具定义，页面运行时在会话的 agent 作用域上挂载，随会话卸载。
 * The page's own lifecycle and tool-registration face: it **never rewrites the
 * inherent ctx members**. `ctx` stays a real Cordis Context (`ctx.effect` /
 * `ctx.on` / `ctx.tools` keep their semantics); page-only recording lives on
 * this separate object:
 * - `effect` / `on`: run/subscribe once on the first frame; with a session scope
 *   (`agent.ctx`) they register through it — agent-filtered events and
 *   scope-owned cleanup; otherwise they ride the view teardown, which also runs
 *   first when the view is unpublished early.
 * - `tool`: records a definition the page runtime mounts on the session's agent
 *   scope, removed with the session.
 */
export interface PageHooks {
  effect(run: () => (() => void) | void): void
  on(name: string, handler: (payload: unknown) => void): void
  tool(definition: ToolDefinition): void
}

/** 页面组件 ctx：真实宿主 ctx（服务面与固有成员原样）+ 页面 hooks 面
 * / the component ctx: the real host ctx (services and inherent members intact) plus the page hooks face */
export type PageCtx = Context & { readonly page: PageHooks }

/** 页面组件：props = URL params，ctx = 真实宿主 ctx + `ctx.page`
 * / a page component: props = the URL params, ctx = the real host ctx plus `ctx.page` */
export type PageFC<P extends Record<string, unknown> = Record<string, unknown>> =
  (props: P, ctx: PageCtx) => ElementInput

/** 组件页契约面（适配器并成 PageDefinition 时并入）/ the component page's contract face (merged into the PageDefinition by the adapter) */
export interface ComponentPageMeta<P extends Record<string, unknown> = Record<string, unknown>> {
  /** 页面唯一名；缺省取 URL 末段 / the unique page name; defaults to the last url segment */
  readonly name?: string
  readonly url: string
  readonly description: string
  /** 应用工具目录的本地名清单（既有面：runtime 经 toolsOf 解析并 mountTools）
   * / local tool names from the app catalog (existing face: resolved via toolsOf and mounted by the runtime) */
  readonly tools?: readonly string[]
  /** 外部权威 store（既有面）：订阅变化触发重渲，useSnapshot() 读其状态——数据面单一事实源。状态类型在 useSnapshot<T>() 处收窄
   * / an external authoritative store (existing face): changes re-render and useSnapshot() reads its state — a single source of data fact. The state type narrows at useSnapshot<T>() */
  readonly store?: ExternalStore<unknown>
  /** 首屏数据（无 store 的页面用）：结果经 useSnapshot() 进组件；抛错 → 失败态进组件如实渲染 */
  readonly load?: (params: P & PageParams, env: PageLoadEnv) => Promise<PageJsonValue>
  readonly instructions?: string
  readonly writes?: boolean
  /** 会话列表标题（§3.6.1）：宿主会话列表的显示名，不进文档正文；缺省用 description
   * / the session-list title (§3.6.1): the host session list's display name, never document body content; defaults to description */
  readonly instanceTitle?: (params: P & PageParams) => string
}

/** 组件页注册形状：app-registry 的 registrar 检测 PageFC（函数）+ meta 后调用 defineComponentPage
 * / the component-page registration shape: the registrar detects a PageFC (a function) + meta and calls defineComponentPage */
export interface ComponentPageRegistration {
  readonly page: PageDefinition<never>
  readonly live: PageLiveBinding
}

/** 组件页标记（注册面检测用）/ the component-page marker (for registration-face detection) */
export function isComponentPageRegistration(value: unknown): value is ComponentPageRegistration {
  return typeof value === 'object' && value !== null && (value as { __componentPage?: boolean }).__componentPage === true
}

/** URL 末段 → 页面名（:param 取参数名）/ the last url segment → the page name (a :param uses its name) */
function nameFromUrl(url: string): string {
  // URL → 页面名：取应用段后第一个非 `:param` 段（/apps/tasks/task/:taskId → task）；
  // 全为参数时退到第一个参数名，再退 'page'。
  // The url → page name: the first non-`:param` segment after the app segment
  // (/apps/tasks/task/:taskId → task); all-param urls fall back to the first
  // parameter name, then 'page'.
  const segments = url.split('/').filter((segment) => segment.length > 0)
  const afterApp = segments.slice(2)
  const named = afterApp.find((segment) => !segment.startsWith(':'))
  if (named !== undefined) return named
  const firstParam = afterApp.find((segment) => segment.startsWith(':'))
  return firstParam !== undefined ? firstParam.slice(1) : 'page'
}

// ---- 页级渲染作用域：useSnapshot 的载体（渲染可嵌套，保存恢复）/ the page-render scope carrying useSnapshot ----

interface PageRenderScope {
  readonly snapshot: PageJsonValue | undefined
}

const pageRenderStack: PageRenderScope[] = []

/** 在页面渲染作用域内运行 fn（useSnapshot 读作用域里的快照）/ run fn within a page-render scope (useSnapshot reads the scope's snapshot) */
function runWithPageRender<T>(scope: PageRenderScope, fn: () => T): T {
  pageRenderStack.push(scope)
  try {
    return fn()
  } finally {
    pageRenderStack.pop()
  }
}

/**
 * useSnapshot：读 meta.load 的首屏结果（含失败态——失败态也是数据，由组件如实渲染）。
 * useSnapshot: reads meta.load's first-screen result (failure states included —
 * they are data too, rendered honestly by the component).
 */
export function useSnapshot<T = PageJsonValue>(): T {
  const scope = pageRenderStack[pageRenderStack.length - 1]
  return (scope?.snapshot ?? undefined) as T
}

// ---- defineComponentPage / the adapter ----

/** defineComponentPage 产出的注册形状 / the registration shape defineComponentPage produces */
export function defineComponentPage<P extends Record<string, unknown>>(
  component: PageFC<P>,
  meta: ComponentPageMeta<P>,
  ctx?: Context,
): ComponentPageRegistration {
  // load → useSnapshot 的桥：首屏结果先落 pending，live.mount 建视图时取走。
  // 并发建会话时按序覆盖（reserve → load → mount 顺序执行）；边界见 README。
  // The load→useSnapshot bridge: the first screen lands in pending, taken by
  // live.mount when the view is built. Concurrent creations overwrite in order
  // (reserve → load → mount run sequentially); the edge is documented in the README.
  let pendingSnapshot: PageJsonValue | undefined
  const page: PageDefinition<never> = {
    name: meta.name ?? nameFromUrl(meta.url),
    url: meta.url,
    description: meta.description,
    tools: meta.tools,
    instructions: meta.instructions,
    writes: meta.writes,
    instanceTitle: meta.instanceTitle === undefined ? undefined : (params) => meta.instanceTitle!(params as P & PageParams),
    load: meta.load === undefined ? undefined : (params, env) => meta.load!(params as P & PageParams, env),
  }
  const live: PageLiveBinding = {
    mount: (params, scope) => {
      // 快照源：有 store 读权威 store（单一事实源）；无 store 由运行时经
      // setSnapshot 下发 load 结果（含失败态）。
      // The snapshot source: with a store read it (the single source of fact);
      // without, the runtime pushes the load result (failures included) via
      // setSnapshot.
      const snapshotSource: () => PageJsonValue | undefined = meta.store === undefined
        ? () => pendingSnapshot
        : () => meta.store!.getState() as PageJsonValue
      const view = createSessionView(component, meta, ctx, scope, params, page, snapshotSource)
      pendingSnapshot = undefined
      return view
    },
  }
  const registration: ComponentPageRegistration & { __componentPage: boolean } = {
    page,
    live,
    __componentPage: true,
  }
  return registration
}

// ---- 每会话视图（隔离的 hooks/文档/facade）/ the per-session view (isolated hooks/doc/facade) ----

/** 每会话运行时状态 / the per-session runtime state */
interface SessionRuntime<P> {
  readonly cells: HookCell[]
  readonly root: PromptRoot
  readonly doc: MarkdownDocHost
  readonly params: PageParams
  readonly recordedTools: ToolDefinition[]
  readonly subscriptions: Array<() => void>
  readonly cleanups: Array<() => void>
  snapshot: PageJsonValue | undefined
  tornDown: boolean
}

/**
 * 页面 hooks 的记账实现：effect/on 按槽位只执行/订阅一次，tool 按名去重记录。
 * `scope` 是该会话的 agent 作用域（`agent.ctx`）：effect 的清理与事件订阅经它
 * 注册——事件按 agent 过滤、agent 销毁时兜底；视图提前退订时仍由 state 里的
 * 清理面提前执行（单次）。缺省（agent 未创建，如暂存预览）时清理随视图 teardown，
 * 订阅回退到 `fallbackCtx`（创建者 ctx）。
 * The page hooks' recording implementation: effect/on run/subscribe once per
 * slot and tool records by name. `scope` is the session's agent scope
 * (`agent.ctx`): effect cleanups and event subscriptions register through it —
 * agent-filtered events and agent-disposal fallback; an earlier view teardown
 * still runs the recorded cleanup first (once). Absent (no agent yet, e.g. a
 * staged preview), cleanup rides the view teardown and subscriptions fall back
 * to `fallbackCtx` (the creator ctx).
 */
function createPageHooks<P>(state: SessionRuntime<P>, scope: Context | undefined, fallbackCtx: Context | undefined): PageHooks {
  return {
    tool: (definition: ToolDefinition): void => {
      if (!state.recordedTools.some((existing) => existing.name === definition.name)) {
        state.recordedTools.push(definition)
      }
    },
    effect: (run: () => (() => void) | void): void => {
      const cell = useSlot(() => ({ ran: false }))
      if (cell.current.ran) return
      cell.current.ran = true
      const cleanup = run()
      if (typeof cleanup !== 'function') return
      if (scope === undefined) {
        // 无会话作用域（暂存预览/裸注册）：清理随视图 teardown。
        // No session scope (staged preview/bare registration): cleanup rides the view teardown.
        state.cleanups.push(cleanup)
        return
      }
      // 官方模型：清理归会话作用域（agent.ctx.effect），agent 销毁时自动执行；
      // 视图提前退订（预览/废弃）时由 state.cleanups 里的 disposer 提前执行一次。
      // The official model: the cleanup belongs to the session scope
      // (agent.ctx.effect) and runs at agent disposal; an earlier view teardown
      // (preview/deprecation) runs it once through the recorded disposer.
      const dispose = scope.effect(() => cleanup, 'prompt-page: page effect')
      state.cleanups.push(() => { void dispose() })
    },
    on: (name: string, handler: (payload: unknown) => void): void => {
      const cell = useSlot(() => ({ subscribed: false }))
      if (cell.current.subscribed) return
      cell.current.subscribed = true
      // 有会话作用域时经它订阅：scopeTarget 只放行该 agent 的事件。缺省回退到
      // 创建者 ctx（暂存预览的订阅只活到预览视图退订）。
      // With a session scope, subscribe through it: scopeTarget admits only that
      // agent's events. The fallback is the creator ctx (a staged preview's
      // subscription lives only until the preview view unsubscribes).
      const target = scope ?? fallbackCtx
      if (target === undefined) return
      const dispose = (target as unknown as { on: (n: string, h: never) => () => void }).on(name, handler as never)
      state.subscriptions.push(() => { dispose() })
    },
  }
}

/**
 * 把页面 hooks 挂到真实 ctx 上：`ctx.extend({ page })` 是 Cordis 的正式子上下文，
 * 固有成员（tools/effect/on）一个都不改。无 ctx 的裸注册（测试）只带 page 面；
 * 非 Cordis 的假 ctx 用原型继承兜底。
 * Hang the page hooks on the real ctx: `ctx.extend({ page })` is Cordis's child
 * context primitive and leaves every inherent member (tools/effect/on) intact.
 * A bare registration (tests) carries only the page face; a non-Cordis fake
 * falls back to prototype inheritance.
 */
function pageCtxOf(ctx: Context | undefined, page: PageHooks): PageCtx {
  if (ctx === undefined) return { page } as PageCtx
  const extend = (ctx as { extend?: (meta: Record<PropertyKey, unknown>) => Context }).extend
  return (typeof extend === 'function'
    ? extend.call(ctx, { page })
    : Object.assign(Object.create(ctx as object), { page })) as PageCtx
}

/** 每会话视图：渲染回路 + teardown + PageSession 结构面 / the per-session view: the render loop + teardown + the PageSession structural face */
function createSessionView<P extends Record<string, unknown>>(
  component: PageFC<P>,
  meta: ComponentPageMeta<P>,
  ctx: Context | undefined,
  scope: Context | undefined,
  params: PageParams,
  page: PageDefinition<never>,
  snapshot: () => PageJsonValue | undefined,
): PageSession<never> & SnapshotSink & { takeRecordedTools(): ToolDefinition[] } {
  const state: SessionRuntime<P> = {
    cells: [],
    root: createRoot({ append: () => undefined, revise: () => undefined, evict: () => undefined }),
    doc: new MarkdownDocHost(),
    params: { ...params },
    recordedTools: [],
    subscriptions: [],
    cleanups: [],
    snapshot: snapshot(),
    tornDown: false,
  }
  const { root, doc } = state
  const componentCtx = pageCtxOf(ctx, createPageHooks(state, scope, ctx))

  /** 渲染一帧：组件（hooks + ctx.page）→ reconciler 展开 → fiber 树 → Markdown diff
   * / render one frame: the component (hooks + ctx.page) → reconciler expansion → the fiber tree → a Markdown diff */
  const renderNow = (): void => {
    // 卸载守卫：视图退订后挂起中的异步回调（如 `.then(setState)`）不得再渲染
    // 孤儿视图。设计文档 §5.3 的 unmounted guard 在此落实（幂等早返回）。
    // Unmounted guard: a pending async callback (e.g. `.then(setState)`) must not
    // render an orphan view after teardown. This implements §5.3's unmounted
    // guard as an idempotent early return.
    if (state.tornDown) return
    const first: Fiber | null = root.current?.child ?? null
    runWithPageRender({ snapshot: state.snapshot }, () =>
      runWithHookScope(root, state.cells, () => {
        const elements = component({ ...state.params } as P, componentCtx)
        scheduleRender(root, elements)
      }),
    )
    const after: Fiber | null = root.current?.child ?? null
    if (docInitialized) doc.update(after)
    else {
      doc.initialize(after)
      docInitialized = true
    }
    void first
  }
  let docInitialized = false

  /** teardown：事件订阅 + effect 清理逆序 + 幂等（store 退订在其后叠加）
   * / teardown: subscriptions + effect cleanups in reverse + idempotent (the store unsubscribe layers after) */
  let teardown = (): void => {
    if (state.tornDown) return
    state.tornDown = true
    for (const dispose of state.subscriptions) dispose()
    for (const cleanup of [...state.cleanups].reverse()) cleanup()
  }

  root.refresh = () => renderNow()

  // 外部权威 store 订阅（既有面）：变化 → 重渲 → diff → PAGE-PATCH；退订随 teardown
  // / the external authoritative store subscription (existing face): change → re-render → diff → PAGE-PATCH; unsubscribed at teardown
  if (meta.store !== undefined) {
    // 订阅先刷新渲染作用域的快照（useSnapshot 读的是它），再触发重渲
    // / the listener refreshes the render scope's snapshot (what useSnapshot reads) before triggering the re-render
    const unsubscribeStore = meta.store.subscribe(() => {
      state.snapshot = meta.store!.getState() as PageJsonValue | undefined
      renderNow()
    })
    const previousTeardown = teardown
    teardown = (): void => {
      unsubscribeStore()
      previousTeardown()
    }
  }

  renderNow() // 首帧（initialize）

  const session: PageSession<never> & SnapshotSink & { takeRecordedTools(): ToolDefinition[] } = {
    page,
    params: { ...params },
    host: doc,
    pointerMessage: `OPEN ${formatPath(page.url, params)} ${JSON.stringify(params)}`,
    get version(): number {
      return doc.currentVersion
    },
    syncText(cursor?: number): string {
      return doc.takeMarkdownPatch(cursor ?? 0)?.text ?? ''
    },
    unsubscribe: () => teardown(),
    takeRecordedTools: () => [...state.recordedTools],
    setSnapshot: (value: PageJsonValue | undefined) => {
      state.snapshot = value
      renderNow()
    },
  }
  return session
}

/** 快照下发面（page-registry 的 createPageSession 在 load 后调用）/ the snapshot sink (called by createPageSession after load) */
export interface SnapshotSink {
  setSnapshot(value: PageJsonValue | undefined): void
}

/** 快照下发面守卫 / a snapshot-sink guard */
export function snapshotSinkOf(view: PageSession<never> | undefined): SnapshotSink | undefined {
  if (view === undefined) return undefined
  return typeof (view as { setSnapshot?: unknown }).setSnapshot === 'function' ? (view as unknown as SnapshotSink) : undefined
}
