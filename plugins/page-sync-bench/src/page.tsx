/**
 * 任务中心三页面：列表 / 详情 / 发布（TSX 组件 + 事件 + 动态 preset 声明）
 * Task-center pages: list / detail / publish (TSX components + events + dynamic preset)
 *
 * 页面就是可复用的 TSX 组件树；静态面（系统提示词）经 page.preset 动态声明给 DSH preset，
 * 工具/skills 由 preset 挂载的插件行提供；领域事件经 page.events 监听并改上下文/导航。
 */
import { definePage, Data, Keyed, Static } from '@veren/prompt-page'
import { TASKS_PATH } from './store.ts'
import type { PageDefinition } from '@veren/prompt-page'
import type { TaskItem, ToolOutcome } from './types.ts'

/** 页面静态工具（OpenAI function 形状；归 preset 挂载，本包只声明）/ static page tool (preset-mounted) */
export interface PageTool {
  readonly name: string
  readonly description: string
  readonly parameters: Record<string, unknown>
}

/** chat API 用的 OpenAI 格式（由扁平工具派生）/ OpenAI chat format derived from flat tools */
export const LIST_CHAT_TOOLS: {
  type: 'function'
  function: { name: string; description: string; parameters: Record<string, unknown> }
}[] = [
  {
    type: 'function',
    function: {
      name: 'take_task',
      description: '接取一个任务。仅当任务状态为 open 时合法；接取后变为 taken。',
      parameters: { type: 'object', properties: { task_id: { type: 'string', description: '任务 id，如 t-12' } }, required: ['task_id'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'complete_task',
      description: '完成一个任务。仅当任务状态为 taken 时合法；完成后变为 done。',
      parameters: { type: 'object', properties: { task_id: { type: 'string', description: '任务 id，如 t-12' } }, required: ['task_id'] },
    },
  },
]

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

// ---- 列表页（TSX + 事件监听）/ List page (TSX + event listeners) ----

export function TaskListPage({ items }: { items: TaskItem[] }) {
  return (
    <>
      <Static content="任务中心 · 列表页" />
      <Keyed path={TASKS_PATH} items={items} />
    </>
  )
}

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

// ---- 详情页（data 字段块）/ Detail page (data field blocks) ----

export function TaskDetailPage({ taskId, items }: { taskId: string; items: TaskItem[] }) {
  const task = items.find((item) => item.id === taskId)
  return (
    <>
      <Static content={`任务中心 · 详情页 ${taskId}`} />
      <Data path="task.title" value={task?.title ?? null} />
      <Data path="task.status" value={task?.status ?? null} />
      <Data path="task.ownerId" value={task?.ownerId ?? null} />
    </>
  )
}

export const DETAIL_SYSTEM_PROMPT = [
  '你是"任务中心"应用的详情页助手。页面状态通过 SNAPSHOT/PATCH 同步：',
  'SNAPSHOT 的 {"kind":"data","path":"task.title","value":V} 是字段；PATCH 的 {"op":"set","path":P,"value":V} 是字段增量。',
  '按钮：complete_task 完成 taken 任务；abandon_task 放弃 taken 任务（回到 open）。',
].join('\n')

// ---- 发布页（表单：草稿是模型自有的，服务端只收 intent）/ Publish page ----

export function PublishTaskPage({ draftTitle }: { draftTitle: string }) {
  return (
    <>
      <Static content="任务中心 · 发布任务" />
      <Data path="draft.title" value={draftTitle} />
    </>
  )
}

export const PUBLISH_SYSTEM_PROMPT = [
  '你是"任务中心"应用的发布页助手。草稿标题经 SNAPSHOT 的 data 节点展示。',
  '按钮：confirm_publish 确认发布当前草稿（标题非空才合法）。',
].join('\n')

// ---- 页面定义（动态 preset + 事件监听 + URL）/ page definitions (dynamic preset + events + url) ----

export const listPage: PageDefinition<TaskItem[]> = definePage({
  name: 'task-list',
  url: '/task-list',
  description: '任务中心列表页：浏览全部任务，接取/完成任务',
  preset: { systemPrompt: LIST_SYSTEM_PROMPT, order: 10 },
  events: {
    'task.taken': (payload, io) => { io.append(`任务 ${String((payload as { id: string }).id)} 已被接取`) },
    'task.completed': (payload, io) => { io.append(`任务 ${String((payload as { id: string }).id)} 已完成`) },
    'task.abandoned': (payload, io) => { io.append(`任务 ${String((payload as { id: string }).id)} 已放弃`) },
  },
  tree: (_params, items) => <TaskListPage items={items} />,
})

export const detailPage: PageDefinition<TaskItem[]> = definePage({
  name: 'task-detail',
  url: '/task-detail/:taskId',
  description: '任务详情页：查看单个任务的标题/状态/负责人',
  preset: { systemPrompt: DETAIL_SYSTEM_PROMPT, order: 11 },
  tree: (params, items) => <TaskDetailPage taskId={params.taskId ?? ''} items={items} />,
})

export const publishPage: PageDefinition<TaskItem[]> = definePage({
  name: 'publish-task',
  url: '/publish-task',
  description: '发布任务页：填写草稿并确认发布',
  preset: { systemPrompt: PUBLISH_SYSTEM_PROMPT, order: 12 },
  tree: (params) => <PublishTaskPage draftTitle={params.draftTitle ?? ''} />,
})
