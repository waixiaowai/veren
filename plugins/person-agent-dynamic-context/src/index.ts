// 独立插件：Person Agent 的工作记忆。由 preset 的 plugins 列表启用——
// 被组合即生效，不组合即不存在。本插件的 apply 在 preset 注册时随子行树
// 挂载运行一次；工作记忆按**具名区块**拆成多条小消息（Agent Preset List /
// Model Catalog / Workspace List），pre-step 时逐块与日志里最近一次的区块文本
// 比较——只有变化的区块才追加，没有变化的步骤零追加。
// Standalone plugin: the Person Agent working memory. Enabled by being
// composed into a preset's plugins list - present when composed, absent when
// not. This plugin's apply runs once, when the preset registers and mounts
// its child-row tree. The working memory is split into **named sections**, one
// small message each (Agent Preset List / Model Catalog / Workspace List); at
// pre-step each section is compared against the latest text recorded in the
// session log - only changed sections are appended, unchanged steps add
// nothing.
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
import { lastSnapshotSectionText } from './session-events.js'
import type { SessionInfo } from './session-info.js'
import { buildSnapshotSections } from './snapshot.js'
import type { SnapshotSection } from './snapshot.js'

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
  .description('Use when a Person Agent session needs working memory: appends the preset roster, the model catalog (providers, multimodal input support, context window), and the per-workspace session list (titles, model routes, creation dates, archived filtered) as three named small messages, each re-appended only when its own content changes.')

// 注入的是能力（Service）：agent 注册表（会话运行状态）、会话存储（按
// SessionId 解析会话对象）、LLM 注册表（模型目录）+ 两个名单来源。sessionTitle
// 为可选能力，经 ctx.get 读取（未挂载时标题回退到 id 片段）。
// Injection targets capabilities: the agent registry (per-session running
// state), the session store (resolves SessionId to session objects), the LLM
// registry (model catalog) plus both list sources. sessionTitle is optional and
// read through ctx.get (titles fall back to an id fragment when it is not
// mounted).
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
export { deriveFallbackTitle, lastSnapshotSectionText, lastSnapshotText, logEvents, selectedPreset } from './session-events.js'
export type { LogEventData, SessionLogView, SnapshotEvent } from './session-events.js'
export { createSessionInfoResolver } from './session-facts.js'
export type { ColdHeader, DerivedSessionFacts, SessionInfo } from './session-info.js'
export { buildSnapshotSections } from './snapshot.js'
export type { SnapshotInputs, SnapshotSection } from './snapshot.js'
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
  // 变化检测读会话日志（无内存状态，重启后依然成立）；冷会话事实的 memo 由
  // 激活期持有：每个冷会话每进程只经 sessionQuery 读一次。
  // Change detection reads the session log (no in-memory state, stays true
  // across restarts); the cold-session facts memo is owned by this activation:
  // every cold session is read through sessionQuery once per process.
  const coldFacts = new Map<string, SessionInfo>()
  ctx.on('agent/pre-step', ({ agent, signal }, next) => appendSnapshot(ctx, config, agent, signal, next, coldFacts), { prepend: true })
}

/**
 * The pre-step decision carrying one message per **changed** section, or the
 * host's decision untouched when the step was rejected/aborted or when no
 * section changed.
 * 携带「每个变化区块一条消息」的 pre-step 决策；步骤被拒/被取消，或没有任何
 * 区块变化时，原样返回宿主的决策。
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
  const sections = await buildSnapshotSections({
    ctx,
    includePresetRoster: config.includePresetRoster,
    includeWorkspaceList: config.includeWorkspaceList,
    includeModelCatalog: config.includeModelCatalog,
    coldFacts,
  })
  // 按块变化检测：区块文本与日志里最近一次相同 → 跳过；只有变化的区块才成为
  // 本步追加的消息。首步三个区块全追加，之后只补差异。
  // Per-section change detection: a section whose text matches the latest one
  // recorded in the log is skipped; only changed sections become this step's
  // appended messages. The first step appends all three; afterwards only the
  // difference.
  const changed = sections.filter((section) =>
    section.text !== lastSnapshotSectionText(agent.session, agent.session.seq, SOURCE, section.name))
  if (changed.length === 0) return decision
  // 判空早已排除「拒绝」分支；这里再声明一次目标分支的形状，且不跨 await 取属性，
  // 于是任何分析器都不会怀疑 messages 是否存在。
  // The rejection branch was already ruled out above; declaring the target branch
  // shape here and reading the property without crossing an await leaves no room
  // for any analyzer to doubt that messages exists.
  const keepGoing: { kind: 'enter', messages: UserMessage[] } = decision
  return { kind: 'enter', messages: [...keepGoing.messages, ...changed.map(snapshotMessage)] }
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

/** One sourced message per changed section. 每个变化区块一条带来源的消息。 */
function snapshotMessage(section: SnapshotSection): UserMessage {
  return createUserMessage({
    content: [{ type: 'text', text: section.text }],
    source: { kind: SOURCE, form: 'snapshot', sections: [{ name: section.name, text: section.text }] },
  })
}
