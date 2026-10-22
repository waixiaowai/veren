/**
 * Model-facing `task_*` tools over the Host `ctx.taskCenter` service.
 *
 * Seven tools (§8.1 base + split): list/get/take/complete/fail/cancel/split.
 * Apps send tasks through the service, not through a model tool, so there is
 * deliberately no `task_send`. The caller's session id is resolved from the
 * live Agent on every call — it is the claimant identity for leases and the
 * completion check — and is never a parameter a model could forge for another
 * session.
 *
 * 面向模型的 `task_*` 工具族，作用于宿主 `ctx.taskCenter` 服务。
 *
 * 七个工具（§8.1 六件 + split）。应用通过服务发任务而不是模型工具，因此刻意没有
 * `task_send`。调用方的会话 id 每次都从活着的 Agent 解析——它既是租约的接取者身份，
 * 也是完成校验的依据——永远不是参数，模型无法替别的会话伪造。
 *
 * @module @veren/task-center/tools
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView } from '@deepseek-ai/dsh-tools'
import { TaskError } from './tree.ts'
import { TaskErrorCode } from './types.ts'
import type { TaskCenterService } from './service.ts'
import type { TaskId, TaskRecord } from './types.ts'

/** Default claim lease: 30 minutes, renewed on every task tool call (§4.4). */
const LEASE_MINUTES = 30

/** The lossless-JSON a Tool result carries, spelled locally. */
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

/** Project a value onto the object-shaped lossless-JSON a Tool result carries. */
function jsonOf<T extends object>(value: T): { [K in keyof T]: JsonValue } {
  return JSON.parse(JSON.stringify(value)) as { [K in keyof T]: JsonValue }
}

/** Serialize an array result onto the json-array a Tool result carries (§tool schema `items: json`). */
function jsonArrayOf<T>(value: readonly T[]): JsonValue[] {
  return JSON.parse(JSON.stringify(value)) as JsonValue[]
}

/** Canonical tool output shapes. */
const LIST_SCHEMA = { type: 'object', additionalProperties: false, properties: { tasks: { type: 'array', required: true, items: { type: 'json' } } } } as const
const TASK_SCHEMA = { type: 'object', additionalProperties: false, properties: { task: { type: 'json', required: true } } } as const

function renderValue(_args: unknown, value: unknown): ContentBlock[] {
  return [{ type: 'text', text: JSON.stringify(value) }]
}

function present(title: string, rawInput?: unknown): GenericCallView {
  return { card: 'generic', title, kind: 'other', ...rawInput === undefined ? {} : { rawInput } }
}

/** Resolve the calling session id, or `undefined` outside an agent session. */
function callerSession(agent: Agent | undefined): string | undefined {
  return agent?.session.id
}

/** The claim this session presents when taking or renewing a lease. */
function renewClaim(sessionId: string | undefined): { sessionId?: string; actor: 'agent'; leaseUntil: string } {
  return {
    ...(sessionId === undefined ? {} : { sessionId }),
    actor: 'agent',
    leaseUntil: new Date(Date.now() + LEASE_MINUTES * 60_000).toISOString(),
  }
}

/**
 * Guard that the calling session is the claimant before mutating a taken task.
 * 在改写 taken 任务之前校验调用方就是接取者（§5.6 task/not-claimant）。
 */
function assertClaimant(record: TaskRecord, sessionId: string | undefined): void {
  if (record.status === 'taken' && record.claimedBy?.sessionId !== undefined
    && record.claimedBy.sessionId !== sessionId) {
    throw new TaskError('task/not-claimant', `task is claimed by session ${record.claimedBy.sessionId}`)
  }
}

/** Map a structured refusal to a tool error carrying the stable code. */
function toolError(error: unknown): never {
  if (error instanceof TaskError) throw new TaskError(error.code, error.message)
  throw new TaskError('internal_error', 'The task operation failed.')
}

/**
 * Register the task tools in the mounting scope.
 * @param ctx - Context owning the `tools` registry.
 * @param port - resolves the service surface the tools act through.
 */
export function registerTaskTools(ctx: Context, port: () => TaskCenterService): void {
  ctx.effect(() => {
    const disposers = [
      ctx.tools.register(defineTool({
        name: 'task_list',
        description: 'List tasks from the host task center, the personal inbox of work items. '
          + 'Returns task records with id, title, status, target page URL, and deadlines. '
          + 'Filter by status or app. Use task_get for one task; claim open work with task_take.',
        parameters: {
          status: {
            type: 'string',
            description: 'Only tasks in this state: open | taken | done | failed | expired | cancelled | orphaned.',
          },
          appId: { type: 'string', description: 'Only tasks sent by this application.' },
        },
        output: { schema: LIST_SCHEMA, render: renderValue },
        async execute(args) {
          try {
            // 序列化即收窄为 json 数组（output schema `items: json`），不经过 as unknown / one serialization step, no unknown cast
            return { tasks: jsonArrayOf(await port().list({
              ...(args.status === undefined ? {} : { status: args.status as TaskRecord['status'] }),
              ...(args.appId === undefined ? {} : { appId: args.appId }),
            })) }
          } catch (error: unknown) {
            toolError(error)
          }
        },
        presentCall: () => present('List tasks'),
      })),
      ctx.tools.register(defineTool({
        name: 'task_get',
        description: 'Read one task by id: full record including target page URL, params, lease, and result or '
          + 'failure. If your session holds the lease it is renewed. Unknown ids return task/not-found.',
        parameters: { id: { type: 'string', required: true, description: 'Task id from task_list or a notice.' } },
        output: { schema: TASK_SCHEMA, render: renderValue },
        async execute(args, exec) {
          try {
            const record = await port().get(args.id as TaskId)
            if (record !== undefined && record.status === 'taken'
              && record.claimedBy?.sessionId === callerSession(exec.agent)) {
              return jsonOf({ task: await port().take(args.id as TaskId, renewClaim(callerSession(exec.agent))) })
            }
            return jsonOf({ task: record })
          } catch (error: unknown) {
            toolError(error)
          }
        },
        presentCall: args => present('Read task', args.id),
      })),
      ctx.tools.register(defineTool({
        name: 'task_take',
        description: 'Claim an open task so only this session may work on it, with a 30-minute lease that this '
          + 'tool renews on every call; an expired lease silently returns the task to open. After taking, work '
          + 'where the task lives: if its target page is this session\u2019s page, start there; otherwise hand the '
          + 'task to that page with page_send (app_open is denied inside page sessions; page_send is not), then '
          + 'report with task_complete or task_fail. '
          + 'Already-taken tasks return task/already-taken; tasks past their deadline return task/expired.',
        parameters: { id: { type: 'string', required: true, description: 'Task id from task_list or a notice.' } },
        output: { schema: TASK_SCHEMA, render: renderValue },
        async execute(args, exec) {
          try {
            return jsonOf({ task: await port().take(args.id as TaskId, renewClaim(callerSession(exec.agent))) })
          } catch (error: unknown) {
            toolError(error)
          }
        },
        presentCall: args => present('Take task', args.id),
      })),
      ctx.tools.register(defineTool({
        name: 'task_complete',
        description: 'Finish a task your session has taken. Always call it after the work is done: summary is a '
          + 'short human-readable outcome, artifacts optionally lists references (ids, paths, urls) - never bulk '
          + 'content. Repeating an already-completed call is safe and returns the first result. '
          + 'Failing the task instead? Call task_fail.',
        parameters: {
          id: { type: 'string', required: true, description: 'Task id you took with task_take.' },
          summary: { type: 'string', required: true, description: 'Short outcome summary.' },
          artifacts: { type: 'array', description: 'Optional reference strings produced by the work.' },
        },
        output: { schema: TASK_SCHEMA, render: renderValue },
        async execute(args, exec) {
          try {
            const id = args.id as TaskId
            const current = await port().get(id)
            if (current !== undefined) assertClaimant(current, callerSession(exec.agent))
            return jsonOf({ task: await port().complete(id, {
              summary: args.summary,
              ...(args.artifacts === undefined ? {} : { artifacts: args.artifacts as readonly string[] }),
            }) })
          } catch (error: unknown) {
            toolError(error)
          }
        },
        presentCall: args => present('Complete task', args.id),
      })),
      ctx.tools.register(defineTool({
        name: 'task_fail',
        description: 'Mark a task your session has taken as failed, with a stable machine-readable code (for '
          + 'example target-unavailable) and a message. Use it whenever the work cannot be finished; otherwise '
          + 'the task stays taken until its lease expires. Repeating an already-failed call is safe.',
        parameters: {
          id: { type: 'string', required: true, description: 'Task id you took with task_take.' },
          code: { type: 'string', required: true, description: 'Stable failure code.' },
          message: { type: 'string', required: true, description: 'What went wrong.' },
        },
        output: { schema: TASK_SCHEMA, render: renderValue },
        async execute(args, exec) {
          try {
            const id = args.id as TaskId
            const current = await port().get(id)
            if (current !== undefined) assertClaimant(current, callerSession(exec.agent))
            return jsonOf({ task: await port().fail(id, { code: args.code, message: args.message }) })
          } catch (error: unknown) {
            toolError(error)
          }
        },
        presentCall: args => present('Fail task', args.id),
      })),
      ctx.tools.register(defineTool({
        name: 'task_cancel',
        description: 'Withdraw an open (not yet taken) task, e.g. on behalf of the sending app after the user '
          + 'changed their mind. A taken task refuses until its claimant finishes it (task_complete/task_fail) '
          + 'or its lease expires — there is no release tool; terminal tasks refuse with task/invalid-state. '
          + 'Deleting records is not possible through tools.',
        parameters: {
          id: { type: 'string', required: true, description: 'Task id to withdraw.' },
          reason: { type: 'string', description: 'Why the task is withdrawn.' },
        },
        output: { schema: TASK_SCHEMA, render: renderValue },
        async execute(args) {
          try {
            return jsonOf({ task: await port().cancel(args.id as TaskId, args.reason ?? 'cancelled') })
          } catch (error: unknown) {
            toolError(error)
          }
        },
        presentCall: args => present('Cancel task', args.id),
      })),
      ctx.tools.register(defineTool({
        name: 'task_split',
        description: 'Split work: create one subtask under any open node of the task tree your session holds. '
          + 'Available only while your session holds the tree\u2019s taken task (task/not-claimant otherwise); '
          + 'the subtask inherits the parent\u2019s target page. Subtask limits: depth 8, 32 children per node, '
          + '200 nodes per tree; exceeding them returns task/subtree-limit.',
        parameters: {
          parent_id: { type: 'string', required: true, description: 'Task id of the open node to split.' },
          title: { type: 'string', required: true, description: 'Short title of the new subtask.' },
          body: { type: 'string', description: 'Optional details for the subtask.' },
        },
        output: { schema: TASK_SCHEMA, render: renderValue },
        async execute(args, exec) {
          try {
            const parent = await port().get(args.parent_id as TaskId)
            if (parent === undefined) throw new TaskError(TaskErrorCode.ParentGone, `task ${args.parent_id} not found`)
            const kind: TaskRecord['kind'] = parent.kind
            const subtask = await port().addSubtask(parent.id, {
              kind,
              title: args.title,
              ...(args.body === undefined ? {} : { body: args.body }),
              target: parent.target,
            }, { claimantSessionId: callerSession(exec.agent) })
            return jsonOf({ task: subtask })
          } catch (error: unknown) {
            toolError(error)
          }
        },
        presentCall: args => present('Split task', args.parent_id),
      })),
    ]
    return () => { for (const dispose of disposers.reverse()) dispose() }
  }, 'taskCenter:tools()')
}
