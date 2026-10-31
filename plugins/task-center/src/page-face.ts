/**
 * 投递目标页的页面作用域完成回报面（docs/unattended-page-contract.cn.md §6 的
 * 一般形态）。取证结论（2026-10-29）：页面会话只见组件体登记的工具——宿主全局
 * `task_take/task_complete/task_fail`（tools.ts，config.tools.enabled 门）在
 * 页面会话里不可达，投递闭环在"目标页回报"这最后一环断裂。本文件把同一组
 * 动词以**页面作用域、无 id 参数**的形态交给目标页组件体登记：
 * - `task_take`：接取目标 URL 就是本页的那条 open 记录（本会话持有则幂等续租）；
 * - `task_complete { summary, artifacts? }`：本页被本会话接取的那条 → done；
 * - `task_fail { code, message }`：同上 → failed。
 * 名字与全局面逐字相同是刻意的：TASK 块与收件箱通知的既定指引（"接取用
 * task_take…完成后调用 task_complete"）因此在页面会话里逐字为真，模型无需
 * 第二套词汇。作用域收窄（URL 即主键 + 无 id 可伪造）承担防伪，接取者校验
 * 承担互斥——与全局面同一条语义。
 * The page-scoped completion face for delivery-target pages (the general shape
 * of docs/unattended-page-contract.md §6). Evidence (2026-10-29): a page
 * session sees only what its body registers — the host-global
 * `task_take/task_complete/task_fail` (tools.ts, config-gated) are unreachable
 * there, so the delivery loop snapped at its last link, the target page's
 * report. This file hands the SAME verbs to target pages as **page-scoped,
 * parameterless-id** tools the body registers: `task_take` takes the open
 * record whose target url is this page (idempotent renewal when this session
 * holds it); `task_complete`/`task_fail` close the record this session took.
 * Identical names are deliberate: the TASK block and inbox notice's standing
 * guidance ("take with task_take… report with task_complete") then reads
 * verbatim true in page sessions — no second vocabulary. The narrowed scope
 * (the url is the primary key; no forgeable id) provides the anti-forgery, the
 * claimant check the mutex — the same semantics as the global face.
 * @module @veren/task-center/page-face
 */
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { TaskError } from './tree.ts'
import type { TaskCenterContract, TaskRecord } from './types.ts'

/** 缺省租约时长（与全局工具同口径）/ the default lease (same as the global tools) */
const LEASE_MINUTES = 30

/**
 * 页面作用域解析面：本会话所在页面实例的规范 URL。由装配用 page-registry 的
 * 实例索引实现（live 行的 url 字段）；解析不到 = 本工具跑在非页面会话里。
 * / The page-scope resolver: this session's page instance's canonical url.
 * Assembly implements it over the page-registry instance index (the live row's
 * url); unresolvable = the tool ran outside any page session.
 */
export interface PageTaskScope {
  readonly urlOfSession: (sessionId: string) => Promise<string | undefined>
}

/** 工具结果渲染成 JSON 文本（模型可读，UI 通用卡片）/ render outcomes as JSON text */
function renderValue(_args: unknown, value: unknown): ContentBlock[] {
  return [{ type: 'text', text: JSON.stringify(value) }] as ContentBlock[]
}

/** 输出 schema（与全局 task 工具同形）/ the output schema (same shape as the global task tools) */
const TASK_SCHEMA = { type: 'object', additionalProperties: false, properties: { task: { type: 'json', required: true } } } as const

/** 解析调用方会话与本页 URL；缺一即页面作用域拒绝 / resolve the caller's session and page url; either missing = the page-scope refusal */
async function resolvePageTask(
  port: () => TaskCenterContract,
  scope: PageTaskScope,
  agent: Agent | undefined,
): Promise<{ sessionId: string; record: TaskRecord }> {
  const sessionId = agent?.session?.id
  if (sessionId === undefined) throw new TaskError('page-task-unresolvable', 'the tool ran outside any session')
  const url = await scope.urlOfSession(sessionId)
  if (url === undefined) throw new TaskError('page-task-unresolvable', 'the calling session is not a live page session')
  // 目标 URL 是任务主键（§4.2）：先找本会话持有的那条（续租/回报），否则找
  // open 的那条（首次接取）。终态记录不是候选。
  // / The target url is the task primary key (§4.2): this session's held record
  // first (renew/report), else an open one (first take). Terminal records are
  // not candidates.
  const records = await port().list({})
  const onThisPage = records.filter((record) => record.target.url === url
    && (record.status === 'open' || record.status === 'taken'))
  const held = onThisPage.find((record) => record.status === 'taken' && record.claimedBy?.sessionId === sessionId)
  const record = held ?? onThisPage.find((candidate) => candidate.status === 'open')
  if (record === undefined) {
    // 被别人持有 ≠ 没有：报 already-taken（模型可等租约到期或放弃），别谎报 not-found
    // / held elsewhere ≠ absent: report already-taken (the model can wait out the
    // lease or give up) instead of lying not-found
    const takenElsewhere = onThisPage.find((candidate) => candidate.status === 'taken')
    if (takenElsewhere !== undefined) {
      throw new TaskError('task/already-taken', `the task on this page is held by session ${takenElsewhere.claimedBy?.sessionId ?? 'unknown'}`)
    }
    throw new TaskError('task/not-found', `no deliverable task targets this page (${url})`)
  }
  return { sessionId, record }
}

/** 无损 JSON 规整（TaskRecord → output schema 的 json 形；与全局工具的 jsonOf 同一口径）
 * / normalize to the lossless JSON the output schema carries (same as the global tools' jsonOf) */
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }
function jsonOf<T extends object>(value: T): { [K in keyof T]: JsonValue } {
  return JSON.parse(JSON.stringify(value)) as { [K in keyof T]: JsonValue }
}

/** 租约到期时刻 / the lease deadline */
function leaseAhead(): string {
  return new Date(Date.now() + LEASE_MINUTES * 60_000).toISOString()
}

/**
 * 构建页面作用域 task 三件（task_take / task_complete / task_fail）。名字与
 * 全局面逐字相同、语义收窄到"本页那条"——目标页组件体直接登记。
 * Build the page-scoped task trio. The names match the global face verbatim
 * and the semantics narrow to "this page's record" — target-page bodies
 * register these directly.
 */
export function buildPageTaskTools(port: () => TaskCenterContract, scope: PageTaskScope): ToolDefinitionLike[] {
  return [
    pageTaskTakeTool(port, scope),
    pageTaskCompleteTool(port, scope),
    pageTaskFailTool(port, scope),
  ]
}

/** 页面作用域 task_take：接取/续租本页那条 / the page-scoped task_take: take or renew this page's record. */
function pageTaskTakeTool(port: () => TaskCenterContract, scope: PageTaskScope): ToolDefinitionLike {
  return defineTool({
    name: 'task_take',
    description: '接取投递到本页的那条任务（无需参数：目标 URL 就是本页；本会话已持有则续租 30 分钟）。'
      + 'Take the task delivered to this page — no arguments; renews the 30-minute lease when this session already holds it.',
    parameters: {},
    output: { schema: TASK_SCHEMA, render: renderValue },
    async execute(_args, exec) {
      const { sessionId, record } = await resolvePageTask(port, scope, exec.agent)
      const taken = await port().take(record.id, { sessionId, actor: 'model', leaseUntil: leaseAhead() })
      return { task: jsonOf(taken) }
    },
    presentCall: () => ({ card: 'generic', title: '接取本页任务', kind: 'other' }),
  })
}

/** 页面作用域 task_complete：结算本页被本会话接取的那条 / the page-scoped task_complete: settle the record this session took. */
function pageTaskCompleteTool(port: () => TaskCenterContract, scope: PageTaskScope): ToolDefinitionLike {
  return defineTool({
    name: 'task_complete',
    description: '完成本页那条已被本会话接取的任务：summary 必填（一句话结果），artifacts 可选（id/路径/URL 引用，不搬正文）。'
      + 'Complete the task this page\u2019s session has taken: summary required, optional artifact references.',
    parameters: {
      summary: { type: 'string', required: true, description: '一句话结果（完成证据）' },
      artifacts: { type: 'array', description: '产物引用（id/路径/URL）' },
    },
    output: { schema: TASK_SCHEMA, render: renderValue },
    async execute(args, exec) {
      const summary = typeof args.summary === 'string' ? args.summary.trim() : ''
      if (summary.length === 0) throw new TaskError('task/draft-invalid', 'summary is required (the completion evidence)')
      const { record } = await resolvePageTask(port, scope, exec.agent)
      const completed = await port().complete(record.id, {
        summary,
        ...(Array.isArray(args.artifacts) ? { artifacts: args.artifacts.filter((a): a is string => typeof a === 'string') } : {}),
      })
      return { task: jsonOf(completed) }
    },
    presentCall: args => ({ card: 'generic', title: '完成本页任务', kind: 'other', rawInput: args }),
  })
}

/** 页面作用域 task_fail：把本页被本会话接取的那条标失败 / the page-scoped task_fail: fail the record this session took. */
function pageTaskFailTool(port: () => TaskCenterContract, scope: PageTaskScope): ToolDefinitionLike {
  return defineTool({
    name: 'task_fail',
    description: '把本页那条已被本会话接取的任务标为失败：code 用稳定错误码，message 说明原因。做不下去时必须调用——否则任务挂着直到租约到期。'
      + 'Fail the task this session has taken with a stable code; call it whenever the work cannot be finished.',
    parameters: {
      code: { type: 'string', required: true, description: '稳定错误码' },
      message: { type: 'string', required: true, description: '失败原因' },
    },
    output: { schema: TASK_SCHEMA, render: renderValue },
    async execute(args, exec) {
      const code = typeof args.code === 'string' ? args.code.trim() : ''
      const message = typeof args.message === 'string' ? args.message.trim() : ''
      if (code.length === 0 || message.length === 0) throw new TaskError('task/draft-invalid', 'code and message are required')
      const { record } = await resolvePageTask(port, scope, exec.agent)
      return { task: jsonOf(await port().fail(record.id, { code, message })) }
    },
    presentCall: args => ({ card: 'generic', title: '本页任务失败', kind: 'other', rawInput: args }),
  })
}

/** 本文件只用到 ToolDefinition 的形状；从 dsh-tools 的 defineTool 产物自然满足
 * / only the ToolDefinition shape is needed here; defineTool's product satisfies it */
type ToolDefinitionLike = ReturnType<typeof defineTool>
