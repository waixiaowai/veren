// 快照组装职责：按配置把各数据源的最新值读出来，渲染成**具名区块**——每个区块
// 是一条独立的小消息（Agent Preset List / Model Catalog / Workspace List），
// 调用方按「区块文本是否与日志里最近一次相同」决定是否追加该区块。
// Snapshot assembly responsibility: read each source's latest value and render
// it as a **named section** — each section is one independent small message
// (Agent Preset List / Model Catalog / Workspace List); the caller appends a
// section only when its text differs from the latest one recorded in the log.
import type { Context } from '@deepseek-ai/cordis'
import { renderAgentPreset, renderWorkspaceList, withHeading } from './render.js'
import type { SessionInfo } from './session-info.js'
import { createSessionInfoResolver, readColdSessionFacts } from './session-facts.js'
import { readModelCatalogSection } from './model-catalog.js'
import { readPresetRoster } from './snapshot-reads.js'

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
 * section toggles and the process-level memo of cold-session facts (cold reads
 * happen once per session per process). No `now` is needed — `created at`
 * renders as a fixed date, so nothing in the rendered text drifts with the
 * clock except the required `running` mark.
 * 组装一次快照所需的外部输入：上下文、三个区块开关，以及冷会话事实的进程级
 * memo（每个冷会话每进程只读一次）。不再需要 `now`——`created at` 渲染为固定
 * 日期，渲染文本中随时间漂移的只剩按需求保留的 `running` 标记。
 */
export interface SnapshotInputs {
  /** Host context carrying every injected capability. 携带全部注入能力的宿主上下文。 */
  ctx: Context
  /** Include the agent preset roster. 是否注入预设名单。 */
  includePresetRoster: boolean
  /** Include the workspace/session list. 是否注入工作区与会话列表。 */
  includeWorkspaceList: boolean
  /** Include the model catalog (providers, multimodal, context window). 是否注入模型目录（provider、多模态与上下文窗口）。 */
  includeModelCatalog: boolean
  /** Memo of cold-session facts, owned by the plugin activation. 冷会话事实 memo，由插件激活期持有。 */
  coldFacts: Map<string, SessionInfo>
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
 * The `## Workspace List` section: every workspace with its non-archived
 * sessions, each session resolved through the same facts resolver.
 * `## Workspace List` 区块：每个工作区及其未归档会话，会话经同一事实解析器。
 */
function workspaceSection(
  ctx: Context,
  resolve: (id: string) => SessionInfo | undefined,
): string[] {
  return withHeading('## Workspace List', renderWorkspaceList(
    ctx.workspaceRegistry.list(),
    ctx.workspaceRegistry.archivedSessionIds,
    resolve,
  ))
}

/**
 * Read each enabled source and render it as a named section. Async so the
 * roster read is awaited — the value is exact at call time, never a cache.
 * Sections with empty text are omitted (nothing to compare or append).
 * 读取每个启用的数据源并渲染成具名区块。异步等待名单读取——取值即精确值，
 * 不是缓存。文本为空的区块直接省略（无可比较、无可追加）。
 */
export async function buildSnapshotSections(inputs: SnapshotInputs): Promise<SnapshotSection[]> {
  const { ctx, includePresetRoster, includeWorkspaceList, includeModelCatalog, coldFacts } = inputs
  const sections: SnapshotSection[] = []
  if (includePresetRoster) {
    const text = (await presetSection(ctx)).join('\n')
    if (text !== '') sections.push({ name: 'Agent Preset List', text })
  }
  if (includeModelCatalog) {
    const text = (await readModelCatalogSection(ctx)).join('\n')
    if (text !== '') sections.push({ name: 'Model Catalog', text })
  }
  // 冷会话事实只在需要工作区列表时才读：每个冷会话每进程读一次（memo），
  // 经 sessionQuery 的 readTitle/readSession 拿标题、preset 与模型路由。
  // Cold-session facts are read only when the workspace list is wanted: once
  // per cold session per process (memoized), via sessionQuery's
  // readTitle/readSession for title, preset and model route.
  if (includeWorkspaceList) {
    const archived = new Set<string>(ctx.workspaceRegistry.archivedSessionIds)
    const liveResolver = createSessionInfoResolver(ctx, new Map())
    for (const item of ctx.workspaceRegistry.list()) {
      for (const id of item.sessionIds) {
        // 挂载中的会话走活跃事实；冷会话每进程读一次（memo）。已归档跳过。
        // Attached sessions use live facts; cold sessions are read once per
        // process (memoized). Archived sessions are skipped.
        if (ctx.sessions.get(id as never) !== undefined || archived.has(id) || coldFacts.has(id)) continue
        const facts = await readColdSessionFacts(ctx, id).catch((error: unknown) => {
          ctx.logger.warn(`person-agent dynamic context: cold session read failed: ${error instanceof Error ? error.message : String(error)}`)
          return undefined
        })
        if (facts !== undefined) coldFacts.set(id, facts)
      }
    }
    const resolve = (id: string): SessionInfo | undefined =>
      ctx.sessions.get(id as never) !== undefined ? liveResolver(id) : coldFacts.get(id)
    const text = workspaceSection(ctx, resolve).join('\n')
    if (text !== '') sections.push({ name: 'Workspace List', text })
  }
  return sections
}
