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
 *   `agent.ctx.tools.register` / `agent.ctx.skills.register` /
 *   `agent.ctx.effect` / `agent.ctx.on` 直接调用就是安全的——没有槽位、
 *   没有记账、没有重渲；工具与单会话 skill 同一机制：组件体直登，随 agent
 *   fiber 生灭。
 * - **页面逻辑不脱离页面**：首屏读取是组件体自己的生命周期——体经
 *   `agent.ctx.effect` 发起异步读，读到的事实（含失败态）经 `agent.followup`
 *   以新消息进上下文。宿主不经手任何取数，meta 里没有任何行为钩子。
 * Three pieces:
 * - **defineComponentPage**: wraps "the component IS the page" into the shape
 *   the existing registration face accepts (PageDefinition + PageLiveBinding) —
 *   zero new registration face (C8);
 * - **exactly one render per session**: at mount the component body runs on
 *   the page session's real Agent exactly once and its output is immediately
 *   finalized into Markdown (the PAGE block). The body runs once, so calling
 *   `agent.ctx.tools.register` / `agent.ctx.effect` / `agent.ctx.on` directly
 *   is safe — no slots, no recording, no re-render;
 * - **page logic never leaves the page**: the first-screen read is the body's
 *   own lifecycle — the body starts it via `agent.ctx.effect` and the facts it
 *   lands (failure states included) ride `agent.followup` as new messages. The
 *   host touches no data fetching, and the meta carries no behavioral hooks.
 * @module @veren/prompt-page/component
 */
import type { Agent } from '@deepseek-ai/dsh-agent'
import { elementsToMarkdown } from './markdown.ts'
import type { PageLiveBinding, PageParams, PageDefinition } from './types.ts'
import type { ElementInput } from '@veren/prompt-core'

/**
 * 页面组件：props = URL params，agent = 页面会话的真实 Agent（原样，不包装、
 * 不扩展）。体恰好执行一次；工具/订阅/清理/首屏读直接经 `agent.ctx` 登记，
 * 返回值就是正文元素树。
 * The page component: props are the URL params; agent is the page session's
 * real Agent (as-is — no wrapping, no extension). The body runs exactly once;
 * tools, subscriptions, cleanups, and the first-screen read register directly
 * via `agent.ctx`, and the return value is the body element tree.
 */
export type PageFC<P extends Record<string, unknown> = Record<string, unknown>> =
  (props: P, agent: Agent) => ElementInput

/**
 * 无人值守工作面契约（docs/unattended-page-contract.cn.md §2）：一页一声明——
 * 服务哪类投递任务、动作级上限、完成证据形态、失败出路。纯类型面：缺省 = 本页
 * 不参与无人值守面，达标检查器（@veren/test-support 的 assertUnattendedPage）
 * 对它沉默。
 * The unattended work-face contract (docs/unattended-page-contract.md §2): one
 * declaration per page — the kind of delivered tasks it serves, the action-level
 * ceiling, the completion-evidence shape, the failure escape. Type-face only:
 * absent = the page does not join the unattended face and the compliance
 * checker (@veren/test-support's assertUnattendedPage) stays silent.
 */
export interface UnattendedContract {
  /** 本页服务哪类投递任务（一句话）/ the kind of delivered tasks this page serves */
  readonly serves: string
  /** 本页动作级上限：L0 只读 / L1 可逆写 / L2 破坏性或对外副作用 / the action-level ceiling */
  readonly level: 'L0' | 'L1' | 'L2'
  /** 完成证据形态（L0 填 'read-only'）/ the completion-evidence shape (L0 fills 'read-only') */
  readonly evidence: string
  /** 失败出路（L0 填 'none-needed'；L2 必须点名稳定拒绝码或回滚路）/ the failure escape (L2 must name the stable refusal code or rollback path) */
  readonly escape: string
  /** 自主预算一句话（缺省 = 租约即上界）/ the autonomy budget in one line (default: the lease is the bound) */
  readonly budget?: string
}

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
  /** 会话列表标题（§3.6.1）；缺省用 description / the session-list title (§3.6.1); defaults to description */
  readonly instanceTitle?: (params: P & PageParams) => string
  /** 无人值守工作面契约（docs/unattended-page-contract.cn.md §2）；缺省 = 不参与 / the unattended work-face contract; absent = not participating */
  readonly unattended?: UnattendedContract
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
    ...(meta.instanceTitle === undefined ? {} : { instanceTitle: (params) => meta.instanceTitle!(params as P & PageParams) }),
  }
  const live: PageLiveBinding = {
    mount: (params, agent) => {
      // 唯一一次渲染：体在页面会话的真实 Agent 上执行，产物即刻成型为 Markdown。
      // 失败原样抛出（挂载方回滚整个半成品会话）。体经 agent.ctx.effect 发起的
      // 首屏读不属于本次渲染——它们随 agent fiber 生命落定，事实经 followup 进上下文。
      // The only render: the body runs on the page session's real Agent and its
      // output is finalized into Markdown at once. Failures rethrow (the mounter
      // rolls back the whole half-built session). First-screen reads the body
      // starts via agent.ctx.effect are not part of this render — they settle
      // with the agent fiber, their facts riding followup into the context.
      return elementsToMarkdown(component({ ...params } as P, agent))
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
