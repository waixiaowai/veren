/**
 * PAGE 块的纯文本推导：定位行、能力地图、tools 行、说明行、TASK 块与标题/用途
 * 短语。全部是无副作用的纯函数——注册表投影（AppRecord.pages）与真实登记差集
 * 是仅有的两个事实源。
 * Pure text derivation for the PAGE block: the locator line, capability map,
 * tools line, note lines, the TASK block, and the title/usage phrases. All are
 * side-effect-free pure functions — the registry projection (AppRecord.pages)
 * and the real registration delta are the only two fact sources.
 *
 * @module @veren/page-registry/page-block
 */
import type { PageMatch } from '@veren/prompt-page'
import type { AppRecord } from '@veren/app-registry'
import type { TaskRecord } from '@veren/task-center'
import type { PageToolEntry } from './runtime-ports.ts'

/**
 * 实例标题：instanceTitle(params) → description 兜底，上限 60 字（§3.6.1）。
 * The instance title: instanceTitle(params) falling back to the description,
 * capped at 60 characters (§3.6.1).
 */
export function instanceTitleOf(match: PageMatch<never>, params: Record<string, string>): string {
  const raw = match.page.instanceTitle?.(params) ?? match.page.description
  return raw.length > 60 ? `${raw.slice(0, 59)}…` : raw
}

/** 全局页面键：应用页为 `<appId>/<本地名>`，裸名路径（raw register）补前缀 / the global pageKey */
export function pageKeyOf(app: AppRecord, pageName: string): string {
  return pageName.includes('/') ? pageName : `${app.definition.id}/${pageName}`
}

/**
 * 工具用途短语（§3.10.2 的 tools 行）：取 description 的第一句——中英文都以
 * 句号为界，超长截断。"只有名字没有什么时候用"正是本轮要消灭的形状。
 * The tool usage phrase (§3.10.2's tools line): the first sentence of the
 * description, capped. "Names without when-to-use" is exactly what this round
 * removes.
 */
export function toolUsagePhrase(description: string): string {
  const sentence = description.split('。')[0] ?? description
  const fallback = sentence.length >= 4 ? sentence : (description.split('. ')[0] ?? description)
  return fallback.length > 60 ? `${fallback.slice(0, 59)}…` : fallback
}

/**
 * 能力地图行头（§3.10.2）：告诉模型这一组行怎么用——模板里的 `:参数` 替换成
 * 实际值即为可打开的 URL。"能被模型直接照抄"是本格式的验收标准，不是装饰。
 * The capability-map header (§3.10.2): tells the model how to use the rows —
 * substituting the `:params` of a template yields an openable url. "Copy-usable
 * by the model" is the acceptance bar of this format, not decoration.
 */
const MAP_HEADER = 'map:（能力地图——本应用可去的页面；把模板里的 :参数 替换为实际值即为可打开 URL）'

/**
 * 一次收集页面工具面：挂载前后两次快照的差集。组件体在渲染里直接
 * `agent.ctx.tools.register`，挂载方不经手任何定义——差集就是页面工具，
 * PAGE 块的 tools 行、§3.10.5 规则 3 与 §3.9 完备性检查共用这一份事实。
 * Collect the page tool face in one place: the delta of two snapshots around
 * the render. The body registers via `agent.ctx.tools.register` directly and
 * the mounter never handles definitions — the delta IS the page's tools, and
 * the PAGE block's tools line, §3.10.5 rule 3 and the §3.9 completeness check
 * all share this one fact.
 */
export function collectPageTools(before: readonly PageToolEntry[], after: readonly PageToolEntry[]): PageToolEntry[] {
  return after.filter((tool) => !before.some((entry) => entry.name === tool.name))
}

/**
 * 组件页 PAGE 块（RFC prompt-page-render §3.3/C7 的骨架）：PAGE 定位行 + map
 * （注册表推导：本应用兄弟页、排除自身、按注册序，`- 模板 → description`）+
 * tools 行（真实登记面差集）+ 应用说明行 + 可选页面说明行 + Markdown 正文。
 * 无 params/data JSON 行——URL 本身表达 params，正文由组件体渲染；首屏数据
 * 由组件体自己读取并经 followup 以新消息送达，不进 PAGE 块。
 * The component-page PAGE block (the §3.3/C7 skeleton of RFC prompt-page-render):
 * the PAGE locator line + map (registry-derived: sibling pages of this app,
 * excluding self, in registration order, `- template → description`) + the
 * tools line (the real registration delta) + the app-level note + an optional
 * page note + the Markdown body. No params/data JSON lines — params ride the
 * url itself, the body renders itself, and first-screen data is fetched by the
 * body and delivered as followup messages, never inside the PAGE block.
 */
export function componentPageBlock(
  app: AppRecord,
  match: PageMatch<never>,
  canonicalUrl: string,
  tools: readonly PageToolEntry[],
  body: string,
): string {
  const selfKey = pageKeyOf(app, match.page.name)
  const lines = [`PAGE ${selfKey} ${canonicalUrl}`]
  appendCapabilityMap(lines, app, match)
  appendToolsLine(lines, tools)
  appendNotes(lines, app, match)
  lines.push(body)
  return lines.join('\n')
}

/** 能力地图：本应用兄弟页（排除自身、按注册序）逐条成行；无兄弟页不画 / the capability map rows; omitted when no siblings */
function appendCapabilityMap(lines: string[], app: AppRecord, match: PageMatch<never>): void {
  // 自排除按本地名（registerAppPage 会把 page.name 改写为 pageKey，取末段对齐投影键）
  // / self-exclusion by local name (registerAppPage renames page.name to the pageKey; align via the last segment)
  const selfLocal = match.page.name.includes('/') ? (match.page.name.split('/').pop() ?? match.page.name) : match.page.name
  const siblings = [...(app.pages ?? new Map()).entries()].filter(([name]) => name !== selfLocal)
  if (siblings.length === 0) return
  lines.push(MAP_HEADER)
  for (const [, page] of siblings) lines.push(`- ${page.url} → ${page.description}`)
}

/** tools 行：真实登记差集，带用途短语；空差集如实写"无" / the tools line from the real delta; empty honestly rendered */
function appendToolsLine(lines: string[], tools: readonly PageToolEntry[]): void {
  lines.push(tools.length === 0
    ? 'tools: （无）'
    : `tools: ${tools.map((tool) => `${tool.name}（${toolUsagePhrase(tool.description)}）`).join('、')}`)
}

/**
 * 说明两行：应用级说明（整个应用的定位与行为约定）在前，页面说明在后——
 * 先读"这个应用是谁"，再读"这一页怎么用"。缺声明不画行（不制造空行承诺）。
 * The two note lines: the app-level note (the whole application's positioning
 * and behavior contract) first, then the page note — read "what this app is"
 * before "how to use this page". A missing declaration draws no line (no empty
 * promise).
 */
function appendNotes(lines: string[], app: AppRecord, match: PageMatch<never>): void {
  if (app.definition.instructions !== undefined) lines.push(`应用说明：${app.definition.instructions}`)
  if (match.page.instructions !== undefined) lines.push(`说明：${match.page.instructions}`)
}

/** TASK 块：任务成功接取后追加一次（§5.4）/ the TASK block, appended once */
export function taskBlock(taskId: string, task: TaskRecord | undefined): string {
  const title = typeof task?.title === 'string' ? task.title : taskId
  return `TASK ${taskId} ${title}\n完成后用 task_complete 回报结果；做不下去用 task_fail 带稳定错误码回报。`
}
