/** taskhub source kind: cms task-router worker registration, dispatch intake, and reply/result uplink. */
/** taskhub 来源 kind：cms 任务路由的节点注册、派发接收与回复/完成回报上行。 */
import type { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'
import type { ChannelRef, OutboundMessage, Ticket, Trigger } from '../core/index.ts'
import { TaskhubConnection } from '../infra/taskhub/connection.ts'
import { EVENT_TASK_REPLY, EVENT_TASK_RESULT, validateEnvelope, type DispatchEnvelope } from '../infra/taskhub/protocol.ts'
import { health, sourceContext, type Health, type SourceContext } from './host.ts'
import { pause } from './poll.ts'
import type { Localized, SourceKind } from './kind.ts'

export const SOURCE = 'taskhub'
/** Thread key prefix of every taskhub thread; the rest is the cms task id. */
export const taskhubThread = (taskId: string): ChannelRef =>
  ({ source: SOURCE, thread: `${SOURCE}:${taskId}`, address: {} })

export const TaskhubConfigSchema = z.object({
  url: z.string().default(''),
  token: z.string().default(''),
  nodeId: z.string().min(1).default('superagent'),
  title: z.string().min(1).default('通用工作节点'),
  description: z.string().default(''),
  tags: z.array(z.string()).default([]),
  maxConcurrent: z.number().int().min(1).max(20).default(1),
}).strict()
export type TaskhubConfig = z.infer<typeof TaskhubConfigSchema>

/** Ticket outcome → wire outcome (contract §4 projection of the closed set). */
const outcomeOf = (ended: Ticket['ended']): 'completed' | 'stopped' =>
  ended?.outcome === 'completed' || ended?.outcome === 'merged' || ended?.outcome === 'closed' ? 'completed' : 'stopped'

export const taskhubKind: SourceKind<TaskhubConfig> = {
  kind: SOURCE,
  title: { zh: 'CMS 任务路由', en: 'CMS task router' },
  description: {
    zh: '作为 cms 任务路由（taskhub）的工作节点：按 title/description/tags 接收分派的任务，完成后把回复送回来源渠道与下单人。',
    en: 'A worker node of the cms task router (taskhub): receives dispatched tasks by title/description/tags and returns replies to the origin channel and requester.',
  },
  schema: TaskhubConfigSchema,
  fields: [
    { key: 'url', type: 'text', pattern: 'wss?://.*', label: { zh: 'cms WS 端点', en: 'cms WS endpoint' },
      hint: { zh: '写作 wss://veren.top/v1/ws。保存后本节点即注册为工作节点。', en: 'Written wss://veren.top/v1/ws. Saving registers this node as a worker.' } },
    { key: 'token', type: 'text', label: { zh: 'cms 用户 API Key', en: 'cms user API Key' },
      hint: { zh: '在 cms 后台创建的 API Key；决定本节点接入哪个用户的工作节点池。', en: 'An API Key created in the cms console; it decides which user\'s worker pool this node joins.' } },
    { key: 'nodeId', type: 'text', label: { zh: '节点 ID', en: 'Node ID' },
      hint: { zh: '稳定唯一串（跨重启不变）；cms 按它记住本节点。', en: 'A stable unique string (survives restarts); cms remembers this node by it.' } },
    { key: 'title', type: 'text', label: { zh: '节点标题（路由依据）', en: 'Title (routing key)' },
      hint: { zh: 'cms 路由器按标题/简介/标签为任务挑节点；写清本节点擅长什么。', en: 'The cms router picks nodes for a task by title/description/tags; state what this node is good at.' } },
    { key: 'description', type: 'text', label: { zh: '节点简介（路由依据）', en: 'Description (routing key)' } },
    { key: 'tags', type: 'rows', label: { zh: '标签（路由依据，权重最高）', en: 'Tags (routing keys, highest weight)' },
      columns: [{ key: 'id', type: 'text', label: { zh: '标签', en: 'Tag' } }] },
    { key: 'maxConcurrent', type: 'number', min: 1, max: 20, label: { zh: '并发任务上限', en: 'Max concurrent tasks' } },
  ],
  scope: () => ({ listened: true, observed: false }),
  health: ['taskhub'],
  policy: {
    schema: z.object({ allowed: z.array(z.object({ id: z.string() }).strict()).default([]) }).strict(),
    fields: [{ key: 'allowed', type: 'rows', label: { zh: '能发起工作的下单人', en: 'Requesters that may originate work' },
      columns: [{ key: 'id', type: 'text', label: { zh: '标识', en: 'Identity' } }] }],
    explicit: { zh: '下单人经 cms intake 规则放行后，任务即以其名义直达本节点（@ 语义恒成立）。', en: 'Once the cms intake rule admits a requester, the task arrives here in their name (always addressed).' },
    rows() {
      return [{ id: 'task', label: { zh: '分派的任务', en: 'Dispatched tasks' },
        note: { zh: 'cms 已过滤', en: 'cms-gated' },
        cells: { listedUnaddressed: false, unlistedAddressed: true, unlistedUnaddressed: false } }]
    },
  },
  environment: {
    variables: [
      { key: 'DSH_SUPERAGENT_TASKHUB_TASK', description: { zh: '本工单对应的 cms 任务 id；工单不是从任务路由来的时为空', en: 'The cms task id behind this ticket; empty when the ticket did not start on the task router' } },
      { key: 'DSH_SUPERAGENT_TASKHUB_ORIGIN', description: { zh: '任务来源渠道（如 wechat）；回复会沿它送回', en: 'The origin channel (e.g. wechat); replies return along it' } },
      { key: 'DSH_SUPERAGENT_TASKHUB_REQUESTER', description: { zh: '下单人标识；结果会回复给这个人', en: 'The requester identity; the result is replied to this person' } },
    ],
    values: ({ trigger }) => {
      const task = trigger?.threads[0]?.source === SOURCE ? String(trigger.meta.taskId ?? '') : ''
      const origin = trigger?.meta.originSource
      return { DSH_SUPERAGENT_TASKHUB_TASK: task,
        DSH_SUPERAGENT_TASKHUB_ORIGIN: task && typeof origin === 'string' ? origin : '',
        DSH_SUPERAGENT_TASKHUB_REQUESTER: task && trigger ? String(trigger.actor.id) : '' }
    },
  },
  channel: {
    async send(_host, message) {
      const task = taskIdOf(message.channel.thread)
      if (!task) throw new Error(`Missing taskhub task id in thread ${message.channel.thread}`)
      const result = await active?.report(EVENT_TASK_REPLY, { taskId: task, messageId: message.id, text: message.text })
      if (result && !result.delivered) throw new Error('taskhub bridge disposed; the Outbox will retry')
      return 'sent'
    },
    link: address => ({ url: '', label: { zh: `会话 ${address.conversation ?? ''}`, en: `Conversation ${address.conversation ?? ''}` } }),
  },
  find: query => ({ threads: query.trim() !== '' ? [`${SOURCE}:${query.trim()}`] : [], terms: [] }),
}
/** Extracts the cms task id from a `taskhub:<id>` thread key. */
function taskIdOf(thread: string): string | undefined {
  return thread.startsWith(`${SOURCE}:`) ? thread.slice(SOURCE.length + 1) : undefined
}

/** The uplink face the runtime hooks consume (TaskhubConnection satisfies it; tests bind fakes). */
/** 运行时钩子消费的上行面（TaskhubConnection 满足它；测试可绑假件）。 */
export interface TaskhubBridge { report(name: string, payload: unknown): Promise<{ delivered: boolean }> }

/** The live bridge of the enabled Source instance; the runtime's end hook consumes it. */
let active: TaskhubBridge | undefined

/** Binds the module bridge (watch owns it in production; tests bind fakes). */
/** 绑定模块桥（生产由 watch 持有；测试绑假件）。 */
export const bindBridge = (bridge: TaskhubBridge | undefined): void => { active = bridge }

/** Maps a taskhub Trigger into a dispatch Trigger for the Engine. */
export function triggerOf(envelope: DispatchEnvelope): Trigger {
  return {
    id: envelope.taskId,
    source: SOURCE,
    threads: [{ source: SOURCE, id: envelope.taskId }],
    actor: { source: SOURCE, id: envelope.origin.requester },
    human: true,
    addressed: 'direct',
    at: new Date(envelope.createdAt * 1000).toISOString(),
    text: envelope.intent,
    channel: { source: SOURCE, thread: `${SOURCE}:${envelope.taskId}`,
      address: { conversation: envelope.origin.conversation, requester: envelope.origin.requester } },
    meta: { taskId: envelope.taskId, originSource: envelope.origin.source },
  }
}

/** Runtime hook (ticket.ended): reports completion so cms can deliver the result. */
/** 运行时挂点（ticket.ended）：回报完成，cms 据此向来源投递结果。 */
export function notifyTaskhubEnded(trigger: Trigger | undefined, ended: Ticket): void {
  const thread = trigger?.threads[0]
  if (!thread || thread.source !== SOURCE || !ended.ended) return
  void active?.report(EVENT_TASK_RESULT, {
    taskId: thread.id, outcome: outcomeOf(ended.ended), summary: ended.ended.reason ?? '',
  })
}

/** Runtime hook (decision.recorded): an ignore on a taskhub thread means this node refused the task. */
/** 运行时挂点（decision.recorded）：taskhub 线程上的 ignore 即本节点拒绝该任务。 */
export function notifyTaskhubIgnored(threadKey: string): void {
  const task = taskIdOf(threadKey)
  if (!task) return
  void active?.report(EVENT_TASK_RESULT, { taskId: task, outcome: 'stopped', summary: '该节点评估后未接下此任务。' })
}

export const name = 'dsh-superagent-taskhub'
export const inject = ['orchestrator']
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.orchestrator.sources.register(taskhubKind), 'taskhub: source kind')
  ctx.effect(() => {
    const source = sourceContext(ctx.orchestrator, taskhubKind)
    const controller = new AbortController()
    const running = watch(source, controller.signal)
      .catch((error: unknown) => { source.report('taskhub', { state: 'error', detail: String(error) }) })
    return async () => { controller.abort(); await running }
  })
}

/** Watch loop: keeps one connection alive per config; reports health; owns `active`. */
async function watch(ctx: SourceContext, signal: AbortSignal): Promise<void> {
  await ctx.ready
  let current: { config: TaskhubConfig; connection: TaskhubConnection } | undefined
  while (!signal.aborted) {
    const config = ctx.config<TaskhubConfig>(SOURCE)
    if (!config || !config.url || !config.token) {
      retire(current)
      current = undefined
      if (config) ctx.report('taskhub', health('paused', 'taskhubUnset'))
      else ctx.report('taskhub', health('paused', 'sourceOff'))
    } else {
      current = await ensure(current, config, ctx)
      ctx.report('taskhub', connectionHealth(current.connection))
    }
    await pause(5000, signal)
  }
  retire(current)
  active = undefined
}

async function ensure(current: { config: TaskhubConfig; connection: TaskhubConnection } | undefined,
  config: TaskhubConfig, ctx: SourceContext) {
  if (current && sameConnection(current.config, config)) return current
  retire(current)
  let running = 0
  const connection: TaskhubConnection = new TaskhubConnection({
    url: config.url, token: config.token,
    hello: { nodeId: config.nodeId, title: config.title, description: config.description,
      tags: config.tags, maxConcurrent: config.maxConcurrent },
    // Dispatch intake: validates the envelope, ingests the Trigger, answers accept/refuse.
    // 派发接收：校验信封、灌入 Trigger，应答接单/拒绝。
    onCommand: (action, payload): Promise<unknown> | unknown => {
      if (action !== 'task.dispatch') throw new Error(`unknown action ${action}`)
      const problem = validateEnvelope(payload)
      if (problem) throw new Error(problem)
      const envelope = payload as DispatchEnvelope
      const settle = (accepted: boolean, error?: unknown): { accepted: boolean; reason?: string } => {
        running -= 1
        connection.setRunning(running)
        return accepted ? { accepted } : { accepted, reason: String(error) }
      }
      running += 1
      connection.setRunning(running)
      return Promise.resolve(ctx.receive(triggerOf(envelope))).then(
        () => settle(true), (error: unknown) => settle(false, error))
    },
  })
  connection.connect()
  active = connection
  return { config, connection }
}

function retire(current: { connection: TaskhubConnection } | undefined): void {
  if (current && active === current.connection) active = undefined
  current?.connection.dispose()
}

const sameConnection = (a: TaskhubConfig, b: TaskhubConfig): boolean =>
  a.url === b.url && a.token === b.token && a.nodeId === b.nodeId && a.title === b.title
  && a.description === b.description && a.maxConcurrent === b.maxConcurrent && a.tags.join(',') === b.tags.join(',')

function connectionHealth(connection: TaskhubConnection): Health {
  const state = connection.bridgeState
  if (state === 'connected') return health('ready', 'taskhubConnected')
  if (state === 'awaiting-credential') return health('error', 'taskhubCredential')
  return health('starting', 'taskhubConnecting', { state })
}
