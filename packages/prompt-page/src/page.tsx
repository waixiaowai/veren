/** @jsxRuntime automatic @jsxImportSource @veren/prompt-core */
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
import { PageError, PageErrorCode, assertAppUrlPattern, patternParamsOf } from './contract.ts'
import type { PageDefinition, PageEventMap, PageIO, PageLoadEnv, PageJsonValue, PageMapEntry, PageParams, PagePresetSpec } from './types.ts'

export type { PageEventMap, PageIO, PagePresetSpec } from './types.ts'

// ---- definePage ----

export function definePage<S>(definition: {
  name: string
  url: string
  description: string
  /** @deprecated 页面不再绑定预设；此输入被忽略（仅为 page-sync-bench 迁移期编译兼容保留）。 */
  preset?: PagePresetSpec
  events?: PageEventMap
  tools?: readonly string[]
  writes?: boolean
  instructions?: string
  map?: readonly PageMapEntry[]
  load?: (params: PageParams, env: PageLoadEnv) => Promise<PageJsonValue>
  instanceTitle?: (params: PageParams) => string
  tree: (props: PageParams, state: S) => ElementInput
  onLoad?: (params: PageParams) => void
  onComplete?: (params: PageParams) => boolean
}): PageDefinition<S> {
  const { name, url, description, events, tools, writes, instructions, map, load, instanceTitle, tree, onLoad, onComplete } = definition
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
  validateMapEntries(name, map)
  return {
    name, url, description, tree,
    ...(tools === undefined ? {} : { tools }),
    ...(writes === undefined ? {} : { writes }),
    ...(instructions === undefined ? {} : { instructions }),
    ...(map === undefined ? {} : { map }),
    ...(load === undefined ? {} : { load }),
    ...(instanceTitle === undefined ? {} : { instanceTitle }),
    ...(events === undefined ? {} : { events }),
    ...(onLoad === undefined ? {} : { onLoad }),
    ...(onComplete === undefined ? {} : { onComplete }),
  }
}

/**
 * 应用作用域的页面定义：在 definePage 之上强制 `/apps/<appId>/...` URL 形态，
 * 并补齐契约缺省：tools 缺省 []（§3.1、§6.1）；二级页结构校验（§3.10.5 规则 3）。
 * `pageRevision` 已删除（G11）：打开一律新建，无升级分叉。
 * 应用注册器（app-registry）的注册路径应使用本函数或等效校验。
 * App-scoped definePage: enforces the /apps url shape, contract defaults, and
 * the detail-page structure rules (§3.10.5 rule 3).
 */
export function defineAppPage<S>(definition: Parameters<typeof definePage<S>>[0]): PageDefinition<S> {
  assertAppUrlPattern(definition.name, definition.url)
  const page = definePage(definition)
  const isDetail = patternParamsOf(page.url).length > 0
  if (isDetail) {
    // §3.10.5 规则 3：二级页必须 declares 写能力 + 至少挂一个工具 + 说明非空。
    // 写工具的判定 = 页面 writes: true 声明（文档明确其等价性）；目录在位性由
    // app-registry 的注册路径另行校验。一级页不受此约束（规则 2：只读合法）。
    // Rule 3: a detail page must declare write capability, mount at least one
    // tool, and carry non-empty instructions. "Has a write tool" = the page's
    // writes: true declaration (the doc's stated equivalence); catalog presence
    // is validated separately by the app-registry path. Home pages are exempt
    // (rule 2: read-only is legal there).
    if (page.writes !== true) {
      throw new PageError(PageErrorCode.DetailInvalid,
        `detail page "${page.name}" (${page.url}) must declare writes: true — a page bound to one record exists to act on it`)
    }
    if ((page.tools ?? []).length === 0) {
      throw new PageError(PageErrorCode.DetailInvalid,
        `detail page "${page.name}" (${page.url}) must mount at least one tool to fulfill its duty`)
    }
    if (page.instructions === undefined || page.instructions.trim().length === 0) {
      throw new PageError(PageErrorCode.DetailInvalid,
        `detail page "${page.name}" (${page.url}) must carry non-empty instructions ("this page does exactly one thing")`)
    }
  }
  return {
    ...page,
    tools: page.tools ?? [],
  }
}

/** 能力地图条目形状校验：url 与 use 必须是非空字符串 / map entries need non-empty url and use */
function validateMapEntries(name: string, map: readonly PageMapEntry[] | undefined): void {
  for (const [index, entry] of (map ?? []).entries()) {
    if (typeof entry.url !== 'string' || entry.url.trim().length === 0 || typeof entry.use !== 'string' || entry.use.trim().length === 0) {
      throw new Error(`[definePage] page "${name}" map entry #${index} needs a non-empty url and a non-empty use ("when to open it")`)
    }
  }
}

/**
 * 页面工具完备性警告（§3.9，开发期轻量核对）：页面声明了"本页职责需要写能力"
 * 却一个工具都没挂 → 返回一句话警告；否则 undefined。只提醒，不做门禁——
 * 五秒钟看懂在提醒什么："页面开着、活干不了"。
 * Page tool-coverage warning (§3.9, dev-time lightweight self-check): a page
 * that declares `writes: true` yet mounts no tools returns a one-line warning;
 * otherwise undefined. A reminder, never a gate.
 */
export function pageToolWarning<S>(page: PageDefinition<S>): string | undefined {
  if (page.writes !== true || (page.tools ?? []).length > 0) return undefined
  return `page "${page.name}" declares writes: true but mounts no tools; it is open yet cannot do its declared job`
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

/** 迁移期载体：preset 不再在 PageDefinition 上，旧调用方直接传这个形状 / legacy carrier shape */
export interface LegacyPresetCarrier {
  readonly name: string
  readonly description: string
  readonly preset: PagePresetSpec
}

/**
 * @deprecated 构建页面 preset 定义（迁移期兼容，§8.4）。新代码不注册页面预设。
 */
export function buildPagePreset<S>(
  page: PageDefinition<S> | LegacyPresetCarrier,
  options: BuildPagePresetOptions = {},
): PresetDefinition {
  const presetSpec = 'preset' in page && page.preset !== undefined ? page.preset : undefined
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
