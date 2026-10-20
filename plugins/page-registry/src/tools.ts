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
import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-tools'

/** app_open 需要的最小服务面 / the minimal service face app_open needs */
export interface AppOpenPort {
  openUrl(url: string, options?: { taskId?: string }): Promise<{ sessionId: string; title: string }>
}



/** 目录返回值渲染成 JSON 文本 / render the open result as JSON text */
function renderValue(_args: unknown, value: unknown): ContentBlock[] {
  return [{ type: 'text', text: JSON.stringify(value) }] as ContentBlock[]
}

/**
 * 注册 `app_open` 到给定工具注册表；返回的 effect 卸载时逆序摘除。
 * 工具注册表由调用方（声明了 `inject: ['tools']` 的插件）作为参数传入（G13
 * 规则 2）：本函数不摸 ctx 上的兄弟服务，也没有"缺席即告警"的降级分支——
 * 注册表不在场是装配错误，直接 fail loud。
 * Register `app_open` into the given tool registry; the effect disposes it in
 * reverse on unload. The registry arrives as a parameter from a plugin that
 * declares `inject: ['tools']` (G13 rule 2): no sibling probing, and a missing
 * registry is a misconfiguration that fails loud instead of warn-and-skip.
 * @param ctx - 宿主上下文（effect 挂载）/ host context (effect mounting)
 * @param tools - 注入的工具注册表 / the injected tool registry
 * @param port - 解析 openUrl 服务面 / resolves the service surface
 */
export function registerAppOpenTool(ctx: Context, tools: Context['tools'], port: () => AppOpenPort): void {
  ctx.effect(() => tools.register(defineTool({
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
  })), 'page-registry:app_open')
}
