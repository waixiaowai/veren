/**
 * drive/导航工具定义（§3.10.1 矩阵的模式与导航面）：drive_begin / drive_end /
 * open_task_page。drive 是逐轮声明的范围台账（WeakMap 随 agent 回收）；导航走
 * pageRegistry.openUrl 正门（taskId 接取 + 同 URL 自开守卫都在宿主侧）。
 * The drive/navigation tool definitions (the matrix's mode and navigation
 * faces): drive_begin / drive_end / open_task_page. Drive is the per-turn
 * declared-scope ledger (a WeakMap reclaimed with the agent); navigation goes
 * through the pageRegistry.openUrl front door (taskId take and the same-url
 * self-open guard both live host-side).
 * @module @veren/task-workbench
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { beginDrive } from './consent.ts'
import type { ConsentBook, DriveLedger } from './consent.ts'
import { openTaskPageAction } from './actions-queue.ts'
import type { OpenUrlPort } from './actions-queue.ts'
import { asJson, renderValue } from './tools-queue.ts'
import { presentTaskCall } from './actions.ts'
import type { TaskChannel } from './channel.ts'
import type { TaskStore } from './store.ts'
import type { ToolCallContext } from './types.ts'

/** drive/导航工具的端口 / the drive tools' ports */
export interface DriveToolPorts {
  readonly channel: TaskChannel
  readonly store: TaskStore
  readonly book: ConsentBook
  readonly ledger: DriveLedger
  readonly openUrl: OpenUrlPort['openUrl']
}

/** 构造 drive/导航工具 / build the drive/navigation tools */
export function createDriveTools(ports: DriveToolPorts): ReturnType<typeof defineTool>[] {
  return [
    defineTool({
      name: 'drive_begin',
      description: '声明本回合的 drive 范围（写工具的前置）：reason 必填一句话；scope=turn（任意任务，'
        + '仅限本回合有用户消息）或 scope=tasks + task_ids（点名任务；投递回合只能点名被投递任务）。'
        + 'Declare this turn\'s drive scope (the write tools\' prerequisite): a one-sentence reason is required; '
        + 'scope=turn (any task, only when a user message is present this turn) or scope=tasks + task_ids '
        + '(named tasks; a delivery turn may only name the delivered task).',
      parameters: {
        reason: { type: 'string', description: '一句话说明为什么要动任务 / one sentence on why tasks are being driven', required: true },
        scope: { type: 'string', description: 'turn（需用户消息）或 tasks（点名）/ turn (needs a user message) or tasks (named)' },
        task_ids: { type: 'array', description: 'scope=tasks 时点名的任务 id / the named task ids for scope=tasks' },
      },
      output: { schema: { type: 'object', additionalProperties: true } as const, render: renderValue },
      execute: async (args, exec: ToolCallContext) => asJson(beginDrive(ports.book, ports.ledger, exec.agent, args)),
      presentCall: args => presentTaskCall('进入 drive', args),
    }),
    defineTool({
      name: 'drive_end',
      description: '结束本回合的 drive（收回范围台账；可省——下一回合没有新同意时写工具依旧被挡）。'
        + 'End this turn\'s drive (withdraws the scope ledger; optional — the next turn without fresh consent is '
        + 'blocked anyway).',
      parameters: {},
      output: { schema: { type: 'object', additionalProperties: true } as const, render: renderValue },
      execute: async (_args, exec: ToolCallContext) => {
        if (exec.agent !== undefined) ports.ledger.end(exec.agent)
        return asJson({ ok: true, detail: 'drive ended; back to browse' })
      },
      presentCall: () => presentTaskCall('结束 drive'),
    }),
    defineTool({
      name: 'open_task_page',
      description: '打开一条任务的目标应用页面（带回执）：走宿主 openUrl 正门，目标页会话建立并接取该任务'
        + '（收 TASK 块）；返回 {sessionId,url,title}。打开自己的页面时幂等返回当前会话（宿主守卫）。'
        + '仅在本回合同意内合法（导航会切走 GUI 焦点）。'
        + 'Open a task\'s target app page (with a receipt): through the host openUrl front door — the target page '
        + 'session is created and takes the task (a TASK block). Returns {sessionId,url,title}. Opening your own page '
        + 'returns idempotently (host guard). Legal only within this turn\'s consent (navigation steals GUI focus).',
      parameters: {
        task_id: { type: 'string', description: '工作单 id / work-order id', required: true },
      },
      output: { schema: { type: 'object', additionalProperties: true } as const, render: renderValue },
      execute: async (args, exec: ToolCallContext) => asJson(await openTaskPageAction(
        { channel: ports.channel, store: ports.store, book: ports.book, ledger: ports.ledger, openUrl: ports.openUrl },
        exec,
        args,
      )),
      presentCall: args => presentTaskCall('打开任务页面', args),
    }),
  ]
}
