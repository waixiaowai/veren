// 会话事实的契约：字段全部由宿主的 SessionHeader 组合得出，只保留渲染真正需要
// 的列，不额外发明重复字段。这是「一个类型来源」在数据层的体现——标题/preset/
// 模型/运行状态这些本插件自己拼出来的信息另列，宿主已有的列一律复用。
// 【running 是需求】运行状态按需求保留：使用者需要知道哪些会话正在运行；工作
// 区块随其变化而重新追加是可接受的代价。
// The session-facts contract: every field is composed from the host's
// SessionHeader, keeping only the columns the renderer needs. This is the "single
// type source" idea applied to data: fields the host already owns are reused
// as-is, and only the plugin-derived ones (title, preset, model route, running)
// are declared here. `running` stays by requirement: the consumer needs to know
// which sessions are running; the workspace section re-appending on change is
// an accepted trade-off.
import type { SessionHeader } from '@deepseek-ai/dsh-session'

/**
 * Session fields this plugin derives itself; the rest of {@link SessionInfo}
 * comes straight from the host header. `id` is deliberately optional so the
 * renderer keeps treating a missing id the same way it always has.
 * 本插件自己派生出来的会话字段；{@link SessionInfo} 的其余列直接来自宿主头。
 * `id` 刻意保持可选，让渲染层对「缺 id」的处理与原行为一致。
 */
export interface DerivedSessionFacts {
  /** Session id. 会话 id。 */
  id?: string
  /** Accepted session title, or the title derived from the first human message.
   * 已接纳的标题，或由首条人类消息派生的标题。 */
  title?: string
  /** Agent preset the session runs, latest selection wins. 会话运行的 agent preset（最新选择优先）。 */
  preset?: string
  /** LLM provider route of the latest recorded request. 最近一次已记录请求的 LLM provider。 */
  provider?: string
  /** LLM model id of the latest recorded request. 最近一次已记录请求的模型 id。 */
  model?: string
  /** Whether the session's agent is currently running. 会话的 agent 是否正在运行。 */
  running?: boolean
}

/**
 * The session facts this plugin renders for one SessionId. Host-owned columns
 * (`createdAt`, `cwd`, `agentPreset`) are `Pick`ed from the host header instead
 * of being re-declared, so a host-side optionality change flows in automatically.
 * 本插件为一个 SessionId 渲染的会话信息。宿主自己的列（创建时间、工作目录、
 * 创建时的 preset）用 `Pick` 取自宿主头，而不是重新声明一遍——宿主改了可选性，
 * 这里自动跟着变。
 */
export type SessionInfo = Pick<SessionHeader, 'createdAt' | 'cwd' | 'agentPreset'> & DerivedSessionFacts

/**
 * One session header as this plugin consumes it: the host type itself.
 * 本插件消费的会话头：就是宿主类型本身，不再另立一套。
 */
export type ColdHeader = SessionHeader
