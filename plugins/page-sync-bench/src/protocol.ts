/**
 * 字节级稳定的上下文渲染 + 工具协议 / Byte-stable rendering + tool protocol
 */
import type { Snapshot, Sync, ToolOutcome } from './types.ts'

/** 序列化一条任务（字段顺序固定）/ one task with fixed field order */
function renderTask(item: { id: string; title: string; status: string; ownerId: string | null }): string {
  return JSON.stringify({ id: item.id, title: item.title, status: item.status, ownerId: item.ownerId })
}

/** 渲染同步消息（模板骨架固定，只有数据字面量变）/ render a sync message */
export function renderSync(sync: Sync): string {
  if (sync.kind === 'snapshot') {
    return `SNAPSHOT v${sync.version} {"items":[${sync.items.map(renderTask).join(',')}]}`
  }
  const ops = sync.ops.map((change) => change.op === 'remove'
    ? JSON.stringify({ op: 'remove', id: change.id })
    : JSON.stringify({ op: 'upsert', item: change.item }))
  return `PATCH v${sync.fromVersion}->v${sync.toVersion} {"ops":[${ops.join(',')}]}`
}

/** 渲染快照 / render a snapshot */
export function renderSnapshot(snapshot: Snapshot): string {
  return renderSync(snapshot)
}

/** 静态系统提示词：页面不变部分（缓存前缀的核心）/ static system prompt */
export const SYSTEM_PROMPT = [
  '你是"任务中心"应用的列表页助手。页面数据通过用户消息中的 SNAPSHOT/PATCH 消息同步：',
  '- SNAPSHOT vN {"items":[...]} 是版本 N 的完整列表状态，取代之前的一切。',
  '- PATCH vA->vB {"ops":[...]} 是增量：upsert 原位更新或新增，remove 按 id 删除。',
  '你必须在心中维护当前列表状态（按 id 对位合并 ops）。回答状态问题时以最新版本为准。',
  '工具是页面上的按钮：take_task 接取一个 open 状态的任务，complete_task 完成一个 taken 状态的任务。',
  '收到同步消息后，按当轮指令调用工具；完成后用一句话确认。',
].join('\n')

/** take_task 参数 / take_task args */
export interface TakeArgs {
  task_id: string
  owner_id?: string
}

/** OpenAI function 工具表（静态）/ static tool schemas */
export const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'take_task',
      description: '接取一个任务。仅当任务状态为 open 时合法；接取后变为 taken。',
      parameters: {
        type: 'object',
        properties: {
          task_id: { type: 'string', description: '任务 id，如 t-12' },
          owner_id: { type: 'string', description: '接取者 id，缺省为 model' },
        },
        required: ['task_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'complete_task',
      description: '完成一个任务。仅当任务状态为 taken 时合法；完成后变为 done。',
      parameters: {
        type: 'object',
        properties: {
          task_id: { type: 'string', description: '任务 id，如 t-12' },
        },
        required: ['task_id'],
      },
    },
  },
] as const

/** 分发一次工具调用（按钮点击 → 状态迁移）/ dispatch one tool call */
export function dispatchTool(store: { takeTask(id: string, owner: string): ToolOutcome; completeTask(id: string): ToolOutcome }, name: string, argsJson: string): ToolOutcome {
  let args: Record<string, unknown>
  try {
    args = JSON.parse(argsJson) as Record<string, unknown>
  } catch {
    return { ok: false, code: 'bad_arguments', detail: 'arguments are not valid JSON' }
  }
  if (name === 'take_task') {
    if (typeof args.task_id !== 'string') return { ok: false, code: 'bad_arguments', detail: 'task_id required' }
    return store.takeTask(args.task_id, typeof args.owner_id === 'string' ? args.owner_id : 'model')
  }
  if (name === 'complete_task') {
    if (typeof args.task_id !== 'string') return { ok: false, code: 'bad_arguments', detail: 'task_id required' }
    return store.completeTask(args.task_id)
  }
  return { ok: false, code: 'unknown_tool', detail: `unknown tool ${name}` }
}

/** 工具标签：给 DSH 注册用的规范化视图 / tool labels for DSH registration */
export const TOOLS_LABELS = TOOLS.map((tool) => ({
  name: tool.function.name,
  description: tool.function.description,
  parameters: tool.function.parameters as Record<string, unknown>,
  title: tool.function.name === 'take_task' ? '接取任务' : '完成任务',
}))
