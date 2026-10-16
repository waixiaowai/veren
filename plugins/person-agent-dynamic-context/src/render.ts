// 渲染职责：只把已有事实拼成可读文本，或给行块加标题——不读取宿主数据源。
// 【会话信息已移除】工作区下的会话列表变化频繁，放进常驻上下文不划算——已由
// 查询工具承载；本插件的工作区区块只渲染工作区本身（title(id):path 一行）。
// 【内置预设文案】官方模式：内置预设（standard/ptc/minimal/cordis）的声明不带
// name/description，展示文案按 id 走官方 `presetDisplayText` 字典折叠；本插件的
// 名单面向模型，用官方英文文案。自定义预设（如 Person Agent）原样用其声明的
// 元数据，官方折叠函数保证用户文案不被翻译。
// Rendering responsibility: turn already-resolved facts into readable text, or
// turn bare lines into a headed section — never reads host data sources.
// Session info removed: the per-workspace session list changes too often to be
// worth a persistent-context slot — a query tool covers it now; this plugin's
// workspace section renders the workspaces only (one `title(id):path` line
// each).
// Built-in preset copy follows the official pattern: the shipped presets
// (standard/ptc/minimal/cordis) declare no name/description; display copy
// resolves by id through the official `presetDisplayText` dictionary fold. This
// plugin's roster faces the model, so it carries the official English copy.
// Custom presets (like Person Agent) render their declared metadata verbatim;
// the official fold guarantees user-authored copy is never translated.
import { presetDisplayText } from '@deepseek-ai/dsh-agent-preset-registry/display'
import type { BuiltInPresetCopyKey } from '@deepseek-ai/dsh-agent-preset-registry/display'
import type { AgentPreset } from '@deepseek-ai/dsh-agent-preset-registry'
import type { Workspace } from '@deepseek-ai/dsh-workspace'

/** 内置预设的英文文案，与官方 en 字典保持一致。English copy for the shipped presets, mirroring the official en dictionary. */
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
  // 官方折叠：内置 id 走字典，自定义预设原样用声明元数据（缺名回退 id，缺描述
  // 留空，避免渲染出 "undefined"）。
  // The official fold: shipped ids resolve through the dictionary; custom
  // presets render their declared metadata (id fallback for a missing name,
  // empty for a missing description — never "undefined").
  const text = presetDisplayText(preset, (key) => BUILT_IN_COPY[key])
  return `- ${text.name}(${preset.id}):${text.description ?? ''}`
}

/** Render one workspace as a human-readable line. 把一个工作区渲染成一行可读文本。 */
export const renderWorkspace = (item: Workspace): string =>
  `- ${item.title}(${item.id}):${item.path}`

/** Prepend a heading to a non-empty line block; empty stays empty. 非空时给行块加标题；空即空。 */
export const withHeading = (heading: string, lines: readonly string[]): string[] =>
  lines.length > 0 ? [heading, ...lines] : []
