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
 * 宿主对接走注入端口（sessions/apps/tasks/deliveries/releaseLeases/warn）：
 * 端口全部由装配层（app-host）经 bindPorts **纯参数**传入（G13 规则 2），本包
 * 不触碰任何 ctx、不探测兄弟服务；apps 是必填端口（没有它页面打不开），
 * tasks/deliveries/releaseLeases 是可选能力端口（缺席时按各自语义降级，同 G13
 * 规格中"可选能力仍走参数"的形态）。本包只依赖各服务包的类型出口，不依赖其运行时。
 * Host access goes through injected ports passed as pure parameters by the
 * host assembly (app-host); nothing here touches a Context or probes siblings.
 *
 * @module @veren/page-registry/runtime
 */
import type { Context } from '@deepseek-ai/cordis'
import { PageError, PageErrorCode, assertParamsMatchPattern, canonicalizePageUrl, isMarkdownDocHost, pageArchetypeOf, pageToolWarning, patternParamsOf, snapshotSinkOf } from '@veren/prompt-page'
import type { PageJsonValue, PageLoadEnv, PageSession, PageSkill } from '@veren/prompt-page'
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

/** 挂进会话的页面工具：就是 DSH `ToolDefinition` 本体，唯一改动是把 `name`
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
  /**
   * 该会话的 agent 作用域（`agent.ctx`）：页面组件的 effect/on 经它注册，
   * 事件按 agent 过滤、清理随作用域销毁。缺省（agent 尚未创建，如暂存预览）
   * 或端口未实现时，视图回退到创建者 ctx / 视图级清理。
   * The session's agent scope (`agent.ctx`): the page's effect/on register
   * through it, so events are agent-filtered and cleanup follows the scope.
   * Absent (no agent yet, e.g. a staged preview) or unimplemented, the view
   * falls back to the creator ctx / view-level cleanup.
   */
  scopeOf?(sessionId: string): Context | undefined
  /**
   * 挂页面工具与页面级 skills；工具重名冲突抛 PageError(page/tool-conflict)。
   * skills 随同一组注销器挂进会话 agent 作用域，释放与工具同序。
   * Mount the page tools and the page-scope skills; tool conflicts raise
   * PageError(page/tool-conflict). Skills join the same disposer group in the
   * session's agent scope and are released together with the tools.
   */
  mountTools(sessionId: string, tools: readonly MountedTool[], skills?: readonly PageSkill[]): Promise<void>
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
  /**
   * 会话提交后绑定一个实时视图（视图生命周期自此归端口）。`cursor` 是 PAGE 块
   * 已经覆盖到的版本：块正文与视图同源，绑定从该版本之后开始投递，避免把块里
   * 已有的内容再当 PAGE-PATCH 发一遍。
   * Bind one live view after commit (lifecycle passes to the port). `cursor` is
   * the version already covered by the PAGE block: the block body comes from the
   * same view, so delivery starts after it and never re-sends that content as a
   * PAGE-PATCH.
   */
  bind(sessionId: string, view: PageSession<never>, identity: PageDataIdentity, cursor?: number): void
  /** 废弃/回滚：解绑并退订 store / deprecation or rollback: unbind and unsubscribe the store */
  unbind(sessionId: string): void
}

/** 运行时端口集：apps 必填，任务相关为可选能力端口（全部是纯参数）
 * / the runtime's ports: apps required, task faces optional capabilities */
export interface PageRuntimePorts {
  readonly sessions: PageSessionPort
  /** 应用注册表真实面（AppRecord）：应用不在场时 openUrl 给 app/not-found / the real app-registry face */
  readonly apps: Pick<AppRegistryService, 'get'>
  /**
   * 挂载期完备性告警（§3.9）：真实工具面收集后判"声明要写却挂不出工具"——
   * 注册期看不到组件体的动态登记，只有这里才有资格下结论。缺席 → 静默跳过。
   * The mount-time completeness warning (§3.9): judges "declares writes but
   * mounts none" after the real tool face is collected — registration time
   * cannot see the body's dynamic records, so only here may the verdict be
   * drawn. Absent → skipped silently.
   */
  readonly warn?: (message: string) => void
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
  /**
   * 复用一条已存在的会话（"先选应用、发送才开会话"的提升路径）：跳过建会话，
   * 直接在给定会话上落页面实例（PAGE 块以 wake=false 追加，不另起一轮）；失败时
   * 绝不销毁调用方的会话。
   * Reuse an existing session (the "pick the app, the session starts on send"
   * promotion path): skips session creation and lands the page instance on the
   * given session (the PAGE block is appended with wake=false, starting no extra
   * round); a failure never destroys the caller's session.
   */
  readonly reuseSessionId?: string
}

/** openUrl 的结果：打开一律新建，结果就是新会话 / openUrl result: the fresh session */
export interface OpenPageResult {
  readonly sessionId: string
  readonly url: string
  readonly title: string
  /**
   * 复用路径的 PAGE 块正文：调用方（首回合的 pre-step）把它注入本轮决策——块不能
   * 只落日志，否则当前这一轮看不到页面。新建路径为 undefined（块已落会话日志）。
   * The PAGE block body on the reuse path: the caller (the first turn's pre-step)
   * injects it into that step's decision — landing it in the log alone would keep
   * the current round from seeing the page. Undefined on the create path (the
   * block already landed in the session log).
   */
  readonly block?: string
}

/**
 * 预挂的页面工具面（"选中应用 ≠ 开始会话"的暂存态）：只渲染、只挂工具——
 * 不建页面实例、不写索引、不追加 PAGE 块。首条消息正式提升时 `openUrl` 走复用
 * 路径，用同一套定义重挂（收集逻辑见 {@link collectMountedTools}），因此模型
 * 第一步看到的工具面就是最终形态，不会在第二步才收到"工具已更新"。
 * The pre-mounted page tool face (the "picking an app is not a session start"
 * staged state): render + mount tools only — no page instance, no index row, no
 * PAGE block. The first message's promotion re-mounts the very same definitions
 * through openUrl's reuse path (both share {@link collectMountedTools}), so the
 * model sees the final tool face on step 1 instead of a "tools updated" swap on
 * step 2.
 */
export interface PagePreview {
  /** 规范 URL / the canonical url */
  readonly url: string
  /** 实例标题（正式提升时落 session/title）/ the instance title (landed at promotion) */
  readonly title: string
  /** 已挂进会话的工具面 / the tool face mounted on the session */
  readonly tools: readonly MountedTool[]
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

/**
 * 一次收集页面工具面：组件体 `ctx.page.tool` 登记的 defineTool 产物，改外名后
 * 成表（设计律：工具只在页面存在——页面登记面就是页面的全部工具面）。
 * **预览与正式挂载共用这一处**：两条路径产出的定义逐字相同，模型侧的请求头
 * 因此不会在提升时变化。
 * Collect the page tool face in one place: the defineTool products the
 * component body recorded via `ctx.page.tool`, renamed (design law: a tool
 * exists only inside a page — the page's recorded face IS its whole tool
 * face). Preview and real mount share this single implementation, so both
 * produce byte-identical definitions and the model's request header never
 * changes at promotion.
 * @param app - 页面所属应用 / the owning app
 * @param view - 已渲染的组件视图（可为空）/ the rendered component view (may be absent)
 * @returns 改外名后的挂载清单 / the renamed mount list
 */
function collectMountedTools(
  app: AppRecord,
  view: PageSession<never> | undefined,
): MountedTool[] {
  const dynamicTools = componentViewOf(view)?.takeRecordedTools() ?? []
  return dynamicTools.map((definition) => ({ ...definition, name: externalToolName(app.toolPrefix, definition.name) }))
}

/** 组件页视图的扩展面（prompt-page/component.tsx 的每会话视图）/ the component-page view's extension face (prompt-page/component.tsx) */
interface ComponentPageView extends PageSession<never> {
  takeRecordedTools(): ToolDefinition[]
}

/** 组件页视图守卫：有 takeRecordedTools 即组件页视图 / a component-page view guard: takeRecordedTools marks one */
function componentViewOf(view: PageSession<never> | undefined): ComponentPageView | undefined {
  if (view === undefined) return undefined
  return typeof (view as { takeRecordedTools?: unknown }).takeRecordedTools === 'function'
    ? (view as ComponentPageView)
    : undefined
}

/**
 * 组件页 PAGE 块（RFC prompt-page-render §3.3/C7 的骨架）：PAGE 定位行 + map
 * （注册表推导：本应用兄弟页、排除自身、按注册序，`- 模板 → description`）+
 * tools 行（目录解析 + 会话内动态注册，改外名）+ 应用说明行 + 可选页面说明行 +
 * Markdown 正文。
 * 无 params/data JSON 行——URL 本身表达 params，meta.load 经 useSnapshot 进组件、
 * 由组件渲染为正文（失败态也是正文）。
 * The component-page PAGE block (the §3.3/C7 skeleton of RFC prompt-page-render):
 * the PAGE locator line + map (registry-derived: sibling pages of this app,
 * excluding self, in registration order, `- template → description`) + the tools
 * line (catalog resolution + in-session dynamic registration, renamed) + the
 * app-level note + an optional page note + the Markdown body. No params/data
 * JSON lines — params ride the URL itself, and meta.load reaches the component
 * via useSnapshot to be rendered into the body (failure states included).
 */
export function componentPageBlock(
  app: AppRecord,
  match: PageMatch<never>,
  canonicalUrl: string,
  tools: readonly MountedTool[],
  body: string,
): string {
  const selfKey = pageKeyOf(app, match.page.name)
  const lines = [`PAGE ${selfKey} ${canonicalUrl}`]
  // 自排除按本地名（registerAppPage 会把 page.name 改写为 pageKey，取末段对齐投影键）
  // / self-exclusion by local name (registerAppPage renames page.name to the pageKey; align via the last segment)
  const selfLocal = match.page.name.includes('/') ? (match.page.name.split('/').pop() ?? match.page.name) : match.page.name
  const siblings = [...(app.pages ?? new Map()).entries()].filter(([name]) => name !== selfLocal)
  if (siblings.length > 0) {
    lines.push(MAP_HEADER)
    for (const [, page] of siblings) lines.push(`- ${page.url} → ${page.description}`)
  }
  lines.push(tools.length === 0
    ? 'tools: （无）'
    : `tools: ${tools.map((tool) => `${tool.name}（${toolUsagePhrase(tool.description)}）`).join('、')}`)
  // 应用级说明：整个应用共享的定位与行为约定，放在页面说明之前——先读
  // "这个应用是谁"，再读"这一页怎么用"。在此渲染它，是应用指令进 PAGE 块的落地。
  // The app-level note: the whole application's positioning and behavior
  // contract, placed before the page note — read "what this app is" first, then
  // "how to use this page". Rendering it here is where app instructions first
  // reach the PAGE block.
  if (app.definition.instructions !== undefined) lines.push(`应用说明：${app.definition.instructions}`)
  if (match.page.instructions !== undefined) lines.push(`说明：${match.page.instructions}`)
  lines.push(body)
  return lines.join('\n')
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

/**
 * 把 load 结果下发进组件（含失败态）：组件渲染为正文，绝不静默空白。
 * 只有声明了 load 的页面才有"下发"语义——store 页的快照源是权威 store，
 * 无 load 时 firstScreenData 产出 null，原样下发会把组件首帧正确的快照
 * 清空并重渲，首屏正文随之丢失（模型读不到数据）。
 * Push the load result into the component (failures included): rendered into
 * the body, never a silent blank. Only pages that declare load carry the push
 * semantics — a store page's snapshot source is its authoritative store; with
 * no load, firstScreenData yields null, and pushing it would wipe the
 * component's correct first frame and lose the first-screen body.
 */
function pushFirstScreen(match: PageMatch<never>, view: PageSession<never> | undefined, data: PageJsonValue): void {
  if (match.page.load === undefined) return
  snapshotSinkOf(view)?.setSnapshot(data)
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
  const sessionId = options.reuseSessionId ?? ports.sessions.mintId()
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
  const reusing = options.reuseSessionId !== undefined
  let tools: MountedTool[] = []
  let view: PageSession<never> | undefined
  // PAGE 块正文：复用路径要在返回值里交给首回合的 pre-step（见 OpenPageResult.block）
  // / the PAGE block body: the reuse path hands it to the first turn's pre-step
  let block = ''
  if (!reusing) {
    try {
      await ports.sessions.create(sessionId, title)
    } catch (error: unknown) {
      await ports.sessions.releaseTools(sessionId).catch(() => undefined)
      await ports.sessions.destroy(sessionId).catch(() => undefined)
      await index.fail(key, error instanceof Error ? error.message : String(error)).catch(() => undefined)
      throw wrap(error, PageErrorCode.SessionCreateFailed, `session create failed for ${key}`)
    }
  }
  try {
    // 首屏数据（§3.10.3）在写 PAGE 块前取齐：两阶段 commit 允许先落 reserved，
    // load 完成（或失败态定形）才翻 live——首屏数据建会话时就进上下文。组件页
    // 的 load 适配器把快照交给 live.mount 的 useSnapshot（含失败态）。
    // The first-screen data (§3.10.3) settles before the PAGE block: the
    // two-phase commit keeps the row reserved until load resolves (or its
    // error state forms) — the first screen enters the context at creation.
    // A component page's load adapter hands the snapshot to live.mount's
    // useSnapshot (failure states included).
    const env: PageLoadEnv = ports.presetOf === undefined ? {} : { preset: ports.presetOf(sessionId) }
    const data = await firstScreenData(match.page, params, env)
    // 实时视图提前建（组件页在视图里完成首帧渲染、ctx.effect/ctx.on 运行与
    // ctx.tools.register 记录——都在写 PAGE 块之前，正文与工具行由此有据）。
    // The live view is built early (a component page does its first-frame
    // render, ctx.effect/ctx.on runs and ctx.tools.register recording inside the
    // view — all before the PAGE block, so the body and the tools line have
    // their facts).
    // 页面组件的 effect/on 挂到该会话的 agent 作用域（事件按 agent 过滤）；
    // agent 未创建（暂存预览）时为 undefined，视图回退到创建者 ctx。
    // The page's effect/on register on that session's agent scope (agent-filtered
    // events); undefined when no agent exists yet (staged preview) — the view
    // then falls back to the creator ctx.
    // live 绑定必填（页面 = 组件页）：视图一定挂得出，"无视图的静态页"形态不存在。
    // The live binding is required (a page IS a component page): the view always
    // mounts; a "viewless static page" shape does not exist.
    view = match.live.mount(params, ports.sessions.scopeOf?.(sessionId))
    // load 结果下发进组件（仅 load 页；store 页保持首帧的 store 快照）：
    // / push the load result into the component (load pages only; a store page keeps its first-frame store snapshot):
    pushFirstScreen(match, view, data)
    // 工具：目录 + 组件动态注册，一次收集——与预览路径同一实现，定义逐字相同。
    // / tools: catalog + dynamic registrations collected once — the same
    // implementation as the preview path, byte-identical definitions.
    tools = collectMountedTools(app, view)
    // §3.10.5 规则 3（工具半边，挂载期 fail loud）：带 :param 且声明写意图的
    // 详情页，真实登记面为零 = 页面开着、活干不了——注册期看不到组件体的
    // ctx.page.tool，只有这里才有资格拒绝。
    // §3.10.5 rule 3 (the tool half, fail loud at mount): a parameterized page
    // that declared write intent with an empty really-recorded face is a page
    // that is open yet cannot do its job — registration never sees the body's
    // ctx.page.tool, so only here may it be refused.
    if (patternParamsOf(match.page.url).length > 0 && match.page.writes === true && tools.length === 0) {
      throw new PageError(PageErrorCode.DetailInvalid,
        `detail page "${match.page.name}" (${match.page.url}) recorded no tools; its write duty cannot be fulfilled`)
    }
    // §3.9 完备性告警在挂载期判（判据 = 真实收集面，含组件体的动态登记）：
    // 注册期看不到 ctx.page.tool 的记录，"声明要写却没挂工具"只有这里才有
    // 资格下结论。
    // The §3.9 coverage warning is judged at mount (the verdict input is the
    // really-collected face, dynamic records included): registration time never
    // sees the ctx.page.tool records, so only here may "declares writes but
    // mounts none" be concluded.
    const warning = pageToolWarning(match.page, tools.length)
    if (warning !== undefined) ports.warn?.(`${warning} (app "${app.definition.id}", url "${key}")`)
    // 页面级 skills 与工具同路：同一端口、同一组注销器（agent 作用域）。
    // Page-scope skills ride the same path as the tools: one port, one disposer
    // group (the agent scope).
    await ports.sessions.mountTools(sessionId, tools, match.page.skills)
    // PAGE 块：头行（map 注册表推导）+ Markdown 正文——所有页面都是组件页，
    // 正文来自视图的 Markdown 文档宿主（结构性校验，非组件宿主即空正文兜底）。
    // The PAGE block: the header (registry-derived map) + the Markdown body —
    // every page is a component page, and the body comes from the view's
    // Markdown doc host (structural guard; a non-component host degrades to an
    // empty body).
    const markdownView = isMarkdownDocHost(view!.host) ? view!.host : undefined
    block = componentPageBlock(app, match, key, tools, markdownView !== undefined ? markdownView.bodyText() : '')
    // PAGE 块覆盖到的版本：块正文取自这一版视图，绑定从它之后开始投递——块里已有
    // 的快照/首帧内容不会被当成 PAGE-PATCH 再发一遍（提前挂载的预览监听器因此
    // 也没有重复可发）。
    // The version covered by the PAGE block: the block body is this view's body,
    // so delivery starts after it — snapshot/first-frame content already in the
    // block is never re-sent as a PAGE-PATCH (and a preview listener mounted
    // earlier finds nothing to duplicate).
    const blockVersion = markdownView?.currentVersion
    // 复用路径（提升）：调用方正在首回合里，块由它注入本轮决策（wake 语义不适用，
    // 也不落日志——见 OpenPageResult.block 的说明）。
    // Reuse path (promotion): the caller is inside the first turn and injects the
    // block into that step's decision (wake does not apply, and the block is not
    // appended — see OpenPageResult.block).
    if (!reusing) await ports.sessions.appendUserMessage(sessionId, block, 'app/page')
    // 实时视图在 commit 前绑定（§3.10.3）：挂载失败走下方既有回滚（fail loud），
    // 不产生"会话活着但视图死着"的半状态；commit 后该视图归端口所有。
    // The live view binds before commit (§3.10.3): a mount failure rides the
    // existing rollback below (fail loud), so a live session never pairs with
    // a dead view; after commit the port owns the view.
    if (view !== undefined && ports.pageData !== undefined) {
      ports.pageData.bind(sessionId, view, {
        pageKey: pageKeyOf(app, match.page.name),
        url: key,
      }, blockVersion)
    }
    await index.commit(key, sessionId)
  } catch (error: unknown) {
    // 兜底：半成品视图退订 → 摘工具 → 销毁半成品会话 → 删 reserved 行；原始错误码优先透出
    // 复用路径不销毁会话：那是用户的会话，会话本身无辜。
    // Rollback: unsubscribe the half-built view → strip tools → destroy the
    // half-built session → delete the reserved row; the original code wins.
    // The reuse path never destroys the session — it is the user's session and
    // is not at fault.
    view?.unsubscribe()
    await ports.sessions.releaseTools(sessionId).catch(() => undefined)
    if (!reusing) await ports.sessions.destroy(sessionId).catch(() => undefined)
    await index.fail(key, error instanceof Error ? error.message : String(error)).catch(() => undefined)
    // 已绑定的实时视图随半成品一起摘除（幂等；bind 在 commit 前可能已发生）
    // / a bound live view dies with the half-built session (idempotent)
    ports.pageData?.unbind(sessionId)
    throw error
  }
  if (options.taskId !== undefined) await takeTask(ports, options.taskId, sessionId, options.actor)
  // 新会话启动即注入收件箱通知（§5.2 inbox）；失败只降级。复用路径跳过：用户的
  // 首条消息不该被收件箱块挤到后面。
  // A new session gets the inbox pumped at start (§5.2); failures degrade. The
  // reuse path skips it: the user's first message must not be pushed behind
  // inbox blocks.
  if (!reusing) await pumpDeliveries(ports, sessionId)
  if (options.focus !== false) await ports.sessions.focus(sessionId)
  return { sessionId, url: key, title, ...(reusing ? { block } : {}) }
}

/**
 * 预挂一个页面的工具面（"选中应用 ≠ 开始会话"）：解析 URL → 首屏 load → 渲染
 * 一次性视图收集工具 → **挂到给定会话** → 退订视图。不 reserve/commit 索引、
 * 不建会话、不追加 PAGE 块、不 focus——用户还没发送时什么都不该"开始"。
 * 正式提升走 createPageSession 的复用路径，collectMountedTools 产出同一套定义，
 * 模型第一步的请求头因此与第二步一致（无"工具已更新"、无缓存断点）。
 * Pre-mount a page's tool face (picking an app is not a session start): resolve
 * the url → first-screen load → render a one-shot view to collect the tools →
 * **mount them on the given session** → unsubscribe the view. No index
 * reserve/commit, no session creation, no PAGE block, no focus — nothing may
 * "start" before the user sends. The real promotion goes through
 * createPageSession's reuse path, and collectMountedTools yields the very same
 * definitions, so the model's step-1 header equals step 2 (no "tools updated",
 * no cache break).
 * @param registry - 页面注册表 / the page registry
 * @param ports - 运行时端口 / the runtime ports
 * @param sessionId - 预挂的会话（用户的普通会话）/ the session to pre-mount on
 * @param url - 页面 URL / the page url
 * @returns 预挂的 URL、标题与工具面 / the pre-mounted url, title, and tool face
 */
export async function mountPreviewTools(
  registry: { resolve(url: string): PageMatch<never> | null },
  ports: PageRuntimePorts,
  sessionId: string,
  url: string,
): Promise<PagePreview> {
  const { key, app, match } = resolvePageTarget(registry, ports, url)
  const params = { ...match.params }
  assertParamsMatchPattern(match.page.url, params)
  const env: PageLoadEnv = ports.presetOf === undefined ? {} : { preset: ports.presetOf(sessionId) }
  const data = await firstScreenData(match.page, params, env)
  // live 绑定必填（页面 = 组件页）：预挂视图一定挂得出。
  // The live binding is required (a page IS a component page): the preview view always mounts.
  const view = match.live.mount(params, ports.sessions.scopeOf?.(sessionId))
  let tools: MountedTool[]
  try {
    // 与 createPageSession 同口径：仅 load 页下发；store 页保持首帧快照。
    // / same rule as createPageSession: push for load pages only; a store page keeps its first-frame snapshot.
    pushFirstScreen(match, view, data)
    tools = collectMountedTools(app, view)
  } finally {
    // 预览视图只服务工具收集：首帧/快照渲染完即退订，订阅与 effect 全部释放。
    // / the preview view only exists to collect tools: after the first frame and
    // snapshot it unsubscribes, releasing subscriptions and effects.
    view?.unsubscribe()
  }
  // 工具与页面级 skills 挂进该会话的 agent 作用域（agent 未激活时由端口排队到
  // agent/created）。真实端口同时应用 app_* 屏蔽：预挂后第一步就不再暴露引导工具。
  // Mount the tools and page-scope skills onto the session's agent scope (the
  // port queues until agent/created if needed). The real port also applies the
  // app_* deny: step 1 no longer offers the bootstrap tools.
  await ports.sessions.mountTools(sessionId, tools, match.page.skills)
  return { url: key, title: instanceTitleOf(match, params), tools }
}

/** 把非 PageError 的底层失败包成带稳定 code 的 PageError */
function wrap(error: unknown, code: PageErrorCode, prefix: string): unknown {
  if (error instanceof PageError) return error
  return new PageError(code, `${prefix}: ${error instanceof Error ? error.message : String(error)}`)
}
