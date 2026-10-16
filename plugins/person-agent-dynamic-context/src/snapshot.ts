// 快照组装职责：按配置把各数据源的最新值读出来，渲染成**具名区块**——每个区块
// 是一条独立的小消息（Agent Preset List / Model Catalog / Workspace List），
// 调用方按「区块文本是否与日志里最近一次相同」决定是否追加该区块。
// 【不含会话信息】会话列表变化频繁且已有查询工具承载，工作区区块只渲染工作区
// 本身，不再展开各工作区下的会话。读取失败一律降级 + 告警：名单读失败不炸插件。
// Snapshot assembly responsibility: read each source's latest value and render
// it as a **named section** — each section is one independent small message
// (Agent Preset List / Model Catalog / Workspace List); the caller appends a
// section only when its text differs from the latest one recorded in the log.
// No session info: the session list changes too often and is covered by a query
// tool; the workspace section renders the workspaces only. A failed read
// degrades with a warning — a failed roster read never breaks the plugin.
import type { Context } from '@deepseek-ai/cordis'
import type { AgentPreset } from '@deepseek-ai/dsh-agent-preset-registry'
import { renderAgentPreset, renderWorkspace, withHeading } from './render.js'
import { readModelCatalogSection } from './model-catalog.js'

/**
 * One named snapshot section: the section's stable identifier (also the name
 * recorded in the message source, used for per-section change detection) and
 * its rendered text.
 * 一个具名快照区块：区块的稳定标识（同时记入消息来源，用于按块变化检测）与
 * 渲染后的文本。
 */
export interface SnapshotSection {
  /** Stable section name, e.g. `Agent Preset List`. 稳定的区块名，如 `Agent Preset List`。 */
  name: string
  /** Rendered section text including its `##` heading. 含 `##` 标题的渲染文本。 */
  text: string
}

/**
 * What one snapshot assembly needs from the host: the context plus the three
 * section toggles. All reads happen inside this call; every remaining source
 * is a cheap in-memory registry read, so no memo is needed.
 * 组装一次快照所需的外部输入：上下文与三个区块开关。所有读取都发生在本次调用
 * 内；剩余数据源都是廉价的内存注册表读取，不再需要 memo。
 */
export interface SnapshotInputs {
  /** Host context carrying every injected capability. 携带全部注入能力的宿主上下文。 */
  ctx: Context
  /** Include the agent preset roster. 是否注入预设名单。 */
  includePresetRoster: boolean
  /** Include the workspace list. 是否注入工作区列表。 */
  includeWorkspaceList: boolean
  /** Include the model catalog (providers, multimodal, context window). 是否注入模型目录（provider、多模态与上下文窗口）。 */
  includeModelCatalog: boolean
}

/** 统一的读取失败告警文案。One shared warning line for failed reads. */
export const snapshotWarning = (error: unknown): string =>
  `person-agent dynamic context failed: ${error instanceof Error ? error.message : String(error)}`

/**
 * Await the preset roster. A failed read only warns and yields an empty roster,
 * so this snapshot simply carries no roster heading.
 * 等待预设名单。读取失败只告警并返回空名单——本次快照不带名单标题，不炸插件。
 */
export async function readPresetRoster(ctx: Context): Promise<AgentPreset[]> {
  try {
    return await ctx.agentPresets.list()
  } catch (error) {
    ctx.logger.warn(snapshotWarning(error))
    return []
  }
}

/**
 * The `## Agent Preset List` section: the awaited roster rendered one line per
 * preset, or no lines at all when the roster is empty.
 * `## Agent Preset List` 区块：等待来的名单每个预设一行；名单为空则不出行。
 */
async function presetSection(ctx: Context): Promise<string[]> {
  const roster = await readPresetRoster(ctx)
  return withHeading('## Agent Preset List', roster.map(renderAgentPreset))
}

/**
 * The `## Workspace List` section: one line per workspace from the live
 * registry — the workspaces themselves only, no per-workspace session rows.
 * `## Workspace List` 区块：活跃注册表里每个工作区一行——只含工作区本身，
 * 不展开各工作区下的会话。
 */
function workspaceSection(ctx: Context): string[] {
  return withHeading('## Workspace List', ctx.workspaceRegistry.list().map(renderWorkspace))
}

/**
 * Read each enabled source and render it as a named section. Async so the
 * roster read is awaited — the value is exact at call time, never a cache.
 * Sections with empty text are omitted (nothing to compare or append).
 * 读取每个启用的数据源并渲染成具名区块。异步等待名单读取——取值即精确值，
 * 不是缓存。文本为空的区块直接省略（无可比较、无可追加）。
 */
export async function buildSnapshotSections(inputs: SnapshotInputs): Promise<SnapshotSection[]> {
  const { ctx, includePresetRoster, includeWorkspaceList, includeModelCatalog } = inputs
  const sections: SnapshotSection[] = []
  if (includePresetRoster) {
    const text = (await presetSection(ctx)).join('\n')
    if (text !== '') sections.push({ name: 'Agent Preset List', text })
  }
  if (includeModelCatalog) {
    const text = (await readModelCatalogSection(ctx)).join('\n')
    if (text !== '') sections.push({ name: 'Model Catalog', text })
  }
  if (includeWorkspaceList) {
    const text = workspaceSection(ctx).join('\n')
    if (text !== '') sections.push({ name: 'Workspace List', text })
  }
  return sections
}
