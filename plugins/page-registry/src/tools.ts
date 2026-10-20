/**
 * `app_open` 宿主工具：模型侧打开一个页面 URL 的唯一入口（§3.4、附录 A）。
 * The `app_open` host tool: the model-side entry to open a page url.
 *
 * 全局工具（不带应用前缀）；页面工具永远不叫这个名字。用 `defineTool` 产出
 * DSH `ToolDefinition` 后原样 `ctx.tools.register`，零形状转换。打开动作发生
 * 在目标会话上：命中恢复、未命中创建；当前会话的页面、工具、历史一律不动。
 * 失败码来自 PageErrorCode（app/not-found、app/disabled、page/stale、
 * page/not-found、task/expired…），原样透出给模型。
 *
 * @module @veren/page-registry/tools
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-tools'

/** app_open 需要的最小服务面 / the minimal service face app_open needs */
export interface AppOpenPort {
  openUrl(url: string, options?: { taskId?: string }): Promise<{ sessionId: string; created: boolean; title: string }>
}



/** 目录返回值渲染成 JSON 文本 / render the open result as JSON text */
function renderValue(_args: unknown, value: unknown): ContentBlock[] {
  return [{ type: 'text', text: JSON.stringify(value) }] as ContentBlock[]
}

/**
 * 注册 `app_open` 到挂载作用域的工具注册表；返回的 effect 卸载时逆序摘除。
 * @param ctx - 宿主上下文（读 `tools` 注册表）/ host context
 * @param port - 解析 openUrl 服务面 / resolves the service surface
 */
export function registerAppOpenTool(ctx: Context, port: () => AppOpenPort): void {
  // ctx.get('tools') 的返回类型来自 declaration merging 的真实服务面，零断言。
  // ctx.get('tools') is typed by the declared service face — no casts.
  const registry = ctx.get('tools')
  if (registry?.register === undefined) {
    ctx.logger.warn('page-registry: no "tools" registry; app_open is not registered')
    return
  }
  ctx.effect(() => registry.register(defineTool({
    name: 'app_open',
    description: 'Open an application page URL (for example /apps/review-workbench/task/1) or take a task '
      + 'with taskId. It returns the page session the url maps to: an existing session is resumed and focused, '
      + 'a missing one is created with the page\u2019s tools mounted. Your own session, tools, and history never change. '
      + 'Failures carry stable codes: app/not-found, app/disabled, page/not-found, page/stale, task/expired.',
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
