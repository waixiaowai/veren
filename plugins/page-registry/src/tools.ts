/**
 * `app_open` 宿主工具：模型侧打开一个页面 URL 的唯一入口（§3.4、附录 A）。
 * The `app_open` host tool: the model-side entry to open a page url.
 *
 * 全局工具（不带应用前缀）；页面工具永远不叫这个名字。用 `defineTool` 产出
 * DSH `ToolDefinition` 后原样 `ctx.tools.register`，零形状转换。打开动作发生在
 * 目标会话上：一律新建一条页面会话（同 URL 旧会话自动废弃，§3.5.3）；当前
 * 会话的页面、工具、历史一律不动。失败码来自 PageErrorCode（app/not-found、
 * app/disabled、page/not-found、task/expired…），原样透出给模型。
 *
 * @module @veren/page-registry/tools
 */
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'

/** app_open 需要的最小服务面 / the minimal service face app_open needs */
export interface AppOpenPort {
  openUrl(url: string, options?: { taskId?: string }): Promise<{ sessionId: string; title: string }>
}



/** 目录返回值渲染成 JSON 文本 / render the open result as JSON text */
function renderValue(_args: unknown, value: unknown): ContentBlock[] {
  return [{ type: 'text', text: JSON.stringify(value) }] as ContentBlock[]
}

/**
 * 构造 `app_open` 工具本体（defineTool 产物，零形状转换）。注册时机归装配层：
 * app-host 在它**唯一的整组接线 effect** 里 `ctx.tools.register` 本工具，与
 * app_list / app_pages 一起登记、一起逆序摘除——本函数不再自带 ctx.effect，
 * 否则整组"全成或全回滚"的约定就会被拆成多个 effect（G13 规则 3）。
 * Build the `app_open` tool body (a `defineTool` product, zero conversion).
 * Registration timing belongs to the assembly layer: app-host registers this
 * tool via `ctx.tools.register` inside its single all-or-nothing wiring effect,
 * together with app_list / app_pages — registered as one group, removed in
 * reverse as one group. This function no longer opens its own ctx.effect,
 * which would split the all-or-nothing contract across effects (G13 rule 3).
 * @param port - 解析 openUrl 服务面 / resolves the service surface
 */
export function createAppOpenTool(port: () => AppOpenPort): ReturnType<typeof defineTool> {
  return defineTool({
    name: 'app_open',
    description: 'Open an application page URL (for example /apps/review-workbench/task/1) or take a task '
      + 'with taskId. It always creates a fresh page session with the page\u2019s tools mounted and returns it; '
      + 'a previous session on the same url is deprecated automatically and never addressed via the url again. '
      + 'Your own session, tools, and history never change. '
      + 'Failures carry stable codes: app/not-found, app/disabled, page/not-found, task/expired.',
    parameters: {
      url: { type: 'string', required: true, description: 'Canonical page URL: /apps/<appId>/<path>[/more][?query]' },
      taskId: { type: 'string', description: 'Task id to take after the page session is open (task workflow).' },
    },
    output: { schema: { type: 'object', additionalProperties: true } as const, render: renderValue },
    async execute(args) {
      return await port().openUrl(args.url, args.taskId === undefined ? {} : { taskId: args.taskId })
    },
    presentCall: args => ({ card: 'generic' as const, title: '打开页面', kind: 'other' as const, ...(args === undefined ? {} : { rawInput: args }) }),
  })
}

/** page_send 需要的最小服务面 / the minimal service face page_send needs */
export interface PageSendPort {
  deliverUrl(url: string, options: {
    message: string
    wake?: boolean
    callerSessionId?: string
  }): Promise<{ sessionId: string; url: string; created: boolean; redirected: boolean }>
}

/**
 * 构造 `page_send` 工具本体（§3.9）：按 URL 幂等投递——该 URL 有活会话则
 * 直接 append（唤醒它干活），没有则新建页面会话再投；返回 sessionId 与
 * created/redirected 标记。它与 `session_dispatch` 的分工：那个按 sessionId
 * （点对点、带结算看守），这个按 URL（幂等寻址、无结算回报）——互不合并、
 * 互不绕行。级联硬上限（page/hop-limit）与废弃竞态重投都在 page-registry
 * 的投递运行时收口。调用方会话经 exec.agent 注入链深台账。
 * Build the `page_send` tool body (§3.9): idempotent url-addressed delivery —
 * append to the url's live session, or create the page session first; returns
 * sessionId plus created/redirected. Division of labor with `session_dispatch`:
 * that one addresses a sessionId (point-to-point, settlement watch), this one
 * addresses a URL (idempotent addressing, no settlement) — never merged, never
 * bypassed. The cascade hard cap and deprecation-race re-delivery close inside
 * page-registry's delivery runtime; the caller session feeds the hop ledger
 * through exec.agent.
 */
export function createPageSendTool(port: () => PageSendPort): ReturnType<typeof defineTool> {
  return defineTool({
    name: 'page_send',
    description: 'Deliver a message to the page session bound to a canonical page URL '
      + '(/apps/<appId>/...). If that url has a live session the message is appended to it '
      + '(waking it to do the work); otherwise a fresh page session is created for the url '
      + 'first and the message is delivered there. Returns { sessionId, url, created, redirected }. '
      + 'This is delivery, not navigation: no GUI switch happens. Cascade is capped — a chain '
      + 'deeper than 4 hops is refused with page/hop-limit. '
      + 'Use session_dispatch when you already know the exact sessionId; use page_send when '
      + 'you know the page URL.',
    parameters: {
      url: { type: 'string', required: true, description: 'Canonical page URL: /apps/<appId>/<path>[/more][?query]' },
      message: { type: 'string', required: true, description: 'The message text delivered to that page session.' },
      wake: { type: 'boolean', description: 'Wake the target agent (one model round). Default true; false only logs the message for the next wake.' },
    },
    output: { schema: { type: 'object', additionalProperties: true } as const, render: renderValue },
    async execute(args, exec) {
      // 调用方会话进链深台账（级联闸门的输入）/ the caller feeds the hop ledger
      const callerSessionId = exec?.agent?.session?.id
      return await port().deliverUrl(args.url, {
        message: args.message,
        ...(args.wake === undefined ? {} : { wake: args.wake }),
        ...(callerSessionId === undefined ? {} : { callerSessionId }),
      })
    },
    presentCall: args => ({ card: 'generic' as const, title: '投递到页面', kind: 'other' as const, ...(args === undefined ? {} : { rawInput: args }) }),
  })
}
