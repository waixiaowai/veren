/**
 * 应用定义 + 应用级工具目录 + 任务通道（本包的业务核心）。
 * The application definition, the app tool catalog, and the task-channel seam.
 *
 * - 工具一律用 `@deepseek-ai/dsh-tools` 的 `defineTool` 定义（DSH `ToolDefinition`
 *   本体），经 `ctx.apps.tools(id, ctx).define(tool, { requires })` 进应用目录：
 *   本地注册名；对外名由注册表拼 `<toolPrefix>__<本地名>`（默认 task_workbench）。
 * - 动作体都在 actions.ts（单一职责：本文件只声明，不实现）。
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
import type { TaskCenterContract, TaskDraft, TaskId, TaskRecord } from '@veren/task-center'
import { entryUrlOf, presentTaskCall, publishTask, requireTaskId, runGuarded, splitTask, takePageTask } from './actions.ts'
import type { TaskStore } from './store.ts'
import type { PageTaskScope } from './types.ts'

export { detailUrl, entryUrlOf } from './actions.ts'

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
  /** 调用会话 id；任务中心用它校验"仅当前接取者可拆"（§4.7.6） */
  readonly claimantSessionId?: string
  readonly body?: string
}

/** 页面作用域接取的租约声明 / the lease claim for the page-scoped take */
export interface PageTakeClaim {
  readonly sessionId: string
  readonly leaseUntil: string
}

/**
 * 把注入的任务中心服务面收窄成工具要用的动作。taskCenter 是声明的硬
 * inject，通道没有"可用性"开关：失败原样抛出，由工具执行器的错误路径
 * 上报（fail loud），不再有降级标记。take_page_task 的中心面走
 * findByTarget/take：目标规范 URL 是任务主键（§4.2），互斥由 CAS + 租约
 * 承担（§4.4）。
 * Narrow the injected task-center face to the actions the tools need.
 * taskCenter is a declared hard inject, so the channel has no "availability"
 * switch: failures propagate to the tool executor's error path (fail loud).
 * take_page_task's center face is findByTarget/take: the canonical target url
 * is the task primary key (§4.2), and the mutex is the CAS + lease (§4.4).
 */
export interface TaskChannel {
  send(draft: TaskDraft): Promise<void>
  /** 现拆子任务（§4.7.6）；服务面会校验 target 一致与安全上限 */
  addSubtask(parentId: string, title: string, opts?: SplitOptions): Promise<void>
  /** 按目标规范 URL 找任务记录；无对应记录 → undefined（纯本地任务） */
  findByTarget(url: string): Promise<TaskRecord | undefined>
  /** 接取租约（CAS；同一接取者重复接取幂等，§4.4）/ take the lease (CAS; idempotent for the same claimant) */
  take(id: TaskId, claim: PageTakeClaim): Promise<TaskRecord>
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
    findByTarget: async (url) => {
      const records = await taskCenter.list({ appId: APP_ID })
      return records.find((record) => record.target.url === url)
    },
    // actor 'model'：页面会话里的模型即接取者（与本地 take 的 owner 同一口径）
    // / actor 'model': the page session's model is the claimant (same reading
    // as the local take's owner)
    take: (id, claim) => taskCenter.take(id, {
      sessionId: claim.sessionId,
      actor: 'model',
      leaseUntil: claim.leaseUntil,
    }),
  }
}

/** 发布需要的能力：注册工具时经 define 的 meta 参数声明（不在工具本体上） */
export const PUBLISH_TASK_REQUIRES = ['tasks:send' as AppCapability]

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
 * ≤24 字符、应用内唯一。动作体在 actions.ts。矩阵要点（§3.10.1）：列表页
 * 接任意 id（浏览入口的合法职责）；详情页接"本页那条"（take_page_task，
 * 无参数）+ complete/abandon/split——投递闭环的接取步由此承载。
 * Define the app's full toolset: `defineTool` products (the DSH
 * `ToolDefinition` itself), local names ≤24 chars, unique in-app. Action
 * bodies live in actions.ts. Matrix points (§3.10.1): the list page takes an
 * arbitrary id (the browsing entry's legitimate duty); the detail page takes
 * "its own task" (take_page_task, no parameters) plus complete/abandon/split —
 * the delivery loop's take step rides on it.
 */
export function createAppTools(store: TaskStore, channel: TaskChannel, scope: PageTaskScope): ToolDefinition[] {
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
      name: 'take_page_task',
      description: '接取本页对应的那条任务（详情页专用，无需参数：接的就是 params.taskId 这条）。'
        + '本地列表翻 taken；该任务在任务中心时按目标 URL 匹配并接取 30 分钟租约，重复接取幂等；'
        + '被其他会话持有时返回 task/already-taken。Take the task this detail page is about — no arguments.',
      parameters: {},
      output: { schema: { type: 'object', additionalProperties: true } as const, render: renderValue },
      execute: async (_args, exec) => asJson(await takePageTask(store, channel, scope, exec)),
      presentCall: () => presentTaskCall('接取本页任务'),
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
