/**
 * 组件页适配器（一次性渲染形态）：PageFC + meta → PageDefinition + 挂载绑定。
 * The component-page adapter (one-shot form): PageFC + meta → a PageDefinition
 * plus the mount binding.
 *
 * 三件事：
 * - **defineComponentPage**：把"组件即页面"包成既有注册面能收的形状
 *   （PageDefinition + PageLiveBinding）——注册面零新建（C8）；
 * - **一个会话恰好一次渲染**：挂载时组件体在页面会话的真实 Agent 上执行
 *   恰好一次，产物即刻成型为 Markdown（进 PAGE 块）。体只跑一次，所以
 *   `agent.ctx.tools.register` / `agent.ctx.effect` / `agent.ctx.on` 直接
 *   调用就是安全的——没有槽位、没有记账、没有重渲；此后页面不再渲染，
 *   后续变化由页面自己经 agent.inject/followup 以新消息进上下文；
 * - **useSnapshot**：读 meta.load 的首屏结果（组件与首屏数据的类型化通道）。
 * Three pieces:
 * - **defineComponentPage**: wraps "the component IS the page" into the shape
 *   the existing registration face accepts (PageDefinition + PageLiveBinding) —
 *   zero new registration face (C8);
 * - **exactly one render per session**: at mount the component body runs on
 *   the page session's real Agent exactly once and its output is immediately
 *   finalized into Markdown (the PAGE block). The body runs once, so calling
 *   `agent.ctx.tools.register` / `agent.ctx.effect` / `agent.ctx.on` directly
 *   is safe — no slots, no recording, no re-render; the page never renders
 *   again, and later changes reach the context as new messages the page pushes
 *   itself via agent.inject/followup;
 * - **useSnapshot**: reads meta.load's first-screen result (the typed channel
 *   between component and first screen).
 * @module @veren/prompt-page/component
 */
import type { Agent } from '@deepseek-ai/dsh-agent'
import { elementsToMarkdown } from './markdown.ts'
import type { PageJsonValue, PageLiveBinding, PageLoadEnv, PageParams, PageDefinition, PageSkill } from './types.ts'
import type { ElementInput } from '@veren/prompt-core'

/**
 * 页面组件：props = URL params，agent = 页面会话的真实 Agent（原样，不包装、
 * 不扩展）。体恰好执行一次；工具/订阅/清理直接经 `agent.ctx` 登记，返回值就是
 * 正文元素树。
 * The page component: props are the URL params; agent is the page session's
 * real Agent (as-is — no wrapping, no extension). The body runs exactly once;
 * tools/subscriptions/cleanups register directly via `agent.ctx`, and the
 * return value is the body element tree.
 */
export type PageFC<P extends Record<string, unknown> = Record<string, unknown>> =
  (props: P, agent: Agent) => ElementInput

/** 组件页契约面（适配器并成 PageDefinition 时并入）/ the component page's contract face (merged into the PageDefinition by the adapter) */
export interface ComponentPageMeta<P extends Record<string, unknown> = Record<string, unknown>> {
  /** 页面唯一名；缺省取 URL 末段 / the unique page name; defaults to the last url segment */
  readonly name?: string
  readonly url: string
  readonly description: string
  /** 写意图声明（§3.9/§3.10.1），语义见 PageDefinition.writes / the write-intent declaration, see PageDefinition.writes */
  readonly writes?: boolean
  /** 本页给模型的说明；随 PAGE 块附上 / the page note, appended to the PAGE block */
  readonly instructions?: string
  /** 页面级 skills：随本页挂进会话 agent 作用域 / page-scope skills mounted into the session's agent scope */
  readonly skills?: readonly PageSkill[]
  /** 首屏数据：结果经 useSnapshot() 进组件；抛错 → 失败态进组件如实渲染
   * / the first-screen data: read via useSnapshot(); a throw renders the failure state honestly */
  readonly load?: (params: P & PageParams, env: PageLoadEnv) => Promise<PageJsonValue>
  /** 会话列表标题（§3.6.1）；缺省用 description / the session-list title (§3.6.1); defaults to description */
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

// ---- 页级渲染作用域：useSnapshot 的载体（一次渲染内的环境读取）/ the page-render scope carrying useSnapshot ----

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
 * 仅在唯一一次渲染内可读；挂载之外调用返回 undefined。
 * useSnapshot: reads meta.load's first-screen result (failure states included —
 * they are data too, rendered honestly by the component). Readable only inside
 * the one render; returns undefined outside a mount.
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
): ComponentPageRegistration {
  const page: PageDefinition<never> = {
    name: meta.name ?? nameFromUrl(meta.url),
    url: meta.url,
    description: meta.description,
    ...(meta.writes === undefined ? {} : { writes: meta.writes }),
    ...(meta.instructions === undefined ? {} : { instructions: meta.instructions }),
    ...(meta.skills === undefined ? {} : { skills: meta.skills }),
    ...(meta.load === undefined ? {} : { load: (params, env) => meta.load!(params as P & PageParams, env) }),
    ...(meta.instanceTitle === undefined ? {} : { instanceTitle: (params) => meta.instanceTitle!(params as P & PageParams) }),
  }
  const live: PageLiveBinding = {
    mount: (params, agent, snapshot) => {
      // 唯一一次渲染：体在页面会话的真实 Agent 上执行，产物即刻成型为 Markdown。
      // 失败原样抛出（挂载方回滚整个半成品会话）。
      // The only render: the body runs on the page session's real Agent and its
      // output is finalized into Markdown at once. Failures rethrow (the mounter
      // rolls back the whole half-built session).
      return runWithPageRender(
        { snapshot },
        () => elementsToMarkdown(component({ ...params } as P, agent)),
      )
    },
  }
  const registration: ComponentPageRegistration & { __componentPage: boolean } = {
    page,
    live,
    __componentPage: true,
  }
  return registration
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
