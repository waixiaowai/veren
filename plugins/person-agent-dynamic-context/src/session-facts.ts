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
import { deriveFallbackTitle, selectedPreset } from './session-events.js'

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
  const titleService: TitleService = ctx.get('sessionTitle')
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
    return {
      id,
      // 标题三级来源：已接纳标题 → 第一条人类消息派生 → 无（渲染层回退 id 片段）。
      // Title, three sources: accepted title → first human message → none (the
      // renderer falls back to an id fragment).
      title: session === undefined ? undefined : titleOf(titleService, session),
      // preset：日志最新一条 agent-preset/selected（latest-wins）优先于创建头，
      // 名册默认兜底。
      // preset: the log's latest agent-preset/selected (latest-wins) overrides
      // the creation header, with the roster default as fallback.
      preset: (session === undefined ? undefined : selectedPreset(session))
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
function titleOf(titleService: TitleService, session: Session): string | undefined {
  return titleService?.get(session)?.title ?? deriveFallbackTitle(session)
}

/**
 * The model route the latest recorded request actually used, or undefined when
 * the session is not attached or never recorded a request.
 * 最近一次已记录请求实际使用的模型路由；会话未挂载或从未记录请求时 undefined。
 */
function lastUsedRoute(ctx: Context, session: Session | undefined): { provider: string, model: string } | undefined {
  if (session === undefined) return undefined
  return ctx.sessionProjections.stateOf(session, 'modelSelection')?.lastUsed ?? undefined
}
