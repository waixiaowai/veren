/**
 * DSH 插件入口：把任务中心页面的工具（按钮）注册进挂载作用域。
 * DSH plugin entry: registers task-center page tools (buttons) into the mounting scope.
 *
 * 页面 = 会话：静态面（系统提示词/工具/skills）归 DSH preset；页面经 PageRegistry 以唯一 URL 注册，
 * 导航 = resolve(url) → mountPage 开新会话 + 指针注入；业务完成后插件主动归档会话。
 * @module @veren/page-sync-bench
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { PageRegistry, mountPage } from '@veren/prompt-page'
import { detailPage, dispatchTaskTool, listPage, publishPage } from './page.ts'
import type { PageTool } from './page.ts'
import { TaskStore, makeList } from './store.ts'
import type { TaskItem } from './types.ts'

export const name = 'tool-page-sync-bench'

/** 配置：列表大小 / config: initial list size */
export interface Config {
  listSize: number
}
export const Config: z<Config> = z.object({
  listSize: z.number().default(150).description('初始任务数量 / initial number of tasks'),
})

export const inject = ['tools']
export const provide = []

/** 渲染工具输出为模型内容 / render tool output as model content */
function renderValue(_args: unknown, value: unknown): ContentBlock[] {
  return [{ type: 'text', text: JSON.stringify(value) }]
}

/**
 * 注册任务中心工具；同一作用域共享一份 store + 页面注册表（页面状态在 LLM 之外）。
 * Register task-center tools; one store + page registry per scope (page state lives outside the LLM).
 */
export function apply(ctx: Context, config: Config): void {
  const store = new TaskStore(makeList(config.listSize))
  const registry = new PageRegistry<TaskItem[]>()
  for (const page of [listPage, detailPage, publishPage]) registry.register(page)

  let active = mountPage({ page: listPage, store })

  /** 打开页面 URL：关旧会话 + mountPage 新会话（状态在 store，不丢）*/
  function openUrl(url: string): { page: string; pointer: string; snapshot: string } {
    const match = registry.resolve(url)
    if (match === null) throw new Error(`[page-sync-bench] unknown page url: ${url}`)
    active.unsubscribe()
    active = mountPage({ page: match.page, store, params: match.params })
    return { page: active.page.name, pointer: active.pointerMessage, snapshot: active.syncText() }
  }

  ctx.effect(() => {
    const pageTools = [...listTools, ...detailTools, ...publishTools]
    const disposers = pageTools.map((tool) => ctx.tools.register(defineTool({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters as never,
      output: {
        schema: { type: 'object', additionalProperties: true } as const,
        render: renderValue,
      },
      async execute(args: Record<string, unknown>) {
        return dispatchTaskTool(store, tool.name, JSON.stringify(args))
      },
      presentCall: () => ({ card: 'generic' as const, title: tool.name, kind: 'other' as const }),
    })))
    // 页面目录：给模型看的入口清单 / page catalog for the model
    disposers.push(ctx.tools.register(defineTool({
      name: 'page_catalog',
      description: '列出全部已注册页面（name/url/description）。List every registered page.',
      parameters: {},
      output: {
        schema: { type: 'object', additionalProperties: true } as const,
        render: renderValue,
      },
      async execute() {
        return {
          pages: registry.catalog().map((entry) => ({ name: entry.name, url: entry.url, description: entry.description })),
          active: active.page.name,
        }
      },
      presentCall: () => ({ card: 'generic' as const, title: '页面目录', kind: 'read' as const }),
    })))
    // 同步工具：模型可主动拉当前页面增量 / model-driven sync for the active page
    disposers.push(ctx.tools.register(defineTool({
      name: 'sync_page',
      description: '拉取当前页面自给定版本后的增量补丁；不传版本号返回全量快照。'
        + 'Fetch the active page delta since a version, or a full snapshot without one.',
      parameters: {
        since_version: { type: 'number', description: '已知的最后版本号（首次不传）/ last known version' },
      },
      output: {
        schema: { type: 'object', additionalProperties: true } as const,
        render: renderValue,
      },
      async execute(args: { since_version?: number }) {
        return { page: active.page.name, message: active.syncText(args.since_version), version: active.version }
      },
      presentCall: () => ({ card: 'generic' as const, title: '同步当前页面', kind: 'read' as const }),
    })))
    // 导航工具：resolve(url) → 开新页面会话 / navigation: resolve a url and mount
    disposers.push(ctx.tools.register(defineTool({
      name: 'open_page',
      description: '打开一个页面 URL（关闭当前页面会话，路径参数+query 注入指针）。'
        + 'Open a page url (closes the active page-session; path params + query become the pointer).',
      parameters: {
        url: { type: 'string', required: true, description: '页面 URL，如 /task-detail/t-12?focus=chat' },
      },
      output: {
        schema: { type: 'object', additionalProperties: true } as const,
        render: renderValue,
      },
      async execute(args: Record<string, unknown>) {
        return openUrl(String(args.url))
      },
      presentCall: () => ({ card: 'generic' as const, title: '打开页面', kind: 'other' as const }),
    })))
    return () => { for (const dispose of disposers.reverse()) dispose() }
  }, 'page-sync-bench:register')
}

/** 三个页面的工具清单（页面工具归 preset 挂载，这里仅声明）/ flat tool lists of the three pages */
const listTools: PageTool[] = [
  { name: 'take_task', description: '接取一个任务。仅当任务状态为 open 时合法。', parameters: taskParam() },
  { name: 'complete_task', description: '完成一个任务。仅当任务状态为 taken 时合法。', parameters: taskParam() },
]
const detailTools: PageTool[] = [
  { name: 'complete_task', description: '完成一个任务。仅当任务状态为 taken 时合法。', parameters: taskParam() },
  { name: 'abandon_task', description: '放弃一个任务。仅当任务状态为 taken 时合法；回到 open。', parameters: taskParam() },
]
const publishTools: PageTool[] = [
  { name: 'confirm_publish', description: '确认发布当前草稿任务。', parameters: { type: 'object', properties: {} } },
]

function taskParam(): Record<string, unknown> {
  return { type: 'object', properties: { task_id: { type: 'string', description: '任务 id，如 t-12' } }, required: ['task_id'] }
}
