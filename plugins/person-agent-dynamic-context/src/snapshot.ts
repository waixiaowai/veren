// 快照组装职责：按配置把各数据源的最新值拼成一段文本，一行一个事实来源。
// 每个函数只做一件事：读名单 → 读冷头 → 解析事实 → 渲染行 → 拼文本。
// Snapshot assembly responsibility: join the latest value of each source into
// one text block, per the config. Each function does one thing — read the
// roster, read cold headers, resolve facts, render lines, join text.
import type { Context } from '@deepseek-ai/cordis'
import { renderAgentPreset, renderWorkspaceList, withHeading } from './render.js'
import type { SessionInfo } from './session-info.js'
import { createSessionInfoResolver } from './session-facts.js'
import { readColdHeaders, readPresetRoster } from './snapshot-reads.js'

/**
 * What one snapshot assembly needs from the host: the context plus the two
 * section toggles and the instant to compare times against.
 * 组装一次快照所需的外部输入：上下文、两个区块开关、用于比较时间的当前时刻。
 */
export interface SnapshotInputs {
  /** Host context carrying every injected capability. 携带全部注入能力的宿主上下文。 */
  ctx: Context
  /** Include the agent preset roster. 是否注入预设名单。 */
  includePresetRoster: boolean
  /** Include the workspace/session list. 是否注入工作区与会话列表。 */
  includeWorkspaceList: boolean
  /** Current instant source, epoch milliseconds. 当前时刻来源（epoch 毫秒）。 */
  now: () => number
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
  now: number,
): string[] {
  return withHeading('## Workspace List', renderWorkspaceList(
    ctx.workspaceRegistry.list(),
    ctx.workspaceRegistry.archivedSessionIds,
    resolve,
    now,
  ))
}

/**
 * Read both registries' latest values and assemble the snapshot text. Async so
 * the roster read is awaited — the value is exact at call time, never a cache.
 * Returns '' when both sections are disabled or empty, which the caller treats
 * as "nothing to append".
 * 读取两个注册表的最新值并组装快照文本。异步等待名单读取——取值即精确值，
 * 不是缓存。两个区块都被关闭或都为空时返回 ''，调用方据此判定「无需追加」。
 */
export async function buildSnapshotText(inputs: SnapshotInputs): Promise<string> {
  const { ctx, includePresetRoster, includeWorkspaceList } = inputs
  const sections: string[] = []
  if (includePresetRoster) sections.push(...await presetSection(ctx))
  // 冷会话头只在需要工作区列表时才读，省掉一次无用的持久化查询。
  // Cold headers are read only when the workspace list is wanted, skipping a
  // pointless persistence query.
  if (includeWorkspaceList) {
    const coldHeaders = await readColdHeaders(ctx)
    sections.push(...workspaceSection(ctx, createSessionInfoResolver(ctx, coldHeaders), inputs.now()))
  }
  return sections.join('\n')
}
