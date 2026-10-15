// 会话事实解析职责：把一个 SessionId 解析为检索可用的 SessionFacts。
// preset 来自会话头（rc.2 没有 agent-preset/selected 事件与 agentPreset 投影）；
// provider/model：活跃会话读持久化 modelSelection 投影的 lastUsed（最近一次
// 请求实际使用的路由），冷会话（已持久化未挂载）经可选 sessionQuery 读日志里
// 最新一条 `model/selection` 事件。服务缺失一律降级：sessionTitle 缺失标题为
// undefined，sessionQuery 缺失冷会话解析为 undefined（调用方跳过）。
// Session-facts resolution responsibility: turn a SessionId into the retrievable
// SessionFacts. The preset comes from the session header (rc.2 has no
// agent-preset/selected event and no agentPreset projection); provider/model:
// attached sessions read the durable modelSelection projection's lastUsed (the
// route the latest request actually used), cold (persisted, not attached)
// sessions fold the latest `model/selection` event from their log through the
// optional sessionQuery service. A missing service degrades: sessionTitle
// absent means an undefined title; sessionQuery absent resolves a cold session
// to undefined (the caller skips it).
import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
// 类型-only import：拉取 agents / sessionTitle / sessionQuery 服务的 Context
// 声明合并，以及 modelSelection 投影键与 `model/selection` 事件类型
// （均为可选能力，运行时经 ctx.get 读取）。
// Type-only imports: pull the agents / sessionTitle / sessionQuery service
// Context declaration merging, plus the modelSelection projection key and the
// `model/selection` event type (all optional, read through ctx.get at runtime).
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-session-title'
import type {} from '@deepseek-ai/dsh-session-projection'

/**
 * The per-session facts the session-list tool filters and returns. `preset` is
 * the creation header's agent preset; `provider` / `model` are the route the
 * latest recorded request actually used, undefined when no request was recorded
 * (or, for cold sessions, the log holds no `model/selection` event).
 * 会话列表工具过滤与返回的单会话事实。`preset` 是创建头里的 agent preset；
 * `provider` / `model` 是最近一次已记录请求实际使用的路由，未记录过请求（或
 * 冷会话日志里没有 `model/selection` 事件）时为 undefined。
 */
export interface SessionFacts {
  /** Session id. 会话 id。 */
  id: string
  /** Creation time from the header (ms epoch). 会话头里的创建时间（毫秒时间戳）。 */
  createdAt: number
  /** Accepted session title, when a title source is mounted. 已接纳的标题（标题能力挂载时）。 */
  title?: string
  /** Agent preset from the creation header. 创建头里的 agent preset。 */
  preset?: string
  /** Provider of the latest recorded request. 最近一次已记录请求的 provider。 */
  provider?: string
  /** Model id of the latest recorded request. 最近一次已记录请求的模型 id。 */
  model?: string
  /** Whether the session's agent is currently running. 会话的 agent 是否正在运行。 */
  running: boolean
}

/**
 * Resolve one accounted session id into facts. Attached sessions read the
 * modelSelection projection and the in-memory header; cold sessions fold the
 * persisted log through sessionQuery. Undefined when the session is neither
 * attached nor readable from persistence.
 * 把一个账目内的会话 id 解析为事实。挂载中的会话读 modelSelection 投影与
 * 内存头；冷会话经 sessionQuery 折叠持久化日志。会话既未挂载也无法从持久化
 * 读取时 undefined。
 * @param ctx - 携带注入能力的宿主上下文。The host context carrying injected capabilities.
 * @param id - 工作区账目内的会话 id。The session id accounted under the workspace.
 */
export async function resolveSessionFacts(ctx: Context, id: string): Promise<SessionFacts | undefined> {
  const session: Session | undefined = ctx.sessions.get(id as never)
  if (session !== undefined) return liveFacts(ctx, session)
  return coldFacts(ctx, id)
}

/**
 * Facts of an attached session: preset from the creation header, route from
 * the modelSelection projection's lastUsed, title from sessionTitle, running
 * state from the agent registry.
 * 挂载中会话的事实：preset 取创建头，路由取 modelSelection 投影的 lastUsed，
 * 标题取 sessionTitle，运行状态取 agent 注册表。
 */
function liveFacts(ctx: Context, session: Session): SessionFacts {
  const selection = ctx.sessionProjections.stateOf(session, 'modelSelection')
  return {
    id: session.header.id,
    createdAt: session.header.createdAt,
    title: ctx.get('sessionTitle')?.get(session)?.title,
    preset: session.header.agentPreset,
    provider: selection?.lastUsed?.provider,
    model: selection?.lastUsed?.model,
    running: ctx.get('agents')?.get(session.header.id)?.status === 'running',
  }
}

/**
 * Facts of one cold (persisted, not attached) session through the optional
 * sessionQuery service: the creation header, the folded title, and the route
 * from the latest `model/selection` event. Undefined when the service is not
 * mounted or the read fails.
 * 经可选 sessionQuery 服务读取一个冷会话（已持久化未挂载）的事实：创建头、
 * 折叠标题与最新一条 `model/selection` 事件的模型路由。服务未挂载或读取失败
 * 时 undefined。
 */
async function coldFacts(ctx: Context, id: string): Promise<SessionFacts | undefined> {
  const query = ctx.get('sessionQuery')
  if (query === undefined) return undefined
  const [log, title] = await Promise.all([
    query.readSession(id as never),
    query.readTitle(id as never).catch(() => undefined),
  ])
  let provider: string | undefined
  let model: string | undefined
  // 从最新向最旧扫描：路由取最新一条 `model/selection` 事件。
  // Scan newest-first: the route takes the latest `model/selection` event.
  for (let index = log.events.length - 1; index >= 0; index -= 1) {
    const event = log.events[index]
    if (event?.type !== 'model/selection') continue
    provider = event.data.provider
    model = event.data.model
    break
  }
  return {
    id,
    createdAt: log.session.createdAt,
    title: title?.title,
    preset: log.session.agentPreset,
    provider,
    model,
    running: false,
  }
}
