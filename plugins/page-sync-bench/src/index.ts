/**
 * DSH 插件入口：任务中心页面套件（动态 preset 声明 + 页面事件 + 上下文注入）。
 * DSH plugin entry: the task-center page suite (dynamic presets + page events + context injection).
 *
 * 三种角色（config.role，同一插件包被 preset 以不同 config 复用）：
 * - composition（顶层）：注册页面注册表 + 动态注册三个页面 preset（ctx.agentPresets，不用 yml）
 * - tools（preset 子行）：注册页面按钮（工具）
 * - context（preset 子行，会话挂载激活）：bindStore + pre-step 把页面增量 append 进上下文 + 事件监听
 *
 * 参考 person-agent-preset / person-agent-dynamic-context 的机制。
 * @module @veren/page-sync-bench
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import z from '@deepseek-ai/schemastery'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import { PageRegistry, buildPagePreset, mountPage } from '@veren/prompt-page'
import { renderSync } from '@veren/prompt-host-messages'
import { detailPage, dispatchTaskTool, listPage, LIST_CHAT_TOOLS, publishPage } from './page.tsx'
import { TaskStore, makeList } from './store.ts'
import type { TaskItem } from './types.ts'

export const name = 'tool-page-sync-bench'

/** 页面同步消息的来源标识 / source kind of page-sync messages */
export const SOURCE = 'page-sync-bench'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'page-sync-bench': { kind: 'page-sync-bench' }
  }
}

export interface Config {
  listSize: number
  /** 角色选择（运行时窄化）/ role (narrowed at runtime) */
  role: string
  /** context 角色：挂载哪个页面 */
  page: string
}

export const Config: z<Config> = z.object({
  listSize: z.number().default(150).description('初始任务数量 / initial number of tasks'),
  role: z.string().default('composition').description('插件角色：composition | tools | context / plugin role'),
  page: z.string().default('task-list').description('context 角色挂载的页面名 / page name for the context role'),
})

export const inject = ['tools', 'agentPresets']
export const provide = []

/** 渲染工具输出为模型内容 / render tool output as model content */
function renderValue(_args: unknown, value: unknown): ContentBlock[] {
  return [{ type: 'text', text: JSON.stringify(value) }]
}

/** 页面运行时（composition 作用域创建，context 作用域消费；同进程共享）*/
const pageRuntime: {
  store?: TaskStore
  registry?: PageRegistry<TaskItem[]>
} = {}

export const apply = async (ctx: Context, config: Config): Promise<void> => {
  if (config.role === 'tools') return applyTools(ctx)
  if (config.role === 'context') return applyContext(ctx, config)
  return applyComposition(ctx, config)
}

/** 顶层：注册表 + 动态注册三个页面 preset / top-level: registry + dynamic preset registration */
async function applyComposition(ctx: Context, config: Config): Promise<void> {
  const store = new TaskStore(makeList(config.listSize))
  const registry = new PageRegistry<TaskItem[]>()
  for (const page of [listPage, detailPage, publishPage]) registry.register(page)
  pageRuntime.store = store
  pageRuntime.registry = registry

  const selfName = 'tool-page-sync-bench'
  for (const page of [listPage, detailPage, publishPage]) {
    const preset = buildPagePreset(page, {
      toolRows: [{ id: 'task-tools', name: selfName, config: { role: 'tools', listSize: config.listSize } }],
      contextRowName: selfName,
      contextRowConfig: { listSize: config.listSize },
    })
    const unregister = await ctx.agentPresets.register(preset)
    ctx.effect(() => unregister, `page-preset:${page.name}`)
  }
  registerPageTools(ctx, store)
}

/** tools 子行：注册页面按钮 / tools row: register the page buttons */
function applyTools(ctx: Context): void {
  const store = pageRuntime.store ?? new TaskStore(makeList(150))
  registerPageTools(ctx, store)
}

function registerPageTools(ctx: Context, store: TaskStore): void {
  const tools = [...LIST_CHAT_TOOLS.map((chat) => chat.function), {
    name: 'abandon_task',
    description: '放弃一个任务。仅当任务状态为 taken 时合法；回到 open。',
    parameters: { type: 'object', properties: { task_id: { type: 'string', description: '任务 id，如 t-12' } }, required: ['task_id'] },
  }, {
    name: 'confirm_publish',
    description: '确认发布当前草稿任务。',
    parameters: { type: 'object', properties: {} },
  }]
  ctx.effect(() => {
    const disposers = tools.map((tool) => ctx.tools.register(defineTool({
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
    return () => { for (const dispose of disposers.reverse()) dispose() }
  }, 'page-sync-bench:tools')
}

/** context 子行（会话挂载激活）：bindStore + pre-step 注入增量 + 事件监听 */
function applyContext(ctx: Context, config: Config): void {
  const store = pageRuntime.store
  const registry = pageRuntime.registry
  const page = registry?.get(config.page)
  if (store === undefined || registry === undefined || page === undefined) {
    // misconfiguration fails loud：composition 角色必须先挂载
    throw new Error(`[page-sync-bench] context role requires composition mounted first (page: ${config.page})`)
  }

  const session = mountPage({ page, store })
  const eventsDisposers = Object.entries(page.events ?? {}).map(([event, handler]) =>
    store.events.on(event, (payload) => {
      handler(payload, {
        append: (text) => session.host.note(text),
        navigate: (url) => session.host.note(`NAVIGATE ${url}`),
      })
    }))

  let delivered: number | undefined
  ctx.on('agent/pre-step', async ({ agent, signal }: { agent: Agent; signal: AbortSignal }, next: () => Promise<PreStepDecision>) => {
    const decision = await next()
    if (decision.kind !== 'enter' || signal.aborted) return decision
    const sync = session.host.renderSince(delivered)
    delivered = session.host.currentVersion
    if (sync.kind === 'patch' && sync.ops.length === 0) return decision
    const keep = decision
    return {
      kind: 'enter',
      messages: [...keep.messages, createUserMessage({
        content: [{ type: 'text', text: renderSync(sync) }],
        source: { kind: SOURCE },
      })],
    }
  }, { prepend: true })

  ctx.effect(() => () => {
    for (const dispose of eventsDisposers.reverse()) dispose()
    session.unsubscribe()
  }, 'page-sync-bench:context')
}
