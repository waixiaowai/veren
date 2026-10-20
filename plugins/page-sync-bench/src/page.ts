/**
 * 任务中心三页面：列表 / 详情 / 发布（组件 + 静态面 + 页面定义）
 * Task-center pages: list / detail / publish (components + static faces + page definitions)
 *
 * 页面就是组件树；静态面（提示词/工具）构成会话可缓存前缀。
 */
import { createElement, memo } from '@veren/prompt-core'
import { definePage } from '@veren/prompt-page'
import { TASKS_PATH } from './store.ts'
import type { PageDefinition } from '@veren/prompt-page'
import type { TaskItem, ToolOutcome } from './types.ts'

/** 页面静态工具（OpenAI function 形状；归 preset 挂载，本包只声明）/ static page tool (preset-mounted) */
export interface PageTool {
  readonly name: string
  readonly description: string
  readonly parameters: Record<string, unknown>
}

// ---- 静态工具表（扁平 PageTool，chat 格式按需派生）/ flat tools, chat format derived ----

const takeTaskTool: PageTool = {
  name: 'take_task', description: '接取一个任务。仅当任务状态为 open 时合法；接取后变为 taken。',
  parameters: { type: 'object', properties: { task_id: { type: 'string', description: '任务 id，如 t-12' } }, required: ['task_id'] },
}
const completeTaskTool: PageTool = {
  name: 'complete_task', description: '完成一个任务。仅当任务状态为 taken 时合法；完成后变为 done。',
  parameters: { type: 'object', properties: { task_id: { type: 'string', description: '任务 id，如 t-12' } }, required: ['task_id'] },
}
const abandonTaskTool: PageTool = {
  name: 'abandon_task', description: '放弃一个任务。仅当任务状态为 taken 时合法；放弃后回到 open。',
  parameters: { type: 'object', properties: { task_id: { type: 'string', description: '任务 id，如 t-12' } }, required: ['task_id'] },
}
const confirmPublishTool: PageTool = {
  name: 'confirm_publish', description: '确认发布当前草稿任务。仅当草稿标题非空时合法。',
  parameters: { type: 'object', properties: {} },
}

/** chat API 用的 OpenAI 格式（由扁平工具派生）/ OpenAI chat format derived from flat tools */
export const LIST_CHAT_TOOLS = [takeTaskTool, completeTaskTool].map((tool) => ({ type: 'function' as const, function: tool }))

/** 分发任务按钮（列表/详情共用；先判工具名，再判参数）/ dispatch task buttons (tool name checked first) */
export function dispatchTaskTool(store: { takeTask(id: string, owner: string): ToolOutcome; completeTask(id: string): ToolOutcome; abandonTask(id: string): ToolOutcome }, name: string, argsJson: string): ToolOutcome {
  const handlers: Record<string, (id: string, owner: string) => ToolOutcome> = {
    take_task: (id, owner) => store.takeTask(id, owner),
    complete_task: (id) => store.completeTask(id),
    abandon_task: (id) => store.abandonTask(id),
  }
  const handler = handlers[name]
  if (handler === undefined) return { ok: false, code: 'unknown_tool', detail: `unknown tool ${name}` }
  let args: Record<string, unknown>
  try {
    args = JSON.parse(argsJson) as Record<string, unknown>
  } catch {
    return { ok: false, code: 'bad_arguments', detail: 'arguments are not valid JSON' }
  }
  const id = args.task_id
  if (typeof id !== 'string') return { ok: false, code: 'bad_arguments', detail: 'task_id required' }
  return handler(id, typeof args.owner_id === 'string' ? args.owner_id : 'model')
}

// ---- 列表页 / List page ----

export const TaskListPage = memo((props: { items: TaskItem[] }) => [
  createElement('static', { content: '任务中心 · 列表页' }),
  ...props.items.map((task) => createElement('item', { key: task.id, path: TASKS_PATH, value: task })),
])

export const LIST_SYSTEM_PROMPT = [
  '你是"任务中心"应用的列表页助手。页面状态通过用户消息中的 SNAPSHOT/PATCH 同步：',
  '- SNAPSHOT vN {"nodes":[...]} 携带完整状态树，取代之前的一切；',
  '  其中 {"kind":"keyed","path":"tasks","items":[...]} 是任务集合，条目按 id 对位。',
  '- PATCH vA->vB {"ops":[...]} 是增量：',
  '  {"op":"splice","path":"tasks","id":X,"entity":{...}} 按 id 新增或更新条目；',
  '  {"op":"splice","path":"tasks","id":X}（无 entity）按 id 删除。',
  '你必须在心中按 id 维护当前任务状态。回答状态问题时以最新版本为准。',
  '工具是页面上的按钮：take_task 接取一个 open 状态的任务，complete_task 完成一个 taken 状态的任务。',
  '收到同步消息后，按当轮指令调用工具；完成后用一句话确认。',
].join('\n')

// ---- 详情页 / Detail page ----

export const TaskDetailPage = memo((props: { taskId: string; items: TaskItem[] }) => {
  const task = props.items.find((item) => item.id === props.taskId)
  return [
    createElement('static', { content: `任务中心 · 详情页 ${props.taskId}` }),
    createElement('data', { key: 'title', path: 'task.title', value: task?.title ?? null }),
    createElement('data', { key: 'status', path: 'task.status', value: task?.status ?? null }),
    createElement('data', { key: 'ownerId', path: 'task.ownerId', value: task?.ownerId ?? null }),
  ]
})

export const DETAIL_SYSTEM_PROMPT = [
  '你是"任务中心"应用的详情页助手。页面状态通过 SNAPSHOT/PATCH 同步：',
  'SNAPSHOT 的 {"kind":"data","path":"task.title","value":V} 是字段；PATCH 的 {"op":"set","path":P,"value":V} 是字段增量。',
  '按钮：complete_task 完成 taken 任务；abandon_task 放弃 taken 任务（回到 open）。',
].join('\n')

// ---- 发布页 / Publish page（表单：草稿是模型自有的，服务端只收 intent）----

export const PublishTaskPage = memo((props: { draftTitle: string }) => [
  createElement('static', { content: '任务中心 · 发布任务' }),
  createElement('data', { key: 'draft', path: 'draft.title', value: props.draftTitle }),
])

export const PUBLISH_SYSTEM_PROMPT = [
  '你是"任务中心"应用的发布页助手。草稿标题经 SNAPSHOT 的 data 节点展示。',
  '按钮：confirm_publish 确认发布当前草稿（标题非空才合法）。',
].join('\n')

// ---- 页面定义（路由表用）/ page definitions for the router ----

export const listPage: PageDefinition<TaskItem[]> = definePage({
  name: 'task-list',
  url: '/task-list',
  description: '任务中心列表页：浏览全部任务，接取/完成任务',
  tree: (_params, items) => TaskListPage({ items }),
})

export const detailPage: PageDefinition<TaskItem[]> = definePage({
  name: 'task-detail',
  url: '/task-detail/:taskId',
  description: '任务详情页：查看单个任务的标题/状态/负责人',
  tree: (params, items) => TaskDetailPage({ taskId: params.taskId ?? '', items }),
})

export const publishPage: PageDefinition<TaskItem[]> = definePage({
  name: 'publish-task',
  url: '/publish-task',
  description: '发布任务页：填写草稿并确认发布',
  tree: (params) => PublishTaskPage({ draftTitle: params.draftTitle ?? '' }),
})
