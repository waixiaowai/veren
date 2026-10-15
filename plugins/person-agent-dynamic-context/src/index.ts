// 独立插件：Person Agent 的工作记忆。由 preset 的 plugins 列表启用——
// 被组合即生效，不组合即不存在。本插件的 apply 在 preset 注册时随子行树
// 挂载运行一次；名单作为 pre-step 快照消息追加（time-context 同一模式）：
// listener 异步 await 名单读取，与会话上一条快照比较，仅变化时追加。
// Standalone plugin: the Person Agent working memory. Enabled by being
// composed into a preset's plugins list - present when composed, absent when
// not. This plugin's apply runs once, when the preset registers and mounts
// its child-row tree; the lists are appended as a pre-step snapshot message
// (the time-context pattern): the listener awaits the roster read and
// compares against the session's previous snapshot, appending only on change.
//
// 文件职责：本文件只做三件事——声明插件身份与配置、注册 pre-step 监听器、
// 把各专项模块（文本工具 / 事实契约 / 日志读取 / 数据源读取 / 渲染 / 组装）
// 重新导出，保持对外接口不变；具体实现都在同目录的单一职责模块里。
// Responsibility of this file: declare the plugin identity and config, register
// the pre-step listener, and re-export the focused modules (text helpers /
// facts contract / log reads / source reads / rendering / assembly) so the
// public surface stays unchanged; every implementation lives in a
// single-responsibility sibling module.
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ContextFormed, UserMessage } from '@deepseek-ai/dsh-llm'
// 类型-only import：拉取 sessions / sessionTitle 服务的 Context 声明合并。
// Type-only imports: pull the sessions and sessionTitle service Context
// declaration merging.
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-title'
// 类型-only import：拉取 sessionProjections（modelSelection 投影键）与部署
// 默认模型服务的 Context 声明合并。
// Type-only imports: pull the sessionProjections (modelSelection projection
// key) and deployment default-model service Context declaration merging.
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-agent-default-model'
// 类型-only import：拉取 agentPresets 与 workspaceRegistry 的 Context 声明合并。
// Type-only imports: pull the agentPresets and workspaceRegistry Context
// declaration merging.
import type {} from '@deepseek-ai/dsh-agent-preset-registry'
import type {} from '@deepseek-ai/dsh-workspace'
import z from '@deepseek-ai/schemastery'
import { lastSnapshotText } from './session-events.js'
import type { SessionInfo } from './session-info.js'
import { buildSnapshotText } from './snapshot.js'

/** 快照消息的来源标识。The snapshot message's source kind. */
export const SOURCE = 'person-agent-context'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'person-agent-context': { kind: 'person-agent-context' } & ContextFormed
  }
}

export const name = 'personAgentDynamicContext'

export interface Config {
  /** Include the agent preset roster in the snapshot. 是否注入预设名单。 */
  includePresetRoster: boolean
  /** Include the workspace/session list in the snapshot. 是否注入工作区与会话列表。 */
  includeWorkspaceList: boolean
  /** Include the model catalog (providers, multimodal support, context window) in the snapshot. 是否注入模型目录（provider、多模态支持与上下文窗口）。 */
  includeModelCatalog: boolean
}

// 类型事实（由编译器的报错确认）：本 schema 的调用签名要求传入完整的 Config，
// 缺键会报 ts(2345)。因此调用方（测试与宿主）必须显式给出三个开关；测试里用一个
// 合并辅助函数保证「语义不变、类型完整」。z<Config> 这一公共签名保持不变。
// Type fact, confirmed by the compiler: this schema's call signature requires a
// complete Config — a missing key raises ts(2345). Callers (tests and host) must
// therefore supply all three toggles; tests use a merge helper so the semantics
// stay identical while the type stays complete. The public z<Config> signature
// is kept.
export const Config: z<Config> = z
  .object({
    includePresetRoster: z.boolean().default(true).description('Inject the agent preset roster into the working-memory snapshot.'),
    includeWorkspaceList: z.boolean().default(true).description('Inject the per-workspace session lists into the working-memory snapshot.'),
    includeModelCatalog: z.boolean().default(true).description('Inject the available model catalog (providers, multimodal input support, context window) into the working-memory snapshot.'),
  })
  .description('Use when a Person Agent session needs working memory: appends a sourced snapshot message at each step preparation with the awaited preset roster, the available model catalog (providers, multimodal input support, context window), and the per-workspace session lists (titles, model routes, relative times, archived filtered), adding to the session only when the values change.')

// 注入的是能力（Service）：agent 注册表（pre-step 事件）、会话存储（按
// SessionId 解析会话对象）、LLM 注册表（模型目录）+ 两个名单来源。sessionTitle
// 为可选能力，经 ctx.get 读取（未挂载时标题回退到 id 片段）。
// Injection targets capabilities: the agent registry (pre-step event), the
// session store (resolves SessionId to session objects), the LLM registry
// (model catalog) plus both list sources. sessionTitle is optional and read
// through ctx.get (titles fall back to an id fragment when it is not mounted).
export const inject = ['agents', 'sessions', 'agentPresets', 'workspaceRegistry', 'sessionTitle', 'llm']
export const provide = []

// 配置形状的类型别名：`Config` 这个标识符在本文件里同时是「接口类型」和「schema 值」，
// 导出别名让使用方写 Partial<ConfigShape> 时指向接口而不是 schema。
// A type alias for the config shape: `Config` is both an interface type and a
// schema value here, so this alias lets callers write Partial<ConfigShape> and
// mean the interface, not the schema.
export type ConfigShape = Config

// 对外接口保持不变：这些符号过去定义在本文件，现在实现拆到专项模块。
// The public surface is unchanged: these symbols used to live in this file and
// now sit in focused modules.
export { renderAgentPreset, renderSessionLine, renderWorkspace, renderWorkspaceBlock, renderWorkspaceList, withHeading } from './render.js'
export { readModelCatalogSection, renderModelCatalogGroup, renderModelCatalogModel } from './model-catalog.js'
export type { ModelCatalogGroup, ModelContextWindows } from './model-catalog.js'
export { deriveFallbackTitle, lastSnapshotText, logEvents, selectedPreset } from './session-events.js'
export type { LogEventData, SessionLogView, SnapshotEvent } from './session-events.js'
export { createSessionInfoResolver } from './session-facts.js'
export type { ColdHeader, DerivedSessionFacts, SessionInfo } from './session-info.js'
export { buildSnapshotText } from './snapshot.js'
export type { SnapshotInputs } from './snapshot.js'
export { readColdHeaders, readPresetRoster, snapshotWarning } from './snapshot-reads.js'
export { formatCreated, idFragment, UNKNOWN, UNKNOWN_TIME } from './text-time.js'

export const apply = (ctx: Context, config: Config): void => {
  try {
    applyInner(ctx, config)
  } catch (error) {
    // 激活期同步异常必须显性化：写日志，避免只剩一行含糊的 "never started"。
    // Surface synchronous activation failures loudly instead of a bare
    // "never started".
    const message = error instanceof Error ? error.message : String(error)
    ctx.logger.warn(`person-agent dynamic context activation failed: ${message}`)
    throw error
  }
}

/** The real activation body, separated so apply can fail loud with context. 真正的激活体，分离出来让 apply 带上下文显性失败。 */
function applyInner(ctx: Context, config: Config): void {
  // 运行状态直接读活跃 agent 注册表（ctx.agents.get(id)?.status），无需自维护
  // 跟踪集合；pre-step 快照仅在变化时追加（time-context 同款）。冷会话事实的
  // memo 由激活期持有：每个冷会话每进程只经 sessionQuery 读一次。
  // Running state reads the live agent registry directly
  // (ctx.agents.get(id)?.status) — no self-maintained tracking set; the
  // pre-step snapshot appends only on change (the time-context pattern). The
  // cold-session facts memo is owned by this activation: every cold session is
  // read through sessionQuery once per process.
  const coldFacts = new Map<string, SessionInfo>()
  ctx.on('agent/pre-step', ({ agent, signal }, next) => appendSnapshot(ctx, config, agent, signal, next, coldFacts), { prepend: true })
}

/**
 * The pre-step decision carrying this step's snapshot message, or the host's
 * decision untouched when the step was rejected/aborted, or when the rendered
 * text is empty or identical to the session's previous snapshot.
 * 携带本步快照消息的 pre-step 决策；步骤被拒/被取消，或渲染文本为空、与会话上一条
 * 快照相同时，原样返回宿主的决策。
 */
async function appendSnapshot(
  ctx: Context,
  config: Config,
  agent: Agent,
  signal: AbortSignal,
  next: () => Promise<PreStepDecision>,
  coldFacts: Map<string, SessionInfo>,
): Promise<PreStepDecision> {
  const decision = await next()
  // 只放行「进入本步」的决策：拒绝与已取消都原样返回，不改写宿主的决定。
  // Pass through only an "enter this step" decision: a rejection or an aborted
  // turn returns the host's decision untouched.
  if (isRejected(decision) || signal.aborted) return decision
  const text = await buildSnapshotText({
    ctx,
    includePresetRoster: config.includePresetRoster,
    includeWorkspaceList: config.includeWorkspaceList,
    includeModelCatalog: config.includeModelCatalog,
    now: Date.now,
    coldFacts,
  })
  if (text === '' || text === lastSnapshotText(agent.session, agent.session.seq, SOURCE)) return decision
  // 判空早已排除「拒绝」分支；这里再声明一次目标分支的形状，且不跨 await 取属性，
  // 于是任何分析器都不会怀疑 messages 是否存在。
  // The rejection branch was already ruled out above; declaring the target branch
  // shape here and reading the property without crossing an await leaves no room
  // for any analyzer to doubt that messages exists.
  const keepGoing: { kind: 'enter', messages: UserMessage[] } = decision
  return { kind: 'enter', messages: [...keepGoing.messages, snapshotMessage(text)] }
}

/**
 * Whether the host decided to keep the proposed step out. Declared as a type
 * predicate so the caller narrows on the return value instead of on the shape of
 * an `if` condition — narrowing a later `await` cannot invalidate.
 * 宿主是否决定不进入本步。用类型谓词声明，调用方按返回值收窄，而不是依赖
 * `if` 条件的形状——这种收窄不会被后面的 `await` 洗掉。
 */
function isRejected(decision: PreStepDecision): decision is { kind: 'reject' } {
  return decision.kind === 'reject'
}

/** The sourced snapshot message this plugin appends. 本插件追加的带来源快照消息。 */
function snapshotMessage(text: string): UserMessage {
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: SOURCE, form: 'snapshot', sections: [{ name: SOURCE, text }] },
  })
}
