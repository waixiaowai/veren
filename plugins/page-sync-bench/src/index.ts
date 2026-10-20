/**
 * DSH 插件入口：把任务列表页的工具（按钮）注册进挂载作用域。
 * DSH plugin entry: registers the task-list-page tools (buttons) into the mounting scope.
 *
 * 页面 = 会话：系统提示词与工具静态；页面状态在 store（LLM 之外），
 * 经 prompt-core 调度、MessageHost 提交为 SNAPSHOT/PATCH 消息流。
 * @module @veren/page-sync-bench
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { createRoot, bindStore } from '@veren/prompt-core'
import { MessageHost, renderSync } from '@veren/prompt-host-messages'
import { TOOLS_LABELS, TaskListPage, dispatchTool } from './page.ts'
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
 * 注册任务页工具；同一作用域共享一份 store/host（页面状态在 LLM 之外）。
 * Register page tools; one store/host per scope (page state lives outside the LLM).
 */
export function apply(ctx: Context, config: Config): void {
  const store = new TaskStore(makeList(config.listSize))
  const host = new MessageHost()
  const root = createRoot(host)
  bindStore<TaskItem[]>(root, store, (items) => TaskListPage({ items }))

  ctx.effect(() => {
    const disposers = TOOLS_LABELS.map((label) => ctx.tools.register(defineTool({
      name: label.name,
      description: label.description,
      parameters: label.parameters as never,
      output: {
        schema: { type: 'object', additionalProperties: true } as const,
        render: renderValue,
      },
      async execute(args: Record<string, unknown>) {
        return dispatchTool(store, label.name, JSON.stringify(args))
      },
      presentCall: () => ({ card: 'generic' as const, title: label.title, kind: 'other' as const }),
    })))
    // 同步工具：模型可主动拉增量 / model-driven sync tool
    disposers.push(ctx.tools.register(defineTool({
      name: 'sync_tasks',
      description: '按版本号拉取任务列表增量补丁；不传版本号返回全量快照。'
        + 'Fetch the task-list delta since a version, or a full snapshot without one.',
      parameters: {
        since_version: { type: 'number', description: '已知的最后版本号（首次不传）/ last known version' },
      },
      output: {
        schema: { type: 'object', additionalProperties: true } as const,
        render: renderValue,
      },
      async execute(args: { since_version?: number }) {
        const sync = host.renderSince(args.since_version)
        return { message: renderSync(sync), version: host.currentVersion }
      },
      presentCall: () => ({ card: 'generic' as const, title: '同步任务列表', kind: 'read' as const }),
    })))
    return () => { for (const dispose of disposers.reverse()) dispose() }
  }, 'page-sync-bench:register')
}
