/**
 * 页面作者词汇层：definePage / 动态 preset 构建 / 内置块组件（TSX）
 * Page-authoring vocabulary: definePage / dynamic preset builder / built-in block components.
 *
 * - 静态面经 preset 字段动态声明（DSH preset 注册，参考 person-agent-preset），不用 yml
 * - 事件系统用宿主自带的 cordis 事件（ctx.emit / ctx.on）；本包只定义处理器 IO 形状
 * - 事件处理器形状（键名 = cordis 事件名）
 */
import { createElement } from '@veren/prompt-core'
import type { ElementInput, Entity, PromptElement } from '@veren/prompt-core'
import type { PresetDefinition } from '@deepseek-ai/dsh-agent-preset-registry'
import type { PageDefinition, PageEventMap, PageIO, PageParams, PagePresetSpec } from './types.ts'

export type { PageEventMap, PageIO, PagePresetSpec } from './types.ts'

// ---- definePage ----

export function definePage<S>(definition: {
  name: string
  url: string
  description: string
  preset?: PagePresetSpec
  events?: PageEventMap
  tree: (props: PageParams, state: S) => ElementInput
  onLoad?: (params: PageParams) => void
  onComplete?: (params: PageParams) => boolean
}): PageDefinition<S> {
  const { name, url, description, preset, events, tree, onLoad, onComplete } = definition
  if (name.length === 0 || name.trim() !== name) {
    throw new Error(`[definePage] invalid page name: ${JSON.stringify(name)}`)
  }
  validateUrlPattern(name, url)
  if (description.length === 0 || description.trim() !== description) {
    throw new Error(`[definePage] page "${name}" needs a non-empty description`)
  }
  if (typeof tree !== 'function') {
    throw new Error(`[definePage] page "${name}" tree must be a function`)
  }
  return {
    name, url, description, tree,
    ...(preset === undefined ? {} : { preset }),
    ...(events === undefined ? {} : { events }),
    ...(onLoad === undefined ? {} : { onLoad }),
    ...(onComplete === undefined ? {} : { onComplete }),
  }
}

/** URL 模式校验 / validate a url pattern */
function validateUrlPattern(name: string, url: string): void {
  if (!url.startsWith('/') || url.includes('?')) {
    throw new Error(`[definePage] page "${name}" url must be a path pattern like /xx/:id, got ${JSON.stringify(url)}`)
  }
  const segments = url.split('/').filter((segment) => segment.length > 0)
  const paramNames = new Set<string>()
  for (const segment of segments) {
    if (!segment.startsWith(':')) continue
    const paramName = segment.slice(1)
    if (paramName.length === 0 || paramNames.has(paramName)) {
      throw new Error(`[definePage] page "${name}" url has an invalid or duplicate :param: ${JSON.stringify(segment)}`)
    }
    paramNames.add(paramName)
  }
}

// ---- 内置块组件：宿主块词汇（TSX）/ built-in block components ----

/** 静态块：一次渲染终身复用（永不进补丁）/ static block: never diffed */
export function Static(props: { content: string }): PromptElement[] {
  return [createElement('static', { content: props.content })]
}

/** 字段块：值变化 → 一个 set op / data block: value change → one set op */
export function Data(props: { path: string; value: unknown }): PromptElement[] {
  return [createElement('data', { path: props.path, value: props.value })]
}

/** keyed 集合块：按 id 对位，变化 → splice op / keyed collection: keyed by id */
export function Keyed<T extends Entity>(props: { path: string; items: readonly T[] }): PromptElement[] {
  return props.items.map((item) => createElement('item', { key: item.id, path: props.path, value: item }))
}

// ---- 动态 preset 构建（参考 person-agent-preset）/ dynamic preset builder ----

export interface BuildPagePresetOptions {
  /** preset id 缺省 page.<name> / defaults to page.<name> */
  readonly presetId?: string
  /** 工具/技能插件行（工具插件、skill 行等）/ tool & skill rows */
  readonly toolRows?: readonly PresetDefinition['plugins'][number][]
  /** 页面工作记忆行的包名（页面插件自身）/ package name of the page working-memory row */
  readonly contextRowName?: string
  /** 工作记忆行的配置（如 role/page 选择）/ config for the working-memory row */
  readonly contextRowConfig?: Record<string, unknown>
}

/** 构建页面 preset 定义（直接产出注册表的 PresetDefinition）/ build the registry's PresetDefinition */
export function buildPagePreset<S>(page: PageDefinition<S>, options: BuildPagePresetOptions = {}): PresetDefinition {
  const presetSpec = page.preset
  if (presetSpec === undefined) {
    throw new Error(`[buildPagePreset] page "${page.name}" has no preset.systemPrompt`)
  }
  const plugins: PresetDefinition['plugins'] = [
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

/** 事件处理器 IO 的默认空实现（测试/占位）/ no-op PageIO for tests */
export const noopPageIO: PageIO = { append: () => undefined, navigate: () => undefined }
