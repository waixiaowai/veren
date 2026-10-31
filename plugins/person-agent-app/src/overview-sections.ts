/**
 * 概览页异步三节的首屏读取与文本渲染：任务中心、预设名单、模型目录一次取齐，
 * 每节独立携带失败原因（失败态也是数据），拼成一条随 followup 消息送达的文本。
 * 渲染只管行排版，读数归 facts.ts。
 * The overview's three async first-screen sections: the task center, preset
 * roster and model catalog are fetched in one pass, each section carrying its
 * own failure reason (failures are data), joined into the one text a followup
 * message delivers. Rendering only lays out lines; the reads belong to facts.ts.
 * @module @veren/person-agent-app
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@veren/task-center'
import { errorMessage, readAgentPresets, readModelCatalogGroups } from './facts.ts'
import type { AgentPresetView, ModelCatalogGroupView } from './facts.ts'

/** 待办任务节 / the open-tasks section */
export interface TasksSection {
  readonly error: string | null
  readonly openCount: number | null
}
/** 预设名单节 / the preset-roster section */
export interface PresetsSection {
  readonly error: string | null
  readonly presets: readonly AgentPresetView[]
}
/** 模型目录节 / the model-catalog section */
export interface ModelsSection {
  readonly error: string | null
  readonly groups: readonly ModelCatalogGroupView[]
}
/** 概览页首屏快照 / the overview page's first-screen snapshot */
export interface OverviewFirstScreen {
  readonly tasks: TasksSection
  readonly presets: PresetsSection
  readonly models: ModelsSection
}

/** 预设名单节渲染成文本 / render the preset-roster section as text */
function renderPresetsSection(section: PresetsSection): string {
  if (section.error !== null && section.error !== undefined) {
    return `Agent Preset List（预设名单）读取失败：${section.error}——如实告知用户，不要编造。`
  }
  if (section.presets.length === 0) return 'Agent Preset List（预设名单）：（无可用预设）'
  const rows = section.presets.map((preset) =>
    `- ${preset.name}(${preset.id})${preset.description ? `:${preset.description}` : ''}${preset.broken ? `（不可用：${preset.broken}）` : ''}`)
  return ['Agent Preset List（预设名单）：', ...rows].join('\n')
}

/** 模型目录节渲染成文本 / render the model-catalog section as text */
function renderModelsSection(section: ModelsSection): string {
  if (section.error !== null && section.error !== undefined) {
    return `Model Catalog（模型目录）读取失败：${section.error}——如实告知用户，不要编造。`
  }
  if (section.groups.length === 0) return 'Model Catalog（模型目录）：（无可用模型）'
  const lines = ['Model Catalog（模型目录）：']
  for (const group of section.groups) {
    lines.push(`- ${group.name}(${group.id})${group.error === undefined ? '' : `: 读取失败：${group.error}`}`)
    for (const model of group.models) {
      lines.push(`  - ${model.name}(${model.id}): input ${model.inputModalities.includes('image') ? 'text+image' : 'text'}`
        + ` · ${model.contextWindow === undefined ? 'context unknown' : `context ${model.contextWindow} tokens`}`
        + (model.hint === '' ? '' : ` · use when: ${model.hint}`))
    }
  }
  return lines.join('\n')
}

/** 待办任务节渲染成文本 / render the open-tasks section as text */
function renderTasksSection(section: TasksSection): string {
  if (section.error !== null && section.error !== undefined) {
    return `待办任务读取失败：${section.error}——如实告知用户，不要编造数字。`
  }
  return `待办任务：open 任务 ${section.openCount ?? 0} 条（live 自任务中心）。`
}

/** 概览页首屏读取：三路异步读一次取齐（每节独立携带失败原因）
 * / the overview page's first-screen read: three async reads settle together (each section carries its own failure) */
export async function overviewFirstScreenText(ctx: Context): Promise<string> {
  const [tasks, presets, models] = await Promise.all([
    ctx.taskCenter.list({ status: 'open' }).then(
      (openTasks) => ({ error: null, openCount: openTasks.length }) satisfies TasksSection,
      (error: unknown) => ({ error: errorMessage(error), openCount: null }) satisfies TasksSection,
    ),
    readAgentPresets(ctx).then(
      (views) => ({ error: null, presets: views }) satisfies PresetsSection,
      (error: unknown) => ({ error: errorMessage(error), presets: [] }) satisfies PresetsSection,
    ),
    readModelCatalogGroups(ctx).then(
      (groups) => ({ error: null, groups }) satisfies ModelsSection,
      (error: unknown) => ({ error: errorMessage(error), groups: [] }) satisfies ModelsSection,
    ),
  ])
  return [renderPresetsSection(presets), renderModelsSection(models), renderTasksSection(tasks)].join('\n\n')
}
