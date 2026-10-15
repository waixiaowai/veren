// 会话事实解析职责：把一个 SessionId 变成渲染层可用的 SessionInfo，逐个字段
// 说明它的来源与兜底顺序。宿主能力在工厂调用时一次性取得（本次快照内取值稳定），
// 返回的闭包只做纯读取。
// Session-facts resolution responsibility: turn a SessionId into the renderer's
// SessionInfo, documenting each field's source and fallback chain. Host
// capabilities are captured once at factory time (stable for this snapshot) and
// the returned closure performs reads only.
//
// 【类型来源唯一】`session` 就是宿主的 Session，日志读取函数收的就是它，中间不再
// 有任何自造结构面，因此不存在「调用处一个类型、函数签名另一个类型」的分叉。
// Single type source: `session` is the host's Session and the log readers take
// exactly that type, so no call site can drift from a signature.
import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import type { ColdHeader, SessionInfo } from './session-info.js'
import { deriveFallbackTitle, lastRequestRoute, selectedPreset } from './session-events.js'

/** The optional session-title capability, derived from the context declaration.
 * 可选的 session-title 能力，直接从上下文声明推导（不再另立结构面）。 */
type TitleService = Context['sessionTitle']

/** The deployment default selection, derived from the context declaration.
 * 部署默认模型选择，直接从上下文声明推导。 */
type DefaultSelection = ReturnType<Context['agentDefaultModel']['currentSelection']>

/**
 * Resolve one SessionId into renderable session facts, reading the same Host
 * sources as the Web client's session list (`session-controller/list.ts`):
 * running state from the live agent registry (`ctx.agents.get(id)?.status`),
 * title from the session-title service (falling back to the first human
 * message), model route from the durable `modelSelection` projection with the
 * deployment default as fallback, and the preset from the session header (or
 * the cold-session header from sessionQuery) with the roster default as
 * fallback.
 * 把一个 SessionId 解析为可渲染的会话信息，读取与 Web 端会话列表相同的宿主
 * 数据源（`session-controller/list.ts`）：运行状态来自活跃 agent 注册表
 * （`ctx.agents.get(id)?.status`），标题来自 session-title 服务（回退到第一
 * 条人类消息），模型路由来自持久化 `modelSelection` 投影（部署默认兜底），
 * preset 取会话头（冷会话取 sessionQuery 持久化头，名册默认兜底）。
 */
export function createSessionInfoResolver(
  ctx: Context,
  coldHeaders: ReadonlyMap<string, ColdHeader>,
): (id: string) => SessionInfo | undefined {
  // sessionTitle 是可选能力：ctx.get 返回带 undefined 的类型，titleOf 的参数
  // 同步放宽为可缺省。
  // sessionTitle is an optional capability: ctx.get returns a type that
  // includes undefined, so titleOf's parameter widens to optional.
  const titleService = ctx.get('sessionTitle')
  const defaultSelection: DefaultSelection | undefined = ctx.get('agentDefaultModel')?.currentSelection()
  return (id: string): SessionInfo | undefined => {
    const session: Session | undefined = ctx.sessions.get(id as never)
    // 挂载中的会话读内存头；冷会话（已持久化未挂载）读 sessionQuery 记录头。
    // Attached sessions read the in-memory header; cold (persisted, not
    // attached) sessions read the sessionQuery record header.
    const header = session?.header ?? coldHeaders.get(id)
    if (header === undefined) return undefined
    // provider/model：先读持久化 modelSelection 投影的 lastUsed（最近一次
    // 请求实际使用的路由），从未请求过的会话回退到部署默认模型。
    // provider/model: the durable modelSelection projection's lastUsed (the
    // route the latest request actually used); sessions that never requested
    // fall back to the deployment default model.
    const lastUsed = lastUsedRoute(ctx, session)
    // preset 四级来源：agentPreset 投影（前端徽章同源，随切换实时更新）→
    // 日志最新一条 agent-preset/selected → 创建头 → 名册默认。
    // preset, four sources: the agentPreset projection (same source as the
    // client's badge, updated on every switch) → the log's latest
    // agent-preset/selected → the creation header → the roster default.
    const projectedPreset = session === undefined
      ? undefined
      : ctx.sessionProjections.stateOf(session, 'agentPreset') as string | undefined
    return {
      id,
      // 标题三级来源：已接纳标题 → 第一条人类消息派生 → 无（渲染层回退 id 片段）。
      // Title, three sources: accepted title → first human message → none (the
      // renderer falls back to an id fragment).
      title: session === undefined ? undefined : titleOf(titleService, session),
      preset: projectedPreset
        ?? (session === undefined ? undefined : selectedPreset(session))
        ?? header.agentPreset ?? ctx.agentPresets.defaultId,
      provider: lastUsed?.provider ?? defaultSelection?.provider,
      model: lastUsed?.model ?? defaultSelection?.model,
      createdAt: header.createdAt,
      running: ctx.agents.get(id as never)?.status === 'running',
    }
  }
}

/**
 * The session's accepted title, or the title derived from its first eligible
 * human message; undefined when neither source has text.
 * 会话已接纳的标题，或由首条合格人类消息派生的标题；两者都没有时 undefined。
 */
function titleOf(titleService: TitleService | undefined, session: Session): string | undefined {
  return titleService?.get(session)?.title ?? deriveFallbackTitle(session)
}

/**
 * The model route the latest recorded request actually used, or undefined when
 * the session is not attached or never recorded a request. Read from the
 * session log's newest `request/header` — the same source the Web client's
 * model-selection fold consumes.
 * 最近一次已记录请求实际使用的模型路由；会话未挂载或从未记录请求时 undefined。
 * 读取会话日志最新的 `request/header` —— 与 Web 端模型选择折叠同一数据源。
 */
function lastUsedRoute(ctx: Context, session: Session | undefined): { provider: string, model: string } | undefined {
  if (session === undefined) return undefined
  return lastRequestRoute(session)
}

/**
 * Read one cold (persisted, not attached) session's facts through the
 * optional sessionQuery service: the folded title, the preset from the log's
 * latest `agent-preset/selected`, the model route from the latest
 * `request/header`, and the creation time. Undefined when the service is not
 * mounted or the session cannot be read.
 * 经可选的 sessionQuery 服务读取一个冷会话（已持久化未挂载）的事实：折叠
 * 标题、日志最新 `agent-preset/selected` 的 preset、最新 `request/header`
 * 的模型路由与创建时间。服务缺失或读取失败时 undefined。
 */
export async function readColdSessionFacts(ctx: Context, id: string): Promise<SessionInfo | undefined> {
  const query = ctx.get('sessionQuery')
  if (query === undefined) return undefined
  const [log, title] = await Promise.all([
    query.readSession(id as never),
    // 冷会话的折叠标题与活跃会话的 sessionTitle.get 同源（latest-wins）。
    // The cold session's folded title shares its source with sessionTitle.get
    // for attached sessions (latest-wins).
    query.readTitle(id as never).catch(() => undefined),
  ])
  // 与活跃会话同源的字段读取：标题折叠、最新 preset 选择、最新模型路由。
  // The same field reads as attached sessions: folded title, latest preset
  // selection, latest model route.
  let preset = log.session.agentPreset
  let provider: string | undefined
  let model: string | undefined
  for (let index = log.events.length - 1; index >= 0; index -= 1) {
    const event = log.events[index]
    if (preset === undefined && event.type === 'agent-preset/selected') {
      preset = (event.data as { agentPreset?: string }).agentPreset
    }
    if (event.type === 'request/header') {
      const config = (event.data as { header?: { config?: { provider?: string, model?: string } } }).header?.config
      provider = config?.provider
      model = config?.model
    }
    if (preset !== undefined && provider !== undefined) break
  }
  return { id, title: title?.title, preset, provider, model, createdAt: log.session.createdAt }
}
