/**
 * 应用定义 + 应用级工具 + 任务通道（本包的业务核心）。
 * The application definition, app-scoped tools, and the task-channel seam.
 *
 * - 工具在应用级目录定义（ctx.apps.tools），本地名；对外名由注册表拼
 *   `<toolPrefix>__<本地名>`（默认前缀 task_workbench）。
 * - 任务接缝按 task-center 冻结契约（TaskDraft/TaskCenterContract）编写；
 *   ctx.taskCenter 缺席时不崩：记录降级，发布回落到本地 store。
 * @module @veren/task-workbench
 */
import type { Context } from '@deepseek-ai/cordis'
import type { AppToolDefinition, ApplicationDefinition, AppId, PageKey, AppCapability } from '@veren/app-registry'
import type { TaskCenterContract, TaskDraft } from '@veren/task-center'
import type { PageParams } from '@veren/prompt-page'
import type { TaskStore } from './store.ts'
import type { ToolOutcome } from './types.ts'

// ---- 应用定义（§2.3）/ the application definition ----

export const APP_ID = 'task-workbench' as AppId

/** 应用定义：entry 是应用内页面键，不是 URL / entry is a page key, not a url */
export const APP_DEFINITION: ApplicationDefinition = {
  id: APP_ID,
  name: '任务工作台',
  description: '浏览、接取、完成任务，并把新任务发布到宿主任务中心',
  entry: 'list' as PageKey,
  instructions: '任务工作台负责任务的浏览与流转：列表页浏览/接取/完成，'
    + '详情页处理单个任务，发布页把新任务投递到任务中心。'
    + '所有操作通过本页挂载的 task_workbench__* 工具完成。',
  // toolPrefix 缺省由 id 推导为 task_workbench；显式写出仅为可读性
  toolPrefix: 'task_workbench',
  requires: ['tasks:send' as AppCapability],
}

// ---- 任务接缝 / the task-channel seam ----

/** 任务通道：send 投递任务；available=false 表示任务中心缺席已降级 / the task channel */
export interface TaskChannel {
  readonly available: boolean
  send(draft: TaskDraft): Promise<{ ok: true } | { ok: false; degraded: true; detail: string }>
}

/**
 * 从上下文惰性解析 ctx.taskCenter；缺席或没有 send 方法 → 降级通道（不抛错）。
 * Resolve ctx.taskCenter lazily; absent or send-less → a degraded channel.
 */
export function createTaskChannel(ctx: Context, logger: { warn(message: string): void }): TaskChannel {
  // taskCenter 可能未激活：能力探测而非类型断言（降级不崩）
  // taskCenter may be inactive: capability-probe instead of asserting the type
  const taskCenter = (ctx as { get(name: string): unknown }).get('taskCenter') as TaskCenterContract | undefined
  const send = taskCenter?.send
  if (typeof send !== 'function') {
    logger.warn('task-workbench: ctx.taskCenter is unavailable; publishes degrade to the local store')
    return { available: false, send: sendDegraded }
  }
  return { available: true, send: (draft) => send.call(taskCenter, draft).then(() => ({ ok: true }) as const) }
}

/** 降级发送：记录并返回结构化失败，不抛异常 / the degraded send: record, return, never throw */
function sendDegraded(draft: TaskDraft): Promise<{ ok: false; degraded: true; detail: string }> {
  return Promise.resolve({
    ok: false,
    degraded: true,
    detail: `task center unavailable; task "${draft.title}" kept in the local store only`,
  })
}

// ---- 应用级工具 / app-scoped tools ----

/** 参数 schema 片段 / the shared task_id parameter */
const TASK_ID_PARAM = { task_id: { type: 'string', description: '任务 id，如 t-12' } } as const

/**
 * 定义应用全部工具。本地名 ≤24 字符、应用内唯一；
 * requires 声明调用所需能力（publish 需要 tasks:send）。
 */
export function createAppTools(store: TaskStore, channel: TaskChannel): AppToolDefinition[] {
  return [
    {
      name: 'take_task',
      description: '接取一个任务。仅当任务状态为 open 时合法；接取后变为 taken。'
        + 'Take an open task; it becomes taken. Parameters: task_id.',
      parameters: { type: 'object', properties: TASK_ID_PARAM, required: ['task_id'] },
      execute: async (args) => runGuarded(() => store.takeTask(requireTaskId(args), 'model')),
    },
    {
      name: 'complete_task',
      description: '完成一个任务。仅当任务状态为 taken 时合法；完成后变为 done。'
        + 'Complete a taken task; it becomes done. Parameters: task_id.',
      parameters: { type: 'object', properties: TASK_ID_PARAM, required: ['task_id'] },
      execute: async (args) => runGuarded(() => store.completeTask(requireTaskId(args))),
    },
    {
      name: 'abandon_task',
      description: '放弃一个任务。仅当任务状态为 taken 时合法；放弃后回到 open。'
        + 'Abandon a taken task; it returns to open. Parameters: task_id.',
      parameters: { type: 'object', properties: TASK_ID_PARAM, required: ['task_id'] },
      execute: async (args) => runGuarded(() => store.abandonTask(requireTaskId(args))),
    },
    {
      name: 'publish_task',
      description: '发布一个新任务到宿主任务中心（收件人收到通知后打开任务 URL 处理）。'
        + '标题必填；任务中心缺席时降级为仅写入本应用列表页，并返回 degraded 标记。'
        + 'Publish a new task to the host task center. Parameters: title.',
      parameters: { type: 'object', properties: { title: { type: 'string', description: '任务标题' } }, required: ['title'] },
      requires: ['tasks:send' as AppCapability],
      execute: async (args) => publishTask(store, channel, args),
    },
  ]
}

/** 发布：先落本地列表，再尝试任务中心；降级返回 degraded 标记 / publish with degrade */
async function publishTask(store: TaskStore, channel: TaskChannel, args: unknown): Promise<ToolOutcome> {
  const title = typeof (args as { title?: unknown })?.title === 'string'
    ? (args as { title: string }).title.trim() : ''
  if (title.length === 0) return { ok: false, code: 'draft-invalid', detail: 'title is required' }
  const item = store.publishLocal(title)
  const outcome = await channel.send({
    kind: 'task-workbench/publish' as TaskDraft['kind'],
    title,
    target: {
      url: `/apps/task-workbench/task/${item.id}` as TaskDraft['target']['url'],
      appId: APP_ID,
      page: 'detail',
      params: { taskId: item.id } as Readonly<Record<string, string>>,
    },
  })
  return outcome.ok
    ? { ok: true }
    : { ok: false, degraded: true, code: 'task-center-unavailable', detail: outcome.detail }
}

// ---- 小工具 / helpers ----

/** 校验 task_id 参数 / validate the task_id argument */
function requireTaskId(args: unknown): string {
  const id = (args as { task_id?: unknown })?.task_id
  if (typeof id !== 'string' || id.length === 0) throw new Error('[task-workbench] task_id is required')
  return id
}

/** 把 store 迁移结果翻成 ToolOutcome / map a Transition to a ToolOutcome */
async function runGuarded(run: () => 'ok' | 'not-found' | 'bad-state'): Promise<ToolOutcome> {
  const outcome = run()
  if (outcome === 'ok') return { ok: true }
  return outcome === 'not-found'
    ? { ok: false, code: 'task-not-found', detail: 'no such task' }
    : { ok: false, code: 'bad-task-state', detail: 'task is not in the required state' }
}

/** 入口 URL（应用下拉 / 任务通知共用）/ the entry url */
export function entryUrlOf(pages: readonly { name: string; url: string }[], entry: string): string | undefined {
  return pages.find((page) => page.name === entry)?.url
}

/** 详情页 URL / the detail-page url for one task */
export function detailUrl(params: PageParams): string {
  return `/apps/${APP_ID}/task/${String(params.taskId ?? '')}`
}
