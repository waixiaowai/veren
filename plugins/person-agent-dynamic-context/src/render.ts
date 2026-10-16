// 渲染职责：只把已有事实拼成可读文本，或给行块加标题——不读取宿主数据源。
// 【会话信息已移除】工作区下的会话列表变化频繁，放进常驻上下文不划算——已由
// 查询工具承载；本插件的工作区区块只渲染工作区本身（title(id):path 一行）。
// Rendering responsibility: turn already-resolved facts into readable text, or
// turn bare lines into a headed section — never reads host data sources.
// Session info removed: the per-workspace session list changes too often to be
// worth a persistent-context slot — a query tool covers it now; this plugin's
// workspace section renders the workspaces only (one `title(id):path` line
// each).
import type { AgentPreset } from '@deepseek-ai/dsh-agent-preset-registry'
import type { Workspace } from '@deepseek-ai/dsh-workspace'

/** Render one roster entry as a human-readable line. 把一个预设渲染成一行可读文本。 */
export const renderAgentPreset = (preset: AgentPreset): string =>
  // name/description 均可省略：缺名回退到 id，缺描述留空，避免渲染出 "undefined"。
  // Both name and description are optional: fall back to the id / empty string.
  `- ${preset.name ?? preset.id}(${preset.id}):${preset.description ?? ''}`

/** Render one workspace as a human-readable line. 把一个工作区渲染成一行可读文本。 */
export const renderWorkspace = (item: Workspace): string =>
  `- ${item.title}(${item.id}):${item.path}`

/** Prepend a heading to a non-empty line block; empty stays empty. 非空时给行块加标题；空即空。 */
export const withHeading = (heading: string, lines: readonly string[]): string[] =>
  lines.length > 0 ? [heading, ...lines] : []
