// 会话日志读取职责：把「日志里有哪些事件」封装起来，只暴露语义化读取（首条人类
// 消息派生的标题、最新一次 preset 选择、最近一条快照文本）。
// Session-log reading responsibility: wraps "which events the log holds" and
// exposes semantic reads only (the fallback title from the first human message,
// the latest preset selection, the latest snapshot text).
//
// 【为什么这里只读视图、而 Session 仍是唯一来源】渲染层要的只是「事件列表」，
// 把参数写成整个 Session（带 append/publish 等写能力）会让渲染层误以为它可以改
// 会话。因此这里用的是**从宿主 Session 推导出来的只读视图**，而不是另写一套定义：
// 视图是宿主类型的投影，宿主一变视图自动跟着变，不存在第二个来源。
// Why a read-only view here while Session stays the single source: the renderer
// only needs "the list of events". Typing it as the whole Session (with append /
// publish write powers) would invite a renderer to mutate a session. So the
// view is *derived* from the host's Session — a projection, not a second
// definition — and it follows any host change automatically.
import { SessionSeq } from '@deepseek-ai/dsh-session'
import type { Session, SessionLogOffset } from '@deepseek-ai/dsh-session'

/**
 * The event shape this module reads, derived from the host's `Session`: whatever
 * `snapshotEvents()` yields, element by element. Deriving beats re-declaring — a
 * host-side change flows in automatically.
 * 本模块读取的事件形状，直接从宿主的 `Session` 推导：`snapshotEvents()` 的返回
 * 元素类型。推导优于重声明——宿主一变，这里自动跟着变。
 */
export type SnapshotEvent = ReturnType<Session['snapshotEvents']>[number]

/** The payload of one log event. 一条日志事件的负载。 */
export type LogEventData = SnapshotEvent['data']

/**
 * A read-only view of the session's log: the single capability every reader in
 * this module needs. A `Session` satisfies it structurally, so callers pass
 * `agent.session` with no conversion; the type-pins file asserts exactly that.
 * 会话日志的只读视图：本模块每个读取函数唯一需要的能力。`Session` 在结构上天然
 * 满足它，所以调用处直接把 `agent.session` 传进来即可，无需任何转换；type-pins
 * 文件对此有显式断言。
 */
export interface SessionLogView {
  /** Ordered snapshot of the session's log. 会话日志的有序快照。 */
  snapshotEvents(): readonly SnapshotEvent[]
  /** Read one log event by sequence. 按序号读取一条日志事件。 */
  eventAt(seq: SessionSeq): SnapshotEvent | undefined
}

/** Longest fallback title before ellipsis. 回退标题省略号前的最大长度。 */
const MAX_FALLBACK_TITLE = 40
/** How many leading words a fallback title keeps. 回退标题保留的前导词数量。 */
const FALLBACK_TITLE_WORDS = 8

/**
 * Read the session's ordered log snapshot. The host marks `snapshotEvents` as
 * deprecated (new call sites are prohibited), so the suppression comment sits
 * here — the single place that touches the deprecated reader.
 * 读取会话的有序日志快照。宿主已把 `snapshotEvents` 标记为弃用（禁止新增调用点），
 * 因此禁告警注释只留在这里——唯一接触该弃用读取器的地方。
 */
// oxlint-disable-next-line typescript/no-deprecated -- Existing Session history read; migration deferred.
export const logEvents = (session: SessionLogView): readonly SnapshotEvent[] => session.snapshotEvents()

/**
 * The text of one `user/message` event when it counts as eligible human input.
 * The discriminant narrows the host union, so `source` and `content` are typed —
 * no hand-written shape guards needed.
 * 一条 `user/message` 事件在构成合格人类输入时的文本。判别字段直接收窄宿主联合，
 * `source` 与 `content` 都是有类型的——不需要手写形状守卫。
 */
function humanText(event: SnapshotEvent): string | undefined {
  if (event.type !== 'user/message') return undefined
  const data = event.data
  const kind = data.source.kind
  if (kind !== undefined && kind !== 'user') return undefined
  const text = data.content
    .filter((block) => block.type === 'text')
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join(' ')
    .trim()
  return text === '' ? undefined : text
}

/**
 * Derive the fallback title the way the session-title service's built-in
 * fallback does: the leading words of the first eligible human message.
 * 按 session-title 内置回退规则派生标题：第一条合格人类消息的前导词。
 */
export function deriveFallbackTitle(session: SessionLogView): string | undefined {
  for (const event of logEvents(session)) {
    const text = humanText(event)
    if (text === undefined) continue
    const leading = text.split(/\s+/u).slice(0, FALLBACK_TITLE_WORDS).join(' ')
    return leading.length > MAX_FALLBACK_TITLE ? `${leading.slice(0, MAX_FALLBACK_TITLE)}…` : leading
  }
  return undefined
}

/**
 * Read the session's current preset, latest-wins: the newest
 * `agent-preset/selected` event in the log overrides the creation header.
 * 读取会话当前 preset，latest-wins：日志里最新一条 `agent-preset/selected`
 * 事件优先于创建头。
 */
export function selectedPreset(session: SessionLogView): string | undefined {
  const events = logEvents(session)
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type !== 'agent-preset/selected') continue
    return event.data.agentPreset
  }
  return undefined
}

/**
 * Scan the session backwards for this plugin's latest snapshot text. The
 * sequence comes from the host (`agent.session.seq`), so the call site passes
 * host values straight through.
 * 从会话末尾向前扫描本插件最近一条快照的文本。序号来自宿主
 * （`agent.session.seq`），调用处直接透传宿主的值。
 */
export function lastSnapshotText(session: SessionLogView, seq: SessionLogOffset, source: string): string | undefined {
  for (let index = Number(seq) - 1; index >= 0; index -= 1) {
    const event = session.eventAt(SessionSeq(index))
    if (event?.type !== 'user/message' || event.data.source.kind !== source) continue
    const first = event.data.content[0]
    return first?.type === 'text' ? first.text : undefined
  }
  return undefined
}

/**
 * Scan the session backwards for the latest snapshot message of `source` that
 * carries `section` in its recorded sections, and return that section's text.
 * This is the per-section change detection read: a section is appended only
 * when its newly rendered text differs from what this returns.
 * 从会话末尾向前扫描 `source` 最近一条记录了 `section` 区块的快照消息，返回该
 * 区块的文本。这是按块变化检测的读取端：仅当新渲染的文本与返回值不同时才追加
 * 该区块。
 */
export function lastSnapshotSectionText(
  session: SessionLogView,
  seq: SessionLogOffset,
  source: string,
  section: string,
): string | undefined {
  for (let index = Number(seq) - 1; index >= 0; index -= 1) {
    const event = session.eventAt(SessionSeq(index))
    if (event?.type !== 'user/message' || event.data.source.kind !== source) continue
    // source 的区块列表按消息来源联合的公共形状防御性读取：所有来源都可选携带
    // sections，缺失即「该消息不含此区块」，继续向前扫描。
    // The section list is read defensively against the common shape of the
    // message-source union: every source may carry optional sections; absence
    // means "this message does not hold the section", keep scanning.
    const recorded = (event.data.source as { sections?: readonly { name: string, text: string }[] }).sections
      ?? []
    const match = recorded.find((part) => part.name === section)
    if (match !== undefined) return match.text
  }
  return undefined
}

/**
 * The provider/model route the session's latest recorded request actually
 * used, read from the newest `request/header` event; undefined when the log
 * holds no request header (the caller falls back to the deployment default).
 * 会话最近一次已记录请求实际使用的 provider/model 路由，读取自最新一条
 * `request/header` 事件；日志中没有请求头时 undefined（调用方回退到部署
 * 默认模型）。
 */
export function lastRequestRoute(session: SessionLogView): { provider: string, model: string } | undefined {
  const events = logEvents(session)
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.type !== 'request/header') continue
    const config = (event.data as { header?: { config?: { provider?: string, model?: string } } }).header?.config
    if (config?.provider === undefined || config?.model === undefined) return undefined
    return { provider: config.provider, model: config.model }
  }
  return undefined
}
