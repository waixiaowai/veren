/**
 * 页面运行时：打开一个 URL 一律新建一条会话，旧会话废弃（§3.5.3、§9.1）。
 * Page runtime: opening a url ALWAYS creates a fresh session and deprecates
 * the previous one (§3.5.3, §9.1).
 *
 * 简化后的不变量：
 * - 打开 URL 不再复用：同一 URL 连开两次得到两条会话，索引指向后一条，
 *   前一条被标废弃（工具摘除、租约释放），但仍可读、不再追加 PAGE 块；
 * - 会话内永不换页；打开另一个 URL 与当前会话零改动（只废弃同 URL 的旧会话）；
 * - 废弃释放顺序（§3.5.3）：摘页面工具 → 释放任务租约 → 写废弃标记（索引腾出
 *   URL）→ 两阶段建新会话（reserve → 建会话/挂工具/写 PAGE → commit）；
 *   任何一步失败都收敛：废弃标记写失败 = 旧会话仍是索引里的活会话（下次打开
 *   重试废弃）；建新会话失败 = 半成品清理 + reserved 行删除，URL 下次打开重试；
 * - 任务租约随废弃释放：旧会话持有的 `taken` 租约由 tasks 面 release，
 *   否则新会话会 `already-taken`，任务被废弃会话占死。
 *
 * 宿主对接走注入端口（sessions/apps/toolsOf/tasks/deliveries/releaseLeases）：
 * 端口全部由装配层（app-host）经 bindPorts **纯参数**传入（G13 规则 2），本包
 * 不触碰任何 ctx、不探测兄弟服务；apps/toolsOf 是必填端口（没有它们页面打不开），
 * tasks/deliveries/releaseLeases 是可选能力端口（缺席时按各自语义降级，同 G13
 * 规格中"可选能力仍走参数"的形态）。本包只依赖各服务包的类型出口，不依赖其运行时。
 * Host access goes through injected ports passed as pure parameters by the
 * host assembly (app-host); nothing here touches a Context or probes siblings.
 *
 * @module @veren/page-registry/runtime
 */
import { PageError, PageErrorCode, assertParamsMatchPattern, canonicalizePageUrl } from '@veren/prompt-page'
import type { PageJsonValue, PageLoadEnv, PageMapEntry, PageSession } from '@veren/prompt-page'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { PageInstanceIndex, PageInstanceKey, PageMatch } from '@veren/prompt-page'
// 服务面类型只引真正的那一份：应用记录/任务契约来自各自的 declaration merging 出口，
// 本包不再手写影子副本（同一事实只有一份类型声明）。
// Service-surface types are imported, never shadowed: the app record and the task
// contract come from the owning packages' public entries.
import type { AppRecord } from '@veren/app-registry'
import type { TaskCenterContract, TaskId, TaskRecord } from '@veren/task-center'
import type { AppRegistryService } from '@veren/app-registry'
import type { TaskCenterService } from '@veren/task-center'

/** 应用工具目录面：本地名 → DSH `ToolDefinition` 本体（listTools 的投影，非影子副本）
 * / app tool catalog: local name → DSH definition (a projection of listTools, not a shadow) */
export type ToolsFace = (appId: string) => ReadonlyMap<string, ToolDefinition>

/**
 * 挂进会话的页面工具：就是 DSH `ToolDefinition` 本体，唯一改动是把 `name`
 * 换成对外名（`<toolPrefix>__<本地名>`）——字段零删减，不是形状转换。
 * A mounted page tool IS the DSH definition; only `name` is renamed to the
 * external form — no field is dropped, so this is not a shape conversion.
 */
export type MountedTool = ToolDefinition

/**
 * 任务通知投递面（B 的 pendingDeliveries/markDelivered 投影）：只留投递必需的
 * 两个方法与 { deliveryId, text }，避免页面运行时耦合完整 TaskRecord。
 * The delivery face: a projection of task-center's pendingDeliveries/markDelivered
 * that keeps only { deliveryId, text }, so the page runtime never couples to TaskRecord.
 */
export interface DeliveryFace {
  /** 取全部可投递的收件箱通知 / every deliverable pending inbox notice */
  pending(): Promise<readonly { deliveryId: string; text: string }[]>
  /** 回报一次投递结果（成功不传 error）/ report one delivery attempt outcome */
  mark(deliveryId: string, error?: string): Promise<unknown>
}

/** 挂进会话的工具：就是 DSH `ToolDefinition` 本体（见文件顶部 MountedTool 别名）/ a mounted tool IS the DSH definition */

/**
 * 会话端口：运行时对 DSH 会话机制的全部假设收在这一个面上。
 * The session port: every assumption about DSH sessions narrows to this face.
 */
export interface PageSessionPort {
  exists(sessionId: string): boolean
  mintId(): string
  create(sessionId: string, title: string): Promise<void>
  /**
   * 追加一条消息。`options.wake === false` 时不唤醒 agent（消息只落会话日志，
   * 等该会话下一次被唤醒时一并消费）；缺省唤醒（§3.9 唤醒策略）。
   * Append one message. `wake === false` appends without waking the agent (the
   * message lands in the session log and is consumed on the next wake);
   * default wakes (§3.9 wake policy).
   */
  appendUserMessage(sessionId: string, text: string, source: string, options?: { readonly wake?: boolean }): Promise<void>
  /** 挂页面工具；重名冲突抛 PageError(page/tool-conflict) / mount; conflicts raise */
  mountTools(sessionId: string, tools: readonly MountedTool[]): Promise<void>
  releaseTools(sessionId: string): Promise<void>
  focus(sessionId: string): Promise<void>
  /** 创建失败兜底：销毁半成品会话 / destroy a half-built session */
  destroy(sessionId: string): Promise<void>
}

/** 实时视图的身份标识：PAGE-DATA 块头用的页面键与规范 URL / the live view identity: pageKey + canonical url for the PAGE-DATA header */
export interface PageDataIdentity {
  /** 页面键（应用页即 `<appId>/<本地名>`）/ the page key (app pages: `<appId>/<localName>`) */
  readonly pageKey: string
  /** 规范 URL / the canonical url */
  readonly url: string
}

/**
 * 实时视图端口（§3.10.2 的 PAGE-DATA 承载通道）：会话提交后绑定、废弃/回滚时
 * 解绑。视图本体（订阅 store 的 MessageHost）由绑定方持有——本运行时只宣布
 * "这条会话现在是这个页面的活视图"，怎么渲染、怎么截断、怎么进上下文都归宿主。
 * The live-view port (the PAGE-DATA channel of §3.10.2): bound once a session
 * commits, unbound on deprecation/rollback. The view itself (the store-subscribed
 * MessageHost) is owned by the binder — this runtime only announces "this
 * session is now the live view of that page"; rendering, caps, and context
 * delivery all belong to the host.
 */
export interface PageDataPort {
  /** 会话提交后绑定一个实时视图（视图生命周期自此归端口）/ bind one live view after commit (lifecycle passes to the port) */
  bind(sessionId: string, view: PageSession<never>, identity: PageDataIdentity): void
  /** 废弃/回滚：解绑并退订 store / deprecation or rollback: unbind and unsubscribe the store */
  unbind(sessionId: string): void
}

/** 运行时端口集：apps/toolsOf 必填，任务相关为可选能力端口（全部是纯参数）
 * / the runtime's ports: apps/toolsOf required, task faces optional capabilities */
export interface PageRuntimePorts {
  readonly sessions: PageSessionPort
  /** 应用注册表真实面（AppRecord）：应用不在场时 openUrl 给 app/not-found / the real app-registry face */
  readonly apps: Pick<AppRegistryService, 'get'>
  /** 应用工具目录（listTools 投影）：页面声明了工具就必须有目录 / the app tool catalog */
  readonly toolsOf: ToolsFace
  /** 任务中心真实契约的 take：缺席则任务场景给 page/host-unavailable / the real task contract */
  readonly tasks?: Pick<TaskCenterContract, 'take'>
  /** 任务通知投递面（§5.2 inbox 注入）；缺席则跳过投递 / delivery face; absent → skip pumping */
  readonly deliveries?: DeliveryFace
  /**
   * 废弃会话时释放它持有的任务租约（§3.5.3）；缺席则租约靠懒回收兜底。
   * Release the task leases a deprecated session holds (§3.5.3); absent, lazy
   * lease recycling in the task center is the fallback.
   */
  readonly releaseLeases?: (sessionId: string) => Promise<void>
  /** 任务租约时长（分钟），缺省 30 / lease minutes, default 30 */
  readonly leaseMinutes?: number
  /** 实时视图端口：缺席则页面保持静态（无 PAGE-DATA 同步）/ the live-view port; absent → pages stay static */
  readonly pageData?: PageDataPort
  /**
   * 页面会话的预设 id（§3.10.3 PageLoadEnv.preset 的来源）：按预设隔离数据的
   * 应用（记事本）在首屏 load 里以此解析归属。缺席 → env 不带 preset，load
   * 自行显式表达"归属未知"。
   * The page session's preset id (the source of PageLoadEnv.preset, §3.10.3):
   * preset-scoped apps (the notebook) resolve their owner in the first-screen
   * load from it. Absent → env carries no preset and the load states "owner
   * unknown" explicitly.
   */
  readonly presetOf?: (sessionId: string) => string | undefined
}

/** openUrl 的可选参数；createPageSession 另接受 `focus: false`（投递路径不切界面） */
export interface OpenPageOptions {
  /** 任务场景：先 take 再追加 TASK 块（§5.3）/ take the task, then append TASK */
  readonly taskId?: string
  readonly actor?: string
  /** 投递路径置 false：建会话但不发 GUI focus（投递不是导航，§3.9） */
  readonly focus?: boolean
}

/** openUrl 的结果：打开一律新建，结果就是新会话 / openUrl result: the fresh session */
export interface OpenPageResult {
  readonly sessionId: string
  readonly url: string
  readonly title: string
}

/** 规范 URL 里的 appId 段 / the appId segment of a canonical url */
export function appIdOf(url: string): string | undefined {
  const segments = url.split('/').filter((segment) => segment.length > 0)
  return segments.length >= 2 ? segments[1]! : undefined
}

/** 实例标题：instanceTitle(params) → description 兜底，上限 60 字（§3.6.1） */
export function instanceTitleOf(match: PageMatch<never>, params: Record<string, string>): string {
  const raw = match.page.instanceTitle?.(params) ?? match.page.description
  return raw.length > 60 ? `${raw.slice(0, 59)}…` : raw
}

/** 工具对外名：`<toolPrefix>__<本地名>`（§3.4.3）/ external tool name */
export function externalToolName(toolPrefix: string, localName: string): string {
  return `${toolPrefix}__${localName}`
}

/** 把页面声明的本地工具名解析成挂载清单：DSH 本体只改 name（§3.4.3）/ resolve local names to mounted DSH definitions */
function resolveMountedTools(
  app: AppRecord,
  match: PageMatch<never>,
  toolsOf: ToolsFace,
): MountedTool[] {
  const localNames = match.page.tools ?? []
  if (localNames.length === 0) return []
  const catalog = toolsOf(app.definition.id)
  return localNames.map((localName) => {
    const spec = catalog.get(localName)
    if (spec === undefined) {
      throw new PageError(PageErrorCode.UnknownTool, `page "${match.page.name}" references unknown tool "${localName}" of app "${app.definition.id}"`)
    }
    // 唯一允许的"转换"：改名。字段原样保留（含 output/presentCall 等 DSH 契约）。
    // The one permitted change: the name. Every DSH field is preserved verbatim.
    return { ...spec, name: externalToolName(app.toolPrefix, localName) }
  })
}

/** 全局页面键：应用页为 `<appId>/<本地名>`，裸名路径（raw register）补前缀 / the global pageKey */
export function pageKeyOf(app: AppRecord, pageName: string): string {
  return pageName.includes('/') ? pageName : `${app.definition.id}/${pageName}`
}

/** 首屏 load 超时（§3.10.3：超时兜底按失败态处理，不静默悬挂）/ the first-screen load timeout (§3.10.3: timeout degrades to the error state) */
export const PAGE_LOAD_TIMEOUT_MS = 10_000

/** data 失败态的重试指引（§3.10.3：错误也是信息，必须带重试路径）/ the retry hint of the data error state (§3.10.3) */
const LOAD_RETRY_HINT = '重开本页 URL 即可重取首屏数据'

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

/** map 行用途短语上限（与工具用途短语同口径，防单条地图行失控）/ the use-phrase cap of a map row (same as the tool phrase; keeps one row bounded) */
const MAP_USE_CAP = 60

/**
 * 能力地图行头（§3.10.2）：告诉模型这一组行怎么用——模板里的 `:参数` 替换成
 * 实际值即为可打开的 URL。"能被模型直接照抄"是本格式的验收标准，不是装饰。
 * The capability-map header (§3.10.2): tells the model how to use the rows —
 * substituting the `:params` of a template yields an openable url. "Copy-usable
 * by the model" is the acceptance bar of this format, not decoration.
 */
const MAP_HEADER = 'map:（能力地图——本应用可去的页面；把模板里的 :参数 替换为实际值即为可打开 URL）'

/**
 * 能力地图条目 → 一行可照抄的文本（§3.10.2）：`- 模板 → 什么时候用；参数: 名=说明`。
 * 真机教训：map 若只是页面定义里的声明（或压缩成一团 JSON），模型会绕开它自行
 * 推断地址——所以这里逐条成行、模板原样给出、参数说明跟在同一行，让"我从本页
 * 能力地图看到的"成为模型唯一自然的答案来源。
 * One map entry → one copy-usable line (§3.10.2): the lesson from the live host
 * is that a map that merely lives in the page definition (or as a JSON blob)
 * gets bypassed — the model infers addresses from other clues instead. So each
 * entry renders as its own line: the template verbatim, the when-to-use phrase,
 * and the param notes on the same line, making "I read it in this page's map"
 * the natural source for the model to cite.
 */
export function mapEntryLine(entry: PageMapEntry): string {
  const use = entry.use.length > MAP_USE_CAP ? `${entry.use.slice(0, MAP_USE_CAP - 1)}…` : entry.use
  const params = entry.params === undefined
    ? ''
    : `；参数: ${Object.entries(entry.params).map(([name, note]) => `${name}=${note}`).join('、')}`
  return `- ${entry.url} → ${use}${params}`
}

/**
 * PAGE 块（§3.10.2 的规范形状）：页面键 + 规范 URL、params、data（首屏快照，
 * 永远在场——loading/error/数据/null，禁止静默空白）、能力地图（非空时，
 * 逐条成行可照抄）、带"什么时候用"的工具行、应用与页面说明。写一次不再重写
 * （§3.4.2）。
 * The PAGE block (the §3.10.2 canonical shape): pageKey + canonical url,
 * params, data (the first-screen snapshot, always present — loading/error/
 * data/null, never a silent blank), the capability map when non-empty (one
 * copy-usable line per entry), the tools line with when-to-use phrases, and
 * the app/page notes. Written once, never rewritten (§3.4.2).
 *
 * 能力地图与数据快照的预算关系（§3.10.2）：整块只在建会话时写一次，PAGE-DATA
 * 的截断上限（≤50 条 / 单块 ≤4KB，app-host 的 PageDataCaps）只约束**后续追加的
 * data 快照块**；map 是静态小数据——一行一个可去页面、用途短语截 60 字——
 * 不占追加预算，也**有意不做截断**：规则 1 要求列全全部记录页，截断会静默吞掉
 * 地图条目，比超预算更糟。
 * Budget relation between the map and the data snapshot (§3.10.2): the whole
 * block is written once at creation; the PAGE-DATA caps (≤50 rows / ≤4KB per
 * block, app-host's PageDataCaps) bound only the **appended data snapshots**.
 * The map is small static data — one line per reachable page, use phrases
 * capped at 60 chars — consumes none of the append budget, and is
 * **deliberately never truncated**: rule 1 demands full coverage of record
 * pages, and truncation would silently drop map entries, which is worse than
 * exceeding a budget.
 */
export function pageBlock(
  app: AppRecord,
  match: PageMatch<never>,
  canonicalUrl: string,
  params: Record<string, string>,
  tools: readonly MountedTool[],
  data: PageJsonValue,
): string {
  const lines = [
    `PAGE ${pageKeyOf(app, match.page.name)} ${canonicalUrl}`,
    `params: ${JSON.stringify(params)}`,
    `data: ${JSON.stringify(data)}`,
  ]
  // 能力地图是一等数据（§3.10.1/§3.10.2）：首行讲用法，每条一行"模板 → 什么时候用
  // （+参数说明）"——模型照抄模板、替换 :参数 即得可打开 URL。
  // The capability map as first-class data (§3.10.1/§3.10.2): a header stating
  // the usage, then one line per entry "template → when to open it (+param
  // notes)" — the model copies the template and substitutes :params.
  const map = match.page.map ?? []
  if (map.length > 0) {
    lines.push(MAP_HEADER)
    for (const entry of map) lines.push(mapEntryLine(entry))
  }
  lines.push(tools.length === 0
    ? 'tools: （无）'
    : `tools: ${tools.map((tool) => `${tool.name}（${toolUsagePhrase(tool.description)}）`).join('、')}`)
  if (app.definition.instructions !== undefined) lines.push(`应用说明：${app.definition.instructions}`)
  if (match.page.instructions !== undefined) lines.push(`说明：${match.page.instructions}`)
  return lines.join('\n')
}

/**
 * 首屏数据（§3.10.3）：load 是 PAGE 块 data 的唯一合法来源。未声明 load →
 * null（如实表达"本页无可预载的数据"，仍不许空白）；抛错/超时 → 失败态
 * （page/load-failed + 重试指引）——错误也是信息。
 * The first-screen data (§3.10.3): load is the only legal source of the PAGE
 * block's data line. No loader → null (an explicit "nothing to preload", still
 * not a blank); a throw or timeout → the error state (page/load-failed with a
 * retry hint) — errors are information too.
 */
export async function firstScreenData(page: PageMatch<never>['page'], params: Record<string, string>, env: PageLoadEnv): Promise<PageJsonValue> {
  const load = page.load
  if (load === undefined) return null
  try {
    return await new Promise<PageJsonValue>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`first-screen load timed out after ${PAGE_LOAD_TIMEOUT_MS}ms`)), PAGE_LOAD_TIMEOUT_MS)
      load(params, env).then(
        (value) => { clearTimeout(timer); resolve(value) },
        (error: unknown) => { clearTimeout(timer); reject(error) },
      )
    })
  } catch (error: unknown) {
    return {
      error: {
        code: PageErrorCode.LoadFailed,
        message: error instanceof Error ? error.message : String(error),
      },
      retry: LOAD_RETRY_HINT,
    }
  }
}

/** TASK 块：任务成功接取后追加一次（§5.4）/ the TASK block, appended once */
export function taskBlock(taskId: string, task: TaskRecord | undefined): string {
  const title = typeof task?.title === 'string' ? task.title : taskId
  return `TASK ${taskId} ${title}\n完成后用 task_complete 回报结果；做不下去用 task_fail 带稳定错误码回报。`
}

/**
 * 解析并校验一个页面 URL 目标（canonicalize + 应用在场/启用 + 页面命中）。
 * openUrl 与投递路径（§3.9 delivery）共用的同一段校验。
 * Resolve and validate a page-url target (canonicalize + app present/active +
 * page hit). Shared by openUrl and the delivery path (§3.9).
 */
export function resolvePageTarget(
  registry: { resolve(url: string): PageMatch<never> | null },
  ports: PageRuntimePorts,
  url: string,
): { key: PageInstanceKey; app: AppRecord; match: PageMatch<never> } {
  const key = canonicalizePageUrl(url)
  const appId = appIdOf(key)
  if (appId === undefined) throw new PageError(PageErrorCode.UrlInvalid, `url ${key} carries no /apps/<appId> segment`)
  // URL 段是字符串，AppId 是 brand：跨边界在此一次性收窄 / url segment → branded AppId at this boundary
  const app = ports.apps.get(appId as AppRecord['definition']['id'])
  if (app === undefined) {
    throw new PageError(PageErrorCode.AppNotFound, `app "${appId}" is not registered`)
  }
  if (app.state !== 'active') {
    throw new PageError(PageErrorCode.AppDisabled, `app "${appId}" is ${app.state}; enable it before opening pages`)
  }
  const match = registry.resolve(key)
  if (match === null) throw new PageError(PageErrorCode.PageNotFound, `no page matches ${key}`)
  return { key, app, match }
}

/**
 * 打开一个 URL：一律新建会话；同 URL 旧会话先废弃（§3.5.3、§9.1）。
 * Open a url: always create a fresh session; the previous one on the same url
 * is deprecated first.
 */
export async function openPageUrl(
  registry: { resolve(url: string): PageMatch<never> | null },
  index: PageInstanceIndex,
  ports: PageRuntimePorts,
  url: string,
  options: OpenPageOptions = {},
): Promise<OpenPageResult> {
  const { key, app, match } = resolvePageTarget(registry, ports, url)
  await deprecatePrevious(index, ports, key)
  return createPageSession(index, ports, key, app, match, options)
}

/**
 * 废弃同 URL 的旧会话（§3.5.3 释放顺序）：摘页面工具 → 释放任务租约 → 写废弃
 * 标记（索引腾出 URL）。单步失败不阻断：工具摘除/租约释放失败只影响旧会话自身，
 * 废弃标记照写（旧会话已不该被 URL 访问）；废弃标记写失败则整步中止——旧会话
 * 仍是索引里的活会话，下次打开重试废弃，收敛为"恰好一条活会话"。
 * Deprecate the previous session on this url (§3.5.3 release order): strip page
 * tools → release task leases → write the deprecated marker (freeing the url).
 * Tool/lease failures never block: only the old session is affected, and the
 * marker still moves it out of the url. A marker write failure aborts the whole
 * step — the old session remains the index's live row, the next open retries
 * the deprecation, and the invariant "exactly one live session per url" holds.
 */
async function deprecatePrevious(index: PageInstanceIndex, ports: PageRuntimePorts, key: PageInstanceKey): Promise<void> {
  const previous = await index.lookup(key)
  if (previous === undefined) return
  await ports.sessions.releaseTools(previous.sessionId).catch(() => undefined)
  // 实时视图随工具一起摘（§3.10.3）：旧会话退出活跃视图，store 订阅同步退订。
  // The live view leaves with the tools (§3.10.3): the old session stops being
  // an active view and its store subscription is unsubscribed.
  try {
    ports.pageData?.unbind(previous.sessionId)
  } catch {
    // 解绑失败不阻断废弃（unbindError 只可能是端口实现内的瞬态故障）：最坏情形
    // 是旧视图多活一阵，下轮打开重试/覆盖 / an unbind failure never blocks
    // deprecation: worst case the stale view lingers and the next open retries
  }
  await ports.releaseLeases?.(previous.sessionId).catch(() => undefined)
  try {
    await index.deprecate(key, `superseded by a fresh open of ${key}`)
  } catch (error: unknown) {
    throw wrap(error, PageErrorCode.IndexUnavailable, `deprecate(${key}) failed`)
  }
}

/** 任务场景：先 take 再追加 TASK 块；失败码原样透出（§5.3） */
async function takeTask(ports: PageRuntimePorts, taskId: string, sessionId: string, actor?: string): Promise<void> {
  if (ports.tasks === undefined) {
    throw new PageError(PageErrorCode.HostUnavailable, `task center is not available; cannot open task ${taskId}`)
  }
  const leaseUntil = new Date(Date.now() + (ports.leaseMinutes ?? 30) * 60_000).toISOString()
  // 字符串任务 id 在此一次收窄为 brand / plain task id narrows to the brand here
  const task = await ports.tasks.take(taskId as TaskId, { sessionId, actor: actor ?? 'local', leaseUntil })
  await ports.sessions.appendUserMessage(sessionId, taskBlock(taskId, task), 'app/task')
}

/**
 * 收件箱投递泵（§5.2：会话启动时注入）：把任务中心所有可投递通知注进这条
 * 会话，然后逐条回报投递结果——成功翻 delivered，追加失败保持 pending 并记
 * 原因。投递面缺席或取通知失败都只降级，不影响页面打开本身。
 * The inbox pump (§5.2): inject every deliverable notice into this session on
 * session start, then report each attempt — success flips delivered, an append
 * failure stays pending with the reason. Delivery-face absence or fetch errors
 * degrade silently: opening the page itself never fails because of the pump.
 */
export async function pumpDeliveries(ports: PageRuntimePorts, sessionId: string): Promise<void> {
  const deliveries = ports.deliveries
  if (deliveries === undefined) return
  let notices: readonly { deliveryId: string; text: string }[]
  try {
    notices = await deliveries.pending()
  } catch {
    // 取通知失败属任务中心侧故障：不阻塞会话，等下一轮再投 / fetching failed: retry later
    return
  }
  for (const notice of notices) {
    try {
      await ports.sessions.appendUserMessage(sessionId, notice.text, 'task-center/notice')
      await deliveries.mark(notice.deliveryId)
    } catch (error: unknown) {
      await deliveries.mark(notice.deliveryId, error instanceof Error ? error.message : String(error)).catch(() => undefined)
    }
  }
}

/** 两阶段创建；每一步失败都清理半成品 + 删 reserved 行。`focus: false` 用于
 *  投递路径（§3.9）：建会话但不把 GUI 切过去——投递不是导航。 */
export async function createPageSession(
  index: PageInstanceIndex,
  ports: PageRuntimePorts,
  key: PageInstanceKey,
  app: AppRecord,
  match: PageMatch<never>,
  options: OpenPageOptions,
): Promise<OpenPageResult> {
  const params = { ...match.params }
  // §3.10.5 规则 5（挂载期）：params 必须覆盖 URL 模式的每个 :param，写 PAGE 块前 fail loud。
  // §3.10.5 rule 5 (mount time): params must cover every :param of the pattern, failing loud before the PAGE block.
  assertParamsMatchPattern(match.page.url, params)
  const sessionId = ports.sessions.mintId()
  try {
    await index.reserve(key, sessionId, {
      appId: app.definition.id,
      // 应用页的 match.page.name 已是 pageKey（<appId>/<本地名>，见
      // registerAppPage）；裸名路径（raw register）保留旧的前缀拼接。
      // app pages already carry the pageKey as their name (registerAppPage);
      // the raw-register path keeps the legacy prefixing.
      page: pageKeyOf(app, match.page.name),
      instanceTitle: instanceTitleOf(match, params),
      params,
      appVersion: app.version,
    })
  } catch (error: unknown) {
    throw wrap(error, PageErrorCode.IndexUnavailable, `reserve(${key}) failed`)
  }
  const title = instanceTitleOf(match, params)
  let tools: MountedTool[] = []
  try {
    await ports.sessions.create(sessionId, title)
  } catch (error: unknown) {
    await ports.sessions.releaseTools(sessionId).catch(() => undefined)
    await ports.sessions.destroy(sessionId).catch(() => undefined)
    await index.fail(key, error instanceof Error ? error.message : String(error)).catch(() => undefined)
    throw wrap(error, PageErrorCode.SessionCreateFailed, `session create failed for ${key}`)
  }
  try {
    tools = resolveMountedTools(app, match, ports.toolsOf)
    await ports.sessions.mountTools(sessionId, tools)
    // 首屏数据（§3.10.3）在写 PAGE 块前取齐：两阶段 commit 允许先落 reserved，
    // load 完成（或失败态定形）才翻 live——首屏数据建会话时就进上下文。
    // The first-screen data (§3.10.3) settles before the PAGE block: the
    // two-phase commit keeps the row reserved until load resolves (or its
    // error state forms) — the first screen enters the context at creation.
    const env: PageLoadEnv = ports.presetOf === undefined ? {} : { preset: ports.presetOf(sessionId) }
    const data = await firstScreenData(match.page, params, env)
    await ports.sessions.appendUserMessage(sessionId, pageBlock(app, match, key, params, tools, data), 'app/page')
    // 实时视图在 commit 前绑定（§3.10.3）：挂载失败走下方既有回滚（fail loud），
    // 不产生"会话活着但视图死着"的半状态；commit 后该视图归端口所有。
    // The live view binds before commit (§3.10.3): a mount failure rides the
    // existing rollback below (fail loud), so a live session never pairs with
    // a dead view; after commit the port owns the view.
    if (match.live !== undefined && ports.pageData !== undefined) {
      ports.pageData.bind(sessionId, match.live.mount(params), {
        pageKey: pageKeyOf(app, match.page.name),
        url: key,
      })
    }
    await index.commit(key, sessionId)
  } catch (error: unknown) {
    // 兜底：摘工具 → 销毁半成品会话 → 删 reserved 行；原始错误码优先透出
    await ports.sessions.releaseTools(sessionId).catch(() => undefined)
    await ports.sessions.destroy(sessionId).catch(() => undefined)
    await index.fail(key, error instanceof Error ? error.message : String(error)).catch(() => undefined)
    // 已绑定的实时视图随半成品一起摘除（幂等；bind 在 commit 前可能已发生）
    // / a bound live view dies with the half-built session (idempotent)
    ports.pageData?.unbind(sessionId)
    throw error
  }
  if (options.taskId !== undefined) await takeTask(ports, options.taskId, sessionId, options.actor)
  // 新会话启动即注入收件箱通知（§5.2 inbox）；失败只降级
  await pumpDeliveries(ports, sessionId)
  if (options.focus !== false) await ports.sessions.focus(sessionId)
  return { sessionId, url: key, title }
}

/** 把非 PageError 的底层失败包成带稳定 code 的 PageError */
function wrap(error: unknown, code: PageErrorCode, prefix: string): unknown {
  if (error instanceof PageError) return error
  return new PageError(code, `${prefix}: ${error instanceof Error ? error.message : String(error)}`)
}
