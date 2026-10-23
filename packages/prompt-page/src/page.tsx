/**
 * 页面作者词汇层（减法后）：definePage / defineAppPage / 工具完备性警告。
 * The page-authoring vocabulary after the subtraction: definePage /
 * defineAppPage / the tool-coverage warning.
 *
 * v2（RFC prompt-page-render）：页面 = 组件（PageFC，component.tsx）。本文件
 * 只保留两件事——契约校验（URL 形态、§3.10.5 规则 3）与 §3.9 工具完备性警告；
 * 旧块词汇（Static/Data/Keyed）、块宿主挂载（mountPage）与动态 preset 构建
 * 已整体删除——组件管线是唯一路径，不存在第二套。
 * v2 (RFC prompt-page-render): a page IS a component (PageFC, component.tsx).
 * This file keeps only two things — contract validation (url shape, §3.10.5
 * rule 3) and the §3.9 tool-coverage warning. The legacy block vocabulary
 * (Static/Data/Keyed), the block-host mounting (mountPage) and the dynamic
 * preset builder are deleted outright — the component pipeline is the only
 * path; there is no second one.
 * @module @veren/prompt-page
 */
import { PageError, PageErrorCode, assertAppUrlPattern, patternParamsOf } from './contract.ts'
import type { PageDefinition, PageLoadEnv, PageJsonValue, PageParams, PageSkill } from './types.ts'

/** URL 模式校验（应用内形态；/apps/<appId> 前缀由 assertAppUrlPattern 在 defineAppPage 强制）
 * / url pattern validation (the app-internal shape; the /apps/<appId> prefix is enforced by assertAppUrlPattern in defineAppPage) */
function validateUrlPattern(name: string, url: string): void {
  if (!url.startsWith('/') || url.includes('?')) {
    throw new Error(`[definePage] page "${name}" url must be a path pattern like /xx/:id, got ${JSON.stringify(url)}`)
  }
  const segments = url.split('/').filter((segment) => segment.length > 0)
  const paramNames = new Set<string>()
  for (const segment of segments) {
    // 相对段（'.'/'..'）不是页面身份的一部分：canonicalize 会解析掉它们，注册期直接拒绝
    // / relative segments ('.'/'..') are not part of page identity: canonicalize resolves them away, so registration refuses them
    if (segment === '.' || segment === '..') {
      throw new Error(`[definePage] page "${name}" url has a relative segment ${JSON.stringify(segment)}`)
    }
    if (!segment.startsWith(':')) continue
    const paramName = segment.slice(1)
    if (paramName.length === 0 || paramNames.has(paramName)) {
      throw new Error(`[definePage] page "${name}" has an invalid or duplicate :param: ${JSON.stringify(segment)}`)
    }
    paramNames.add(paramName)
  }
}

/**
 * definePage：组件页的契约校验入口（组件形态由 component.tsx 的
 * defineComponentPage 构造 PageDefinition，两入口共用本校验）。
 * definePage: the contract-validation entry for component pages (the component
 * form builds its PageDefinition via defineComponentPage in component.tsx; both
 * entries share this validation).
 */
export function definePage<S>(definition: {
  name: string
  url: string
  description: string
  writes?: boolean
  instructions?: string
  skills?: readonly PageSkill[]
  load?: (params: PageParams, env: PageLoadEnv) => Promise<PageJsonValue>
  instanceTitle?: (params: PageParams) => string
}): PageDefinition<S> {
  const { name, url, description, writes, instructions, skills, load, instanceTitle } = definition
  if (name.length === 0 || name.trim() !== name) {
    throw new Error(`[definePage] invalid page name: ${JSON.stringify(name)}`)
  }
  validateUrlPattern(name, url)
  if (description.length === 0 || description.trim() !== description) {
    throw new Error(`[definePage] page "${name}" needs a non-empty description`)
  }
  return {
    name, url, description,
    ...(writes === undefined ? {} : { writes }),
    ...(instructions === undefined ? {} : { instructions }),
    ...(skills === undefined ? {} : { skills }),
    ...(load === undefined ? {} : { load }),
    ...(instanceTitle === undefined ? {} : { instanceTitle }),
  }
}

/**
 * 应用作用域的页面定义：在 definePage 之上强制 `/apps/<appId>/...` URL 形态，
 * 并做详情页说明校验（§3.10.5 规则 3 的说明半边；工具半边移到挂载期，由
 * page-registry 以真实登记面判）。组件注册器（app-registry）的注册路径应使用
 * 本函数或等效校验。
 * App-scoped definePage: enforces the /apps url shape and the instructions
 * half of the detail rule (§3.10.5 rule 3; the tool half moved to mount time,
 * judged by page-registry over the really-collected face). App-registry's
 * registration path should use this function or equivalent validation.
 */
export function defineAppPage<S>(definition: Parameters<typeof definePage<S>>[0]): PageDefinition<S> {
  assertAppUrlPattern(definition.name, definition.url)
  const page = definePage(definition)
  const hasParams = patternParamsOf(page.url).length > 0
  const isDetail = hasParams && page.writes === true
  if (isDetail) {
    // §3.10.5 规则 3（说明半边）：带 :param 且声明写意图的详情页说明非空；
    // 工具半边（至少登记一个工具）在挂载期由 page-registry 以真实登记面判。
    // 带 :param 而未声明 writes = viewer（只读详情），全部豁免（规则 2）。
    // Rule 3 (the instructions half): a parameterized page that declared write
    // intent must carry non-empty instructions; the tool half (at least one
    // recorded tool) is judged at mount time by page-registry over the really-
    // collected face. A parameterized page without the declaration is a viewer
    // (a read-only drilldown) and is fully exempt (rule 2).
    if (page.instructions === undefined || page.instructions.trim().length === 0) {
      throw new PageError(PageErrorCode.DetailInvalid,
        `detail page "${page.name}" (${page.url}) must carry non-empty instructions ("this page does exactly one thing")`)
    }
  }
  return page
}

/**
 * 页面工具完备性警告（§3.9，开发期轻量核对）：页面声明了"本页职责需要写能力"
 * 却一个工具都没挂 → 返回一句话警告；否则 undefined。判据是**真实挂载面**
 * （静态声明 + 组件体 ctx.page.tool 登记的并集，由挂载方传入数量）——注册期
 * 只看得到静态声明，在那里判必然误报。
 * The page tool-coverage warning (§3.9, a dev-time lightweight self-check): a
 * page that declares `writes: true` yet mounts no tools returns a one-line
 * warning; otherwise undefined. The verdict reads the **really-mounted face**
 * (the union of static declarations and the body's ctx.page.tool records; the
 * mounter passes the count) — registration time only sees static declarations,
 * so judging there is a guaranteed false positive.
 */
export function pageToolWarning<S>(page: PageDefinition<S>, mountedTools: number): string | undefined {
  if (page.writes !== true || mountedTools > 0) return undefined
  return `page "${page.name}" declares writes: true but mounts no tools; it is open yet cannot do its declared job`
}
