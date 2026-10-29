/**
 * 页面作用域工具定义（§3.10.1 矩阵的页面半边）：get_page_task / take_page_task
 * / split_task。接取天然限定在"本页那条"（URL 里已有 taskId，无参数可伪造），
 * 防抢由任务中心租约承担。动作体在 actions.ts。
 * The page-scoped tool definitions (the matrix's page half): get_page_task /
 * take_page_task / split_task. The take is naturally scoped to "this page's
 * task" (the url carries the taskId; no forgeable parameter); anti-contention
 * belongs to the center's lease. Action bodies live in actions.ts.
 * @module @veren/task-workbench
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { getPageTask, splitTask, takePageTask } from './actions.ts'
import { asJson, renderValue } from './tools-queue.ts'
import { presentTaskCall } from './actions.ts'
import type { PageTaskScope, ToolCallContext } from './types.ts'
import type { ConsentBook, DriveLedger } from './consent.ts'
import type { TaskChannel } from './channel.ts'
import type { TaskStore } from './store.ts'

/** 页面工具的端口（动作体的纯参数面）/ the page tools' ports (the action bodies' pure-parameter face) */
export interface PageToolPorts {
  readonly store: TaskStore
  readonly channel: TaskChannel
  readonly scope: PageTaskScope
  readonly book: ConsentBook
  readonly ledger: DriveLedger
}

/** 构造页面作用域工具 / build the page-scoped tools */
export function createPageTools(ports: PageToolPorts): ReturnType<typeof defineTool>[] {
  return [
    defineTool({
      name: 'get_page_task',
      description: '只读读取本页对应那条任务的当前字段与子任务树（详情页专用，无需参数：读的就是 params.taskId 这条）。'
        + '不改动任何状态；被投递来的盘点/询问类请求用本工具回答。'
        + 'Read-only view of this page\'s current task fields and subtree (detail page, no arguments). Changes nothing.',
      parameters: {},
      output: { schema: { type: 'object', additionalProperties: true } as const, render: renderValue },
      execute: async (_args, exec) => asJson(await getPageTask(ports.channel, ports.scope, exec)),
      presentCall: () => presentTaskCall('读取本页任务'),
    }),
    defineTool({
      name: 'take_page_task',
      description: '接取本页对应的那条任务（详情页专用，无需参数：接的就是 params.taskId 这条）。'
        + '接 30 分钟租约，重复接取幂等；被其他会话持有时返回 task/already-taken。'
        + '仅在本回合同意内合法：用户点名，或点名本任务的投递指令（TASK 块/收件箱通知）；browse 先 drive_begin。'
        + 'Take the task this detail page is about — no arguments, a 30-minute lease, idempotent. Legal only within '
        + 'this turn\'s consent (user-named, or a delivery naming this task).',
      parameters: {},
      output: { schema: { type: 'object', additionalProperties: true } as const, render: renderValue },
      execute: async (_args, exec: ToolCallContext) => asJson(await takePageTask(ports.store, ports.channel, ports.scope, ports.book, ports.ledger, exec)),
      presentCall: () => presentTaskCall('接取本页任务'),
    }),
    defineTool({
      name: 'split_task',
      description: '把一个已接取（taken）工作单拆成子任务：在它下面新建一条 open 子任务，继承其目标页面。'
        + '仅当前接取者可用；任务中心校验安全上限（深度 8 / 单节点 32 子 / 单树 200 节点），超限返回 task/subtree-limit。'
        + '仅在本回合同意内合法。'
        + 'Split a taken order: one open subtask inheriting its target. Claimant-only; center-checked limits '
        + '(task/subtree-limit). Legal only within this turn\'s consent.',
      parameters: {
        task_id: { type: 'string', description: '工作单 id / work-order id', required: true },
        title: { type: 'string', description: '子任务标题 / subtask title', required: true },
      },
      output: { schema: { type: 'object', additionalProperties: true } as const, render: renderValue },
      execute: async (args, exec: ToolCallContext) => asJson(await splitTask(ports.store, ports.channel, ports.book, ports.ledger, exec, args)),
      presentCall: args => presentTaskCall('拆分子任务', args),
    }),
  ]
}
