// 渲染职责：只把已有事实拼成可读文本，或给行块加标题——不读取宿主数据源。
// 工作区区块只渲染工作区本身（会话列表变化频繁，已由查询工具承载）；内置预设
// 展示文案按官方模式走 `presetDisplayText` 字典折叠，本名单面向模型故用官方
// 英文文案。
// Rendering responsibility: turn already-resolved facts into readable text, or
// turn bare lines into a headed section — never reads host data sources. The
// workspace section renders workspaces only (the session list changes too
// often for persistent context and is covered by a query tool). Built-in
// preset copy resolves through the official `presetDisplayText` fold; this
// roster faces the model, so it carries the official English copy.
import { presetDisplayText } from '@deepseek-ai/dsh-agent-preset-registry/display'
import type { BuiltInPresetCopyKey } from '@deepseek-ai/dsh-agent-preset-registry/display'
import type { AgentPreset } from '@deepseek-ai/dsh-agent-preset-registry'
import type { Workspace } from '@deepseek-ai/dsh-workspace'

/** 内置预设的英文文案，与官方 en 字典一致。English copy for the shipped presets, mirroring the official en dictionary. */
const BUILT_IN_COPY: Record<BuiltInPresetCopyKey, string> = {
  presetStandardName: 'Standard mode',
  presetStandardDescription:
    'Work with code, files, and information. Suitable for most tasks, with search, editing, terminal commands, and other tools available as needed.',
  presetPtcName: 'PTC mode',
  presetPtcDescription:
    'Includes all Standard mode capabilities. Better suited to tasks that call tools in batches and then filter, organize, deduplicate, count, or summarize the results.',
  presetMinimalName: 'Minimal mode',
  presetMinimalDescription:
    'The agent uses a terminal and image reading, with context compaction. Useful for testing and comparing its basic performance.',
  presetCordisName: 'Creator mode',
  presetCordisDescription:
    'Customize DSH through conversation. Let the agent write plugins that add features or UI, or combine tools and prompts to create your own mode.',
}

/** Render one roster entry as a human-readable line. 把一个预设渲染成一行可读文本。 */
export const renderAgentPreset = (preset: AgentPreset): string => {
  const text = presetDisplayText(preset, (key) => BUILT_IN_COPY[key])
  return `- ${text.name}(${preset.id}):${text.description ?? ''}`
}

/** Render one workspace as a human-readable line. 把一个工作区渲染成一行可读文本。 */
export const renderWorkspace = (item: Workspace): string =>
  `- ${item.title}(${item.id}):${item.path}`

/** Prepend a heading to a non-empty line block; empty stays empty. 非空时给行块加标题；空即空。 */
export const withHeading = (heading: string, lines: readonly string[]): string[] =>
  lines.length > 0 ? [heading, ...lines] : []
