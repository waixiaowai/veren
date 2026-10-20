/**
 * 动态 preset 构建（参考 person-agent-preset）/ dynamic preset builder
 *
 * 用户设计：一个 preset = 一个页面（场景）。
 * - 系统提示词{永久记忆 通用} → persona.prefix
 * - 工具{静态按钮} → 工具插件行
 * - 工作记忆{动态上下文} → 页面工作记忆行（本包消费方的插件自身，会话挂载时注入）
 *
 * 结构与 @deepseek-ai/dsh-agent-preset-registry 的 PresetDefinition 结构兼容（结构类型，不引 dsh 依赖）。
 */
import type { PageDefinition, PagePresetSpec } from './types.ts'

export type { PagePresetSpec }

/** preset 子插件行 / one child plugin row */
export interface PresetPluginRow {
  readonly id: string
  readonly name: string
  readonly disabled?: boolean
  readonly config?: Record<string, unknown>
}

/** PresetDefinition 结构（结构兼容 dsh-agent-preset-registry）/ structurally-compatible preset definition */
export interface PresetDefinitionShape {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly order: number
  readonly plugins: readonly PresetPluginRow[]
}

/** 页面的静态面声明（definePage.preset 字段）— 定义在 types.ts / declared in types.ts */

export interface BuildPagePresetOptions {
  /** preset id 缺省 page.<name> / defaults to page.<name> */
  readonly presetId?: string
  /** 工具/技能插件行（工具插件、skill 行等）/ tool & skill rows */
  readonly toolRows?: readonly PresetPluginRow[]
  /** 页面工作记忆行的包名（页面插件自身）/ package name of the page working-memory row */
  readonly contextRowName?: string
  /** 工作记忆行的配置（如 role/page 选择）/ config for the working-memory row */
  readonly contextRowConfig?: Record<string, unknown>
}

/** 构建页面 preset 定义 / build the page's preset definition */
export function buildPagePreset<S>(page: PageDefinition<S>, options: BuildPagePresetOptions = {}): PresetDefinitionShape {
  const presetSpec = page.preset
  if (presetSpec === undefined) {
    throw new Error(`[buildPagePreset] page "${page.name}" has no preset.systemPrompt`)
  }
  const plugins: PresetPluginRow[] = [
    {
      id: 'persona',
      name: '@deepseek-ai/dsh-persona',
      config: { prefix: presetSpec.systemPrompt },
    },
    ...(options.toolRows ?? []),
    ...(options.contextRowName === undefined ? [] : [{
      id: 'page-context',
      name: options.contextRowName,
      config: { role: 'context', page: page.name, ...(options.contextRowConfig ?? {}) },
    }]),
  ]
  return {
    id: options.presetId ?? `page.${page.name}`,
    name: page.name,
    description: page.description,
    order: presetSpec.order ?? 100,
    plugins,
  }
}
