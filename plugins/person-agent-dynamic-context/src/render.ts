// 渲染职责：只把已有事实拼成可读文本，或给行块加标题——不读取宿主数据源。
// Rendering responsibility: turn already-resolved facts into readable text, or
// turn bare lines into a headed section — never reads host data sources.
import type { AgentPreset } from '@deepseek-ai/dsh-agent-preset-registry'
import type { Workspace } from '@deepseek-ai/dsh-workspace'
import type { SessionInfo } from './session-info.js'
import { formatCreated, idFragment, UNKNOWN, UNKNOWN_TIME } from './text-time.js'

/** Render one roster entry as a human-readable line. 把一个预设渲染成一行可读文本。 */
export const renderAgentPreset = (preset: AgentPreset): string =>
  // name/description 均可省略：缺名回退到 id，缺描述留空，避免渲染出 "undefined"。
  // Both name and description are optional: fall back to the id / empty string.
  `- ${preset.name ?? preset.id}(${preset.id}):${preset.description ?? ''}`

/** Render one workspace as a human-readable line. 把一个工作区渲染成一行可读文本。 */
export const renderWorkspace = (item: Workspace): string =>
  `- ${item.title}(${item.id}):${item.path}`

/**
 * Render one non-archived session as a numbered line. The four facts render
 * unconditionally (`unknown` as the fallback for missing data), with a running
 * mark appended; a missing title falls back to the id fragment without the
 * useless `session-` prefix, so the column never reads as a wall of
 * "session-".
 * 把一条未归档会话渲染成带编号的一行。四个字段无条件全部显示（缺数据用
 * unknown 占位），运行中追加标记；标题缺省回退到去掉 `session-` 前缀的 id
 * 片段，避免整列都读成 "session-"。
 */
export function renderSessionLine(index: number, id: string, info: SessionInfo | undefined, now: number): string {
  const title = info?.title ?? idFragment(id)
  const preset = info?.preset ?? UNKNOWN
  const provider = info?.provider ?? UNKNOWN
  const model = info?.model ?? UNKNOWN
  const runningMark = info?.running === true ? ' · running' : ''
  const day = info?.createdAt === undefined ? UNKNOWN_TIME : formatCreated(info.createdAt, now)
  return `  ${index + 1}. ${title} · preset ${preset} · ${provider}/${model} · created ${day}${runningMark}`
}

/**
 * Render one workspace block: the workspace line, then its non-archived
 * sessions as a numbered list (`sessions: none` when the archive filter ate
 * them all). Archived sessions are filtered out via the registry's
 * `archivedSessionIds`.
 * 渲染一个工作区块：先工作区行，其下未归档会话以编号列出（全被归档过滤后显示
 * `sessions: none`）。已归档会话经注册表的 `archivedSessionIds` 过滤。
 */
export function renderWorkspaceBlock(
  item: Workspace,
  archived: ReadonlySet<string>,
  resolve: (id: string) => SessionInfo | undefined,
  now: number,
): string[] {
  const sessions = item.sessionIds.filter((id) => !archived.has(id))
  if (sessions.length === 0) return [renderWorkspace(item), '  sessions: none']
  return [
    renderWorkspace(item),
    ...sessions.map((id, index) => renderSessionLine(index, id, resolve(id), now)),
  ]
}

/**
 * Render the whole workspace list: one block per workspace, in registry order.
 * Returns bare lines; the caller decides whether a heading is warranted.
 * 渲染完整工作区列表：按注册表顺序逐个工作区块。只返回正文行，是否加标题由
 * 调用方决定。
 */
export const renderWorkspaceList = (
  workspaces: readonly Workspace[],
  archivedSessionIds: readonly string[],
  resolve: (id: string) => SessionInfo | undefined,
  now: number,
): string[] => {
  const archived = new Set<string>(archivedSessionIds)
  return workspaces.flatMap((item) => renderWorkspaceBlock(item, archived, resolve, now))
}

/** Prepend a heading to a non-empty line block; empty stays empty. 非空时给行块加标题；空即空。 */
export const withHeading = (heading: string, lines: readonly string[]): string[] =>
  lines.length > 0 ? [heading, ...lines] : []
