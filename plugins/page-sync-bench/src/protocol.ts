/**
 * 工具协议 + 系统提示词（页面静态面）/ Tool protocol + system prompt (page static face)
 * 消息模板统一来自 @veren/page-sync-core（字节稳定）。
 */
import type { PromptNode } from '@veren/page-sync-core'
import { renderSync } from '@veren/page-sync-core'
import { TASKS_PATH } from './store.ts'
import type { TaskItem, ToolOutcome } from './types.ts'

export { renderSync }

/** 静态系统提示词：页面不变部分（缓存前缀的核心）/ static system prompt */
export const SYSTEM_PROMPT = [
  '你是"任务中心"应用的列表页助手。页面状态通过用户消息中的 SNAPSHOT/PATCH 同步：',
  '- SNAPSHOT vN {"nodes":[...]} 携带完整状态树，取代之前的一切；',
  '  其中 {"kind":"keyed","path":"tasks","items":[...]} 是任务集合，条目按 id 对位。',
  '- PATCH vA->vB {"ops":[...]} 是增量：',
  '  {"op":"splice","path":"tasks","id":X,"entity":{...}} 按 id 新增或更新条目；',
  '  {"op":"splice","path":"tasks","id":X}（无 entity）按 id 删除；',
  '  {"op":"set","path":P,"value":V} 更新子树；{"op":"append","path":P,"entries":[...]} 追加日志。',
  '你必须在心中按 id 维护当前任务状态。回答状态问题时以最新版本为准。',
  '工具是页面上的按钮：take_task 接取一个 open 状态的任务，complete_task 完成一个 taken 状态的任务。',
  '收到同步消息后，按当轮指令调用工具；完成后用一句话确认。',
].join('\n')

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

/** 测试辅助：从快照树中取出任务集合 / test helper: unwrap the task collection from a snapshot tree */
export function itemsOfSnapshot(nodes: PromptNode[]): TaskItem[] {
  const node = nodes.find((candidate) => candidate.kind === 'keyed' && candidate.path === TASKS_PATH)
  return node?.kind === 'keyed' ? (node.items as TaskItem[]) : []
}
