/**
 * 队列工具定义（§3.10.1 矩阵的队列半边）：list/take/complete/abandon/publish/
 * requeue。本文件只声明（defineTool 本体），动作体在 actions-queue.ts。
 * The queue tool definitions (the matrix's queue half): list/take/complete/
 * abandon/publish/requeue. This file only declares (defineTool bodies); the
 * action bodies live in actions-queue.ts.
 * @module @veren/task-workbench
 */
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { abandonTaskAction, completeTaskAction, listTasksView, publishTaskAction, requeueTaskAction, takeTaskAction } from './actions-queue.ts'
import type { QueuePorts } from './actions-queue.ts'
import { presentTaskCall } from './actions.ts'

/** 工具结果渲染成 JSON 文本（模型可读，UI 通用卡片）/ render outcomes as JSON text */
export function renderValue(_args: unknown, value: unknown): ContentBlock[] {
  return [{ type: 'text', text: JSON.stringify(value) }] as ContentBlock[]
}

/** 把结果规整成输出 schema 要求的无损 JSON 对象 / normalize outcomes to the output schema's JSON object */
export function asJson(value: unknown): Record<string, never> {
  return JSON.parse(JSON.stringify(value)) as Record<string, never>
}

/** 队列工具共享的 task_id 参数 / the shared task_id parameter */
const TASK_ID_PARAM = { task_id: { type: 'string', description: '工作单 id 或任务记录 id，如 t-3 / work-order or record id, e.g. t-3', required: true } } as const

/** 构造队列工具（§3.10.1 矩阵扩展表的队列半边）/ build the queue tools (the matrix table's queue half) */
export function createQueueTools(ports: QueuePorts): ReturnType<typeof defineTool>[] {
  return [
    listTasksTool(ports),
    takeTaskTool(ports),
    completeTaskTool(ports),
    abandonTaskTool(ports),
    publishTaskTool(ports),
    requeueTaskTool(ports),
  ]
}

/** list_tasks 定义：只读盘点 / the list_tasks definition: read-only inventory */
function listTasksTool(ports: QueuePorts): ReturnType<typeof defineTool> {
  return defineTool({
    name: 'list_tasks',
    description: '只读盘点：策略视图——每条工作单带 lane（takeable/dispatched/held/completed/returned/stale）、'
      + '等待时长、是否需确认，外加跨应用目录（来源 = 注册表）。不改动任何状态；正文快照过时后以本工具返回为准。'
      + 'Read-only inventory: the strategy view — each order with its lane, wait time and needs-confirmation flag, '
      + 'plus the cross-app catalog (source = the registry). Changes nothing.',
    parameters: {},
    output: { schema: { type: 'object', additionalProperties: true } as const, render: renderValue },
    execute: async () => asJson(listTasksView(ports, await ports.channel.list())),
    presentCall: () => presentTaskCall('盘点任务'),
  })
}

/** take_task 定义：中心租约接取 / the take_task definition: a center-leased take */
function takeTaskTool(ports: QueuePorts): ReturnType<typeof defineTool> {
  return defineTool({
    name: 'take_task',
    description: '接取一个 takeable 工作单：中心接 30 分钟租约（他人持有返回 task/already-taken）。'
      + '仅在本回合同意内合法（用户点名，或投递指令点名该任务）；browse 模式先 drive_begin。'
      + 'Take a takeable order with a 30-minute center lease. Legal only within this turn\'s consent '
      + '(user-named, or named by a delivery); call drive_begin first in browse mode.',
    parameters: TASK_ID_PARAM,
    output: { schema: { type: 'object', additionalProperties: true } as const, render: renderValue },
    execute: async (args, exec) => asJson(await takeTaskAction(ports, exec, args)),
    presentCall: args => presentTaskCall('接取任务', args),
  })
}

/** complete_task 定义：本会话接取的单完成 / the complete_task definition: complete an order this session holds */
function completeTaskTool(ports: QueuePorts): ReturnType<typeof defineTool> {
  return defineTool({
    name: 'complete_task',
    description: '完成一个本会话接取（taken）的工作单：summary 必填一句话结果；子树还有非终态后代时由任务中心拒绝'
      + '（task/children-active）。仅在本回合同意内合法。'
      + 'Complete a taken order your session holds: a one-sentence summary is required; the center refuses while '
      + 'the subtree still has non-terminal descendants. Legal only within this turn\'s consent.',
    parameters: {
      ...TASK_ID_PARAM,
      summary: { type: 'string', description: '一句话结果 / one-sentence outcome', required: true },
    },
    output: { schema: { type: 'object', additionalProperties: true } as const, render: renderValue },
    execute: async (args, exec) => asJson(await completeTaskAction(ports, exec, args)),
    presentCall: args => presentTaskCall('完成任务', args),
  })
}

/** abandon_task 定义：放弃本会话接取的单 / the abandon_task definition: release an order this session holds */
function abandonTaskTool(ports: QueuePorts): ReturnType<typeof defineTool> {
  return defineTool({
    name: 'abandon_task',
    description: '放弃一个本会话接取（taken）的工作单：中心 release，回 open 队列。仅在本回合同意内合法。'
      + 'Release a taken order back to the open queue via the center. Legal only within this turn\'s consent.',
    parameters: TASK_ID_PARAM,
    output: { schema: { type: 'object', additionalProperties: true } as const, render: renderValue },
    execute: async (args, exec) => asJson(await abandonTaskAction(ports, exec, args)),
    presentCall: args => presentTaskCall('放弃任务', args),
  })
}

/** publish_task 定义：发布新工作单 / the publish_task definition: publish a new work order */
function publishTaskTool(ports: QueuePorts): ReturnType<typeof defineTool> {
  return defineTool({
    name: 'publish_task',
    description: '发布一个新工作单：target_app 缺省 = 本应用详情页；给定 target_app 时从注册表目录校验'
      + '（entry 页为落点，带 :param 的页拒绝 dispatch/target-invalid）。幂等键去重，发布即进任务中心队列。'
      + 'Publish a new work order: target_app defaults to this app\'s detail page; a given target_app is validated '
      + 'against the registry catalog (the entry page is the landing spot; :param pages refuse).',
    parameters: {
      title: { type: 'string', description: '任务标题 / task title', required: true },
      body: { type: 'string', description: '可选说明 / optional details' },
      target_app: { type: 'string', description: '目标应用 id（注册表目录里查） / target app id from the registry catalog' },
      page: { type: 'string', description: '目标页键（缺省 = 该应用 entry） / target page key (default = the app entry)' },
    },
    output: { schema: { type: 'object', additionalProperties: true } as const, render: renderValue },
    execute: async (args, exec) => asJson(await publishTaskAction(ports, exec, args)),
    presentCall: args => presentTaskCall('发布任务', args),
  })
}

/** requeue_task 定义：退回/改派 / the requeue_task definition: return/re-file an order */
function requeueTaskTool(ports: QueuePorts): ReturnType<typeof defineTool> {
  return defineTool({
    name: 'requeue_task',
    description: '退回/改派一个工作单：failed/orphaned（returned lane）回 open 队列，open 的本地单改派到'
      + ' target_app；先发新记录再撤销旧载体（两步一致性）。taken/completed 的单拒绝。'
      + 'Return/re-file an order: failed/orphaned goes back to the open queue; an open local order can be re-filed '
      + 'to a target_app. The new record is sent before the old vehicle is cancelled.',
    parameters: {
      ...TASK_ID_PARAM,
      target_app: { type: 'string', description: '缺省回本应用；给定则改派到该应用 / default back to this app; a value re-files there' },
      page: { type: 'string', description: '目标页键（缺省 = entry） / target page key (default = entry)' },
    },
    output: { schema: { type: 'object', additionalProperties: true } as const, render: renderValue },
    execute: async (args, exec) => asJson(await requeueTaskAction(ports, exec, args)),
    presentCall: args => presentTaskCall('退回/改派任务', args),
  })
}
