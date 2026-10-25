/**
 * 页面运行时：打开一个 URL 一律新建一条会话，旧会话废弃（§3.5.3、§9.1）。
 * Page runtime: opening a url ALWAYS creates a fresh session and deprecates
 * the previous one (§3.5.3, §9.1).
 *
 * 简化后的不变量：
 * - 打开 URL 不再复用：同一 URL 连开两次得到两条会话，索引指向后一条，
 *   前一条被标废弃（agent 退役、租约释放），但仍可读、不再追加 PAGE 块；
 * - **一个会话恰好一次渲染**：组件体在建会话激活 agent 之后、写 PAGE 块之前
 *   执行恰好一次——工具由组件体直接 `agent.ctx.tools.register` 登记，PAGE 块的
 *   tools 行取挂载前后工具面的**差集**（单一事实源 = 真实登记面）；首屏
 *   读取同样由组件体经 agent.ctx.effect 自己发起，读到的事实经 followup
 *   以新消息进上下文——宿主不经手任何取数，此后页面不再渲染；
 * - 废弃释放顺序（§3.5.3）：退役 agent（页面登记的一切随 fiber 逆序拆除）→
 *   释放任务租约 → 写废弃标记（索引腾出 URL）→ 建新会话（create →
 *   一次渲染 → 写 PAGE → commit）；任何一步失败都收敛：废弃标记写失败 = 旧
 *   会话仍是索引里的活会话（下次打开重试）；建新会话失败 = 销毁半成品（agent
 *   一并销毁，工具随之消失）+ reserved 行删除，URL 下次打开重试；
 * - 任务租约随废弃释放：旧会话持有的 `taken` 租约由 tasks 面 release，
 *   否则新会话会 `already-taken`，任务被废弃会话占死。
 *
 * 宿主对接走注入端口（sessions/apps/tasks/deliveries/releaseLeases/warn）：
 * 端口全部由装配层（app-host）经 bindPorts **纯参数**传入（G13 规则 2），本包
 * 不触碰任何 ctx、不探测兄弟服务；apps 是必填端口（没有它页面打不开），
 * tasks/deliveries/releaseLeases 是可选能力端口（缺席时按各自语义降级）。本包
 * 只依赖各服务包的类型出口，不依赖其运行时。
 * Host access goes through injected ports passed as pure parameters by the
 * host assembly (app-host); nothing here touches a Context or probes siblings.
 *
 * @module @veren/page-registry/runtime
 */
import { PageError, PageErrorCode, assertParamsMatchPattern, canonicalizePageUrl, pageToolWarning, patternParamsOf } from '@veren/prompt-page'
import type { PageInstanceIndex, PageInstanceKey, PageMatch } from '@veren/prompt-page'
import type { Agent } from '@deepseek-ai/dsh-agent'
// 服务面类型只引真正的那一份：应用记录/任务契约来自各自的 declaration merging 出口，
// 本包不再手写影子副本（同一事实只有一份类型声明）。
// Service-surface types are imported, never shadowed: the app record and the task
// contract come from the owning packages' public entries.
import type { AppRecord } from '@veren/app-registry'
import type { TaskCenterContract, TaskId, TaskRecord } from '@veren/task-center'
import type { AppRegistryService } from '@veren/app-registry'
import type { TaskCenterService } from '@veren/task-center'

/**
 * 工具面条目（PAGE 块 tools 行的来源）：名字 + 用途描述，取自该 agent 作用域
 * 真实可见的工具。页面工具 = 挂载前后两次快照的差集——组件体直接登记，挂载方
 * 不经手定义，因此不存在"声明与事实两张皮"。
 * A tool-face entry (the source of the PAGE block's tools line): name + usage
 * description, read from what the agent's scope really sees. The page's tools
 * are the DELTA of two snapshots around the one render — the body registers
 * directly and the mounter never handles definitions, so declaration and fact
 * cannot drift apart.
 */
export interface PageToolEntry {
  readonly name: string
  readonly description: string
}

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

/**
 * 会话端口：运行时对 DSH 会话机制的全部假设收在这一个面上。
 * The session port: every assumption about DSH sessions narrows to this face.
 */
export interface PageSessionPort {
  exists(sessionId: string): boolean
  mintId(): string
  /**
   * 建会话并**当场激活 agent**（H 修复：不激活的页面会话永远不可见）。页面
   * 作用域屏蔽（app_open/app_list/app_pages 的 deny）属于"这个会话是页面会话"
   * 的事实，在此一并应用——组件体渲染时屏蔽已生效。
   * Create the session and **activate its agent right away** (the H fix: an
   * agent-less page session is never visible). The page-scope masking (the
   * app_open/app_list/app_pages deny) is a fact of "this session is a page
   * session" and applies here — it is already in force when the body renders.
   */
  create(sessionId: string, title: string): Promise<void>
  /**
   * 该会话的活 agent：页面组件体在它身上执行恰好一次。undefined = agent 未激活
   * ——一次性渲染没有"等 agent"的回退，缺了就是装配错误，fail loud。
   * The session's live agent: the page body runs on it exactly once. undefined
   * = the agent is not active — the one-shot render has no "wait for the agent"
   * fallback; a miss is an assembly error and fails loud.
   */
  agentOf(sessionId: string): Agent | undefined
  /**
   * 该 agent 作用域当前可见的工具面（名字 + 用途描述）。挂载前后各取一次，
   * 差集就是页面工具——PAGE 块的 tools 行与 §3.9 完备性检查都以此为准。
   * The tool face currently visible in the agent's scope (names + usage
   * descriptions). Snapshot before and after the render; the delta IS the
   * page's tools — both the PAGE block's tools line and the §3.9 completeness
   * check read it.
   */
  toolFace(sessionId: string): readonly PageToolEntry[]
  /**
   * 退役该会话的 agent（废弃路径）：页面登记的一切（工具/skills/订阅/清理）
   * 随 fiber 逆序拆除，会话日志保留可读。
   * Retire the session's agent (the deprecation path): everything the page
   * registered (tools/skills/subscriptions/cleanups) unwinds with the fiber in
   * reverse order; the session log stays readable.
   */
  retire(sessionId: string): Promise<void>
  /**
   * 追加一条消息。`options.wake === false` 时不唤醒 agent（消息只落会话日志，
   * 等该会话下一次被唤醒时一并消费）；缺省唤醒（§3.9 唤醒策略）。
   * Append one message. `wake === false` appends without waking the agent (the
   * message lands in the session log and is consumed on the next wake);
   * default wakes (§3.9 wake policy).
   */
  appendUserMessage(sessionId: string, text: string, source: string, options?: { readonly wake?: boolean }): Promise<void>
  focus(sessionId: string): Promise<void>
  /** 创建失败兜底：销毁半成品会话（agent 一并销毁，页面登记随其消失）/ destroy a half-built session (the agent dies with it) */
  destroy(sessionId: string): Promise<void>
}

/** 运行时端口集：apps 必填，任务相关为可选能力端口（全部是纯参数）
 * / the runtime's ports: apps required, task faces optional capabilities */
export interface PageRuntimePorts {
  readonly sessions: PageSessionPort
  /** 应用注册表真实面（AppRecord）：应用不在场时 openUrl 给 app/not-found / the real app-registry face */
  readonly apps: Pick<AppRegistryService, 'get'>
  /**
   * 挂载期完备性告警（§3.9）：真实登记面收集后判"声明要写却挂不出工具"——
   * 缺席 → 静默跳过。
   * The mount-time completeness warning (§3.9): judges "declares writes but
   * mounts none" after the real registration face is collected. Absent →
   * skipped silently.
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
}

/** openUrl 的可选参数；`focus: false` 用于投递路径（§3.9）：建会话但不切界面 */
export interface OpenPageOptions {
  /** 任务场景：先 take 再追加 TASK 块（§5.3）/ take the task, then append TASK */
  readonly taskId?: string
  readonly actor?: string
  /** 投递路径置 false：建会话但不发 GUI focus（投递不是导航，§3.9） */
  readonly focus?: boolean
  /**
   * 调用方会话:与目标 URL 的 live 行同会话时,打开退化为幂等返回——否则
   * "一律新建"会废弃调用方自己的 live 行(页面会话经 app_open 打开自己的
   * 页面 = 自杀;真机反例:重挂机制依赖的 live 行被调用方的自救动作废弃)。
   * The caller's session: when it already owns the target url's live row, the
   * open degrades to an idempotent return — otherwise "always fresh" would
   * deprecate the caller's own live row (a page session opening its own page
   * via app_open = suicide; live counter-example: the live row the remount
   * depends on got deprecated by the caller's self-rescue).
   */
  readonly callerSessionId?: string
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
function collectPageTools(before: readonly PageToolEntry[], after: readonly PageToolEntry[]): PageToolEntry[] {
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
  // 自我打开守卫(幂等返回):调用方已持有该 URL 的 live 行时,"另起新会话"会
  // 废弃调用方自己——页面会话经 app_open 打开自己的页面等于自杀。这里原样
  // 返回当前会话,不废弃、不新建;需要 fresh 会话的调用方显式放弃 caller 身份。
  // Self-open guard (idempotent return): when the caller already owns the url's
  // live row, "always fresh" would deprecate the caller itself — a page session
  // opening its own page via app_open is suicide. Return the current session
  // as-is; a caller that truly wants a fresh session must forgo its identity.
  if (options.callerSessionId !== undefined) {
    const own = await index.lookup(key)
    if (own !== undefined && own.state === 'live' && own.sessionId === options.callerSessionId) {
      // 自我打开也兑现 taskId(在自己的页面上接任务依旧合法)/ a self-open still honors taskId (taking a task on your own page is legitimate)
      if (options.taskId !== undefined) await takeTask(ports, options.taskId, own.sessionId, options.actor)
      return { sessionId: own.sessionId, url: key, title: own.instanceTitle }
    }
  }
  await deprecatePrevious(index, ports, key)
  return createPageSession(index, ports, key, app, match, options)
}

/**
 * 废弃同 URL 的旧会话（§3.5.3 释放顺序）：退役 agent（页面登记的一切随 fiber
 * 拆除）→ 释放任务租约 → 写废弃标记（索引腾出 URL）。单步失败不阻断：退役/
 * 租约失败只影响旧会话自身，废弃标记照写；废弃标记写失败则整步中止——旧会话
 * 仍是索引里的活会话，下次打开重试废弃，收敛为"恰好一条活会话"。
 * Deprecate the previous session on this url (§3.5.3 release order): retire the
 * agent (everything the page registered unwinds with the fiber) → release task
 * leases → write the deprecated marker (freeing the url). Retire/lease failures
 * never block: only the old session is affected, and the marker still moves it
 * out of the url. A marker write failure aborts the whole step — the old
 * session remains the index's live row, the next open retries the deprecation,
 * and the invariant "exactly one live session per url" holds.
 */
async function deprecatePrevious(index: PageInstanceIndex, ports: PageRuntimePorts, key: PageInstanceKey): Promise<void> {
  const previous = await index.lookup(key)
  if (previous === undefined) return
  await ports.sessions.retire(previous.sessionId).catch(() => undefined)
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
  try {
    await ports.sessions.create(sessionId, title)
  } catch (error: unknown) {
    await ports.sessions.destroy(sessionId).catch(() => undefined)
    await index.fail(key, error instanceof Error ? error.message : String(error)).catch(() => undefined)
    throw wrap(error, PageErrorCode.SessionCreateFailed, `session create failed for ${key}`)
  }
  try {
    // 唯一一次渲染的载体：页面会话的真实 Agent。缺席 = 装配错误，fail loud
    // （一次性渲染没有"等 agent"的回退形态）。首屏数据不在此取——那是组件体
    // 自己的 lifecycle（effect 发起、followup 送达），宿主不经手取数。
    // The carrier of the only render: the page session's real Agent. A miss is
    // an assembly error and fails loud (the one-shot render has no "wait for
    // the agent" fallback). First-screen data is NOT fetched here — that is the
    // body's own lifecycle (started by an effect, delivered by a followup); the
    // host touches no data fetching.
    const agent = ports.sessions.agentOf(sessionId)
    if (agent === undefined) {
      throw new PageError(PageErrorCode.HostUnavailable, `page session ${sessionId} has no active agent; the one-shot render cannot run`)
    }
    // 工具差集的两端：渲染前后各一次真实工具面快照（deny 屏蔽已在 create 内
    // 生效，两次快照都不含引导工具）。
    // Both ends of the tool delta: a real tool-face snapshot before and after
    // the render (the deny masking took effect inside create, so neither
    // snapshot contains the bootstrap tools).
    const before = ports.sessions.toolFace(sessionId)
    // 唯一一次渲染：组件体在真实 agent 上执行——工具/订阅/清理直接经 agent.ctx
    // 登记，产物即刻成型为正文 Markdown。
    // The only render: the body runs on the real agent — tools, subscriptions
    // and cleanups register via agent.ctx directly, and the output is finalized
    // into the body Markdown at once.
    const body = match.live.mount(params, agent)
    const pageTools = collectPageTools(before, ports.sessions.toolFace(sessionId))
    // §3.10.5 规则 3（工具半边，挂载期 fail loud）：带 :param 且声明写意图的
    // 详情页，真实登记差集为零 = 页面开着、活干不了——只有这里才有资格拒绝。
    // §3.10.5 rule 3 (the tool half, fail loud at mount): a parameterized page
    // that declared write intent with an empty really-registered delta is a
    // page that is open yet cannot do its job — only here may it be refused.
    if (patternParamsOf(match.page.url).length > 0 && match.page.writes === true && pageTools.length === 0) {
      throw new PageError(PageErrorCode.DetailInvalid,
        `detail page "${match.page.name}" (${match.page.url}) registered no tools; its write duty cannot be fulfilled`)
    }
    // §3.9 完备性告警在挂载期判（判据 = 真实登记差集）：只有这里才有资格下结论。
    // The §3.9 coverage warning is judged at mount (the verdict input is the
    // really-registered delta): only here may it be concluded.
    const warning = pageToolWarning(match.page, pageTools.length)
    if (warning !== undefined) ports.warn?.(`${warning} (app "${app.definition.id}", url "${key}")`)
    // PAGE 块：头行（map 注册表推导）+ tools 行（真实登记差集）+ Markdown 正文。
    // The PAGE block: the header (registry-derived map) + the tools line (the
    // real registration delta) + the Markdown body.
    const block = componentPageBlock(app, match, key, pageTools, body)
    await ports.sessions.appendUserMessage(sessionId, block, 'app/page')
    await index.commit(key, sessionId)
  } catch (error: unknown) {
    // 兜底：销毁半成品会话（agent 一并销毁，组件体登记的工具/订阅随 fiber 逆序
    // 拆除）→ 删 reserved 行；原始错误码优先透出。
    // Rollback: destroy the half-built session (the agent dies with it; the
    // body's registrations unwind with the fiber) → delete the reserved row;
    // the original code wins.
    await ports.sessions.destroy(sessionId).catch(() => undefined)
    await index.fail(key, error instanceof Error ? error.message : String(error)).catch(() => undefined)
    throw error
  }
  if (options.taskId !== undefined) await takeTask(ports, options.taskId, sessionId, options.actor)
  // 新会话启动即注入收件箱通知（§5.2 inbox）；失败只降级。
  // A new session gets the inbox pumped at start (§5.2); failures degrade.
  await pumpDeliveries(ports, sessionId)
  if (options.focus !== false) await ports.sessions.focus(sessionId)
  return { sessionId, url: key, title }
}

/** 把非 PageError 的底层失败包成带稳定 code 的 PageError */
function wrap(error: unknown, code: PageErrorCode, prefix: string): unknown {
  if (error instanceof PageError) return error
  return new PageError(code, `${prefix}: ${error instanceof Error ? error.message : String(error)}`)
}

/** 已完成一次性渲染的 agent（同进程内防重挂；跨进程靠新 agent 对象天然区分）*/
/** Agents whose one-shot render already ran (in-process remount guard; across processes the fresh agent object distinguishes naturally) */
const renderedAgents = new WeakSet<object>()

/**
 * 页面会话再激活重挂:老会话的 agent 在重启/失效后重新创建,而一次性渲染绑定在
 * 原始 fiber 上——新 agent 身上没有页面工具面,也没有本会话的 PAGE 块,模型只能
 * 靠通用工具 improvising(真机反例:一个回合约 40 万 token 的文件系统探查)。
 * 这里按 session 找到 live 行,解析页面定义,把唯一渲染 + PAGE 块重放到新 agent:
 * 工具/订阅/skill 随组件体重挂,首屏 effect 重发,fresh 事实经 followup 进上下文。
 * 同一 agent 只重挂一次(WeakSet);reserved 行(两阶段创建中)与非 live 行跳过,
 * 因此新会话的创建路径不会由此双重渲染。失败只降级(warn + false),绝不销毁
 * 已有会话——老会话的日志与索引行都是既成事实。
 *
 * Re-activation remount: when an old page session's agent is recreated after a
 * restart/invalidation, the one-shot render is still bound to the original
 * fiber — the new agent carries no page tool face and no PAGE block, and the
 * model can only improvise with generic tools (live counter-example: ~400K
 * tokens of filesystem probing in one turn). Given a session id, find the live
 * row, resolve the page definition, and replay the one-shot render + PAGE block
 * onto the new agent: tools/subscriptions/skills re-register with the body, the
 * first-screen effects re-fire, and fresh facts ride followup into the context.
 * Each agent remounts at most once (WeakSet); reserved rows (mid two-phase
 * create) and non-live rows are skipped, so the fresh-create path never
 * double-renders through this entry. Failures degrade (warn + false) and never
 * destroy the existing session — its log and index row are already facts.
 */
export async function rerenderLivePage(
  registry: { resolve(url: string): PageMatch<never> | null; catalog(): ReadonlyArray<{ url: string }> },
  index: PageInstanceIndex,
  ports: PageRuntimePorts,
  sessionId: string,
  agent: Agent,
): Promise<boolean> {
  const tag = agent as unknown as object
  if (renderedAgents.has(tag)) return false
  for (const entry of registry.catalog()) {
    const row = await index.lookup(entry.url as PageInstanceKey).catch(() => undefined)
    if (row === undefined || row.sessionId !== sessionId || row.state !== 'live') continue
    let resolved: { key: PageInstanceKey; app: AppRecord; match: PageMatch<never> }
    try {
      resolved = resolvePageTarget(registry, ports, row.url)
    } catch {
      continue
    }
    const { key, app, match } = resolved
    const params = { ...row.params }
    try {
      assertParamsMatchPattern(match.page.url, params)
    } catch {
      continue
    }
    const before = ports.sessions.toolFace(sessionId)
    const body = match.live.mount(params, agent)
    const pageTools = collectPageTools(before, ports.sessions.toolFace(sessionId))
    const warning = pageToolWarning(match.page, pageTools.length)
    if (warning !== undefined) ports.warn?.(`${warning} (app "${app.definition.id}", url "${key}", rerender)`)
    const block = componentPageBlock(app, match, key, pageTools, body)
    await ports.sessions.appendUserMessage(sessionId, block, 'app/page')
    renderedAgents.add(tag)
    return true
  }
  return false
}
