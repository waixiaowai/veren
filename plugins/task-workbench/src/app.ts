/**
 * 应用定义 + 应用级工具 + 任务通道（本包的业务核心）。
 * The application definition, app-scoped tools, and the task-channel seam.
 *
 * - 工具一律用 `@deepseek-ai/dsh-tools` 的 `defineTool` 定义（DSH `ToolDefinition`
 *   本体），经 `ctx.apps.tools(id, ctx).define(tool, { requires })` 进应用目录：
 *   本地注册名；对外名由注册表拼 `<toolPrefix>__<本地名>`（默认 task_workbench）。
 * - `requires` 等应用侧元数据走 define 的第二个参数，不塞进 DSH 类型；
 *   第 1 阶段只记录、不强制。
 * - 任务接缝按 task-center 冻结契约（TaskDraft/TaskCenterContract）编写；
 *   taskCenter 是声明的硬 inject（G13）：发布与拆分直接走注入的服务面，
 *   没有任何"缺席即降级"的运行期探测——那条通道在真实宿主上从未生效过。
 * @module @veren/task-workbench
 */
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { Context } from '@deepseek-ai/cordis'
import type { ApplicationDefinition, AppId, PageKey, AppCapability } from '@veren/app-registry'
import type { TaskCenterContract, TaskDraft, TaskId } from '@veren/task-center'
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

/** 子任务创建选项 / options for creating a subtask */
export interface SplitOptions {
  /** 调用会话 id；任务中心用它校验“仅当前接取者可拆”（§4.7.6） */
  readonly claimantSessionId?: string
  readonly body?: string
}

/**
 * 把注入的任务中心服务面收窄成工具要用的两个动作。taskCenter 是声明的硬
 * inject，通道没有"可用性"开关：send/addSubtask 的失败原样抛出，由工具
 * 执行器的错误路径上报（fail loud），不再有降级标记。
 * Narrow the injected task-center service face to the two actions the tools
 * need. taskCenter is a declared hard inject, so the channel has no
 * "availability" switch: send/addSubtask failures propagate and reach the tool
 * executor's error path (fail loud) — no degraded marker.
 */
export interface TaskChannel {
  send(draft: TaskDraft): Promise<void>
  /** 现拆子任务（§4.7.6）；服务面会校验 target 一致与安全上限 */
  addSubtask(parentId: string, title: string, opts?: SplitOptions): Promise<void>
}

/** 从注入的服务面构建通道：纯参数，不触碰 ctx / build the channel from the injected face: pure parameters */
export function createTaskChannel(taskCenter: TaskCenterContract): TaskChannel {
  return {
    send: async (draft) => { await taskCenter.send(draft) },
    // 服务面的 addSubtask 会校验 target 一致与安全上限；父记录在这里解析，
    // 工具侧只传 id + 标题。/ the service's addSubtask validates target equality
    // and the safety limits; the parent record is resolved here, the tool only
    // passes id + title.
    addSubtask: async (parentId, title, opts) => {
      // 本地 id 是普通 string；跨过 brand 边界只此一处收窄 / local ids are plain
      // strings; this is the one brand-boundary narrowing
      const parent = await taskCenter.get(parentId as TaskId)
      if (parent === undefined) {
        throw new Error(`[task-workbench] parent task ${parentId} not found in the task center`)
      }
      await taskCenter.addSubtask(parent.id, {
        kind: parent.kind,
        title,
        target: parent.target,
        ...(opts?.body === undefined ? {} : { body: opts.body }),
      }, { ...(opts?.claimantSessionId === undefined ? {} : { claimantSessionId: opts.claimantSessionId }) })
    },
  }
}

// ---- 应用级工具 / app-scoped tools（defineTool 本体）----

/** 参数 schema 片段 / the shared task_id parameter */
const TASK_ID_PARAM = { task_id: { type: 'string', description: '任务 id，如 t-12', required: true } } as const

/** 工具结果渲染成 JSON 文本（模型可读，UI 通用卡片）/ render outcomes as JSON text */
function renderValue(_args: unknown, value: unknown): ContentBlock[] {
  return [{ type: 'text', text: JSON.stringify(value) }] as ContentBlock[]
}

/** 把结果规整成输出 schema 要求的无损 JSON 对象 / normalize outcomes to the output schema's JSON object */
function asJson(value: unknown): Record<string, never> {
  return JSON.parse(JSON.stringify(value)) as Record<string, never>
}

/**
 * 定义应用全部工具：`defineTool` 产物（DSH `ToolDefinition` 本体），本地名
 * ≤24 字符、应用内唯一。调用哪些能力在注册面声明（见 index.ts 的 define 第二参）。
 */
export function createAppTools(store: TaskStore, channel: TaskChannel): ToolDefinition[] {
  return [
    defineTool({
      name: 'take_task',
      description: '接取一个任务。仅当任务状态为 open 时合法；接取后变为 taken。'
        + 'Take an open task; it becomes taken. Parameters: task_id.',
      parameters: TASK_ID_PARAM,
      output: { schema: { type: 'object', additionalProperties: true } as const, render: renderValue },
      execute: async (args) => asJson(await runGuarded(() => store.takeTask(requireTaskId(args), 'model'))),
      presentCall: args => presentTaskCall('接取任务', args),
    }),
    defineTool({
      name: 'complete_task',
      description: '完成一个任务。仅当任务状态为 taken 时合法；完成后变为 done。'
        + 'Complete a taken task; it becomes done. Parameters: task_id.',
      parameters: TASK_ID_PARAM,
      output: { schema: { type: 'object', additionalProperties: true } as const, render: renderValue },
      execute: async (args) => asJson(await runGuarded(() => store.completeTask(requireTaskId(args)))),
      presentCall: args => presentTaskCall('完成任务', args),
    }),
    defineTool({
      name: 'abandon_task',
      description: '放弃一个任务。仅当任务状态为 taken 时合法；放弃后回到 open。'
        + 'Abandon a taken task; it returns to open. Parameters: task_id.',
      parameters: TASK_ID_PARAM,
      output: { schema: { type: 'object', additionalProperties: true } as const, render: renderValue },
      execute: async (args) => asJson(await runGuarded(() => store.abandonTask(requireTaskId(args)))),
      presentCall: args => presentTaskCall('放弃任务', args),
    }),
    defineTool({
      name: 'publish_task',
      description: '发布一个新任务到宿主任务中心（收件人收到通知后打开任务 URL 处理）。'
        + '标题必填；本地列表同步落一条，任务中心投递失败会以工具错误上报。'
        + 'Publish a new task to the host task center. Parameters: title.',
      parameters: { title: { type: 'string', description: '任务标题', required: true } },
      output: { schema: { type: 'object', additionalProperties: true } as const, render: renderValue },
      execute: async (args) => asJson(await publishTask(store, channel, args)),
      presentCall: args => presentTaskCall('发布任务', args),
    }),
    defineTool({
      name: 'split_task',
      description: '把一个已接取（taken）任务拆成子任务：在它下面新建一条 open 子任务，继承其目标页面。'
        + '仅当前接取者可用；任务中心会校验安全上限（深度 8 / 单节点 32 子 / 单树 200 节点），'
        + '超限返回 task/subtree-limit。Split a taken task: create one open subtask under it. '
        + 'Parameters: task_id, title.',
      parameters: {
        ...TASK_ID_PARAM,
        title: { type: 'string', description: '子任务标题 / subtask title', required: true },
      },
      output: { schema: { type: 'object', additionalProperties: true } as const, render: renderValue },
      execute: async (args, exec) => asJson(await splitTask(store, channel, args, exec)),
      presentCall: args => presentTaskCall('拆分子任务', args),
    }),
  ]
}

/** 拆分：本地 store 记树形事实，任务中心同步建真正的子任务 / split: local facts plus a real subtask */
async function splitTask(
  store: TaskStore,
  channel: TaskChannel,
  args: { task_id?: string; title?: string },
  exec: { agent?: { session?: { id?: string } } },
): Promise<ToolOutcome> {
  const parentId = requireTaskId({ task_id: args?.task_id })
  const title = typeof args?.title === 'string' ? args.title.trim() : ''
  if (title.length === 0) return { ok: false, code: 'draft-invalid', detail: 'title is required' }
  // 本地门槛：只有被接取的节点能拆（工具跑在接取者页面会话里，即树级互斥下的唯一活跃者）
  // / local gate: only a taken node splits (the tool runs in the claimant's page
  // session — the tree mutex's one active claimant)
  const local = store.splitTask(parentId, title)
  if (local.outcome !== 'ok') {
    return local.outcome === 'not-found'
      ? { ok: false, code: 'task-not-found', detail: 'no such task' }
      : { ok: false, code: 'bad-task-state', detail: 'only a taken task can be split' }
  }
  // 任务中心是硬 inject：addSubtask 失败（上限/互斥等）原样抛给工具执行器。
  // taskCenter is a hard inject: addSubtask failures (limits, mutex) propagate
  // to the tool executor.
  await channel.addSubtask(parentId, title, {
    claimantSessionId: exec.agent?.session?.id,
  })
  return { ok: true }
}

/** 发布需要的能力：注册工具时经 define 的 meta 参数声明（不在工具本体上） */
export const PUBLISH_TASK_REQUIRES = ['tasks:send' as AppCapability]

// ---- 小工具 / helpers ----

/** 通用 pending 卡片 / the generic pending card */
function presentTaskCall(title: string, args: unknown): { card: 'generic'; title: string; kind: 'other'; rawInput?: unknown } {
  return { card: 'generic' as const, title, kind: 'other' as const, ...(args === undefined ? {} : { rawInput: args }) }
}

/** 发布：先落本地列表，再投递任务中心；失败原样抛出（fail loud）/ publish locally then forward; failures propagate */
async function publishTask(store: TaskStore, channel: TaskChannel, args: { title: string }): Promise<ToolOutcome> {
  const title = typeof args?.title === 'string' ? args.title.trim() : ''
  if (title.length === 0) return { ok: false, code: 'draft-invalid', detail: 'title is required' }
  const item = store.publishLocal(title)
  await channel.send({
    kind: 'task-workbench/publish' as TaskDraft['kind'],
    title,
    target: {
      url: `/apps/task-workbench/task/${item.id}` as TaskDraft['target']['url'],
      appId: APP_ID,
      page: 'detail',
      params: { taskId: item.id } as Readonly<Record<string, string>>,
    },
  })
  return { ok: true }
}

/** 校验 task_id 参数 / validate the task_id argument */
function requireTaskId(args: { task_id?: string }): string {
  const id = args?.task_id
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
