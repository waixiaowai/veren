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
import { PageError, PageErrorCode, canonicalizePageUrl } from '@veren/prompt-page'
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

/** 任务中心面（B 的 TaskCenterContract.take）/ minimal task-center face */
export interface TaskFace {
  take(id: string, claim: { sessionId: string; actor: string; leaseUntil: string }): Promise<unknown>
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

/** 挂进会话的工具：就是 DSH `ToolDefinition` 本体（见文件顶部 MountedTool 别名）/ a mounted tool IS the DSH definition */

/**
 * 会话端口：运行时对 DSH 会话机制的全部假设收在这一个面上。
 * The session port: every assumption about DSH sessions narrows to this face.
 */
export interface PageSessionPort {
  exists(sessionId: string): boolean
  mintId(): string
  create(sessionId: string, title: string): Promise<void>
  appendUserMessage(sessionId: string, text: string, source: string): Promise<void>
  /** 挂页面工具；重名冲突抛 PageError(page/tool-conflict) / mount; conflicts raise */
  mountTools(sessionId: string, tools: readonly MountedTool[]): Promise<void>
  releaseTools(sessionId: string): Promise<void>
  focus(sessionId: string): Promise<void>
  /** 创建失败兜底：销毁半成品会话 / destroy a half-built session */
  destroy(sessionId: string): Promise<void>
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
}

/** openUrl 的可选参数 / openUrl options */
export interface OpenPageOptions {
  /** 任务场景：先 take 再追加 TASK 块（§5.3）/ take the task, then append TASK */
  readonly taskId?: string
  readonly actor?: string
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

/** PAGE 块：页面实例的开场白，写一次不再重写（§3.4.2）/ the one PAGE block */
export function pageBlock(app: AppRecord, match: PageMatch<never>, params: Record<string, string>, tools: readonly MountedTool[]): string {
  const lines = [
    `PAGE ${match.page.name} ${JSON.stringify(params)}`,
    `本页工具：${tools.map((tool) => tool.name).join('、') || '（无）'}`,
  ]
  if (app.definition.instructions !== undefined) lines.push(`应用说明：${app.definition.instructions}`)
  if (match.page.instructions !== undefined) lines.push(`说明：${match.page.instructions}`)
  return lines.join('\n')
}

/** TASK 块：任务成功接取后追加一次（§5.4）/ the TASK block, appended once */
export function taskBlock(taskId: string, task: TaskRecord | undefined): string {
  const title = typeof task?.title === 'string' ? task.title : taskId
  return `TASK ${taskId} ${title}\n完成后用 task_complete 回报结果；做不下去用 task_fail 带稳定错误码回报。`
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

/** 两阶段创建；每一步失败都清理半成品 + 删 reserved 行 */
async function createPageSession(
  index: PageInstanceIndex,
  ports: PageRuntimePorts,
  key: PageInstanceKey,
  app: AppRecord,
  match: PageMatch<never>,
  options: OpenPageOptions,
): Promise<OpenPageResult> {
  const params = { ...match.params }
  const sessionId = ports.sessions.mintId()
  try {
    await index.reserve(key, sessionId, {
      appId: app.definition.id,
      // 应用页的 match.page.name 已是 pageKey（<appId>/<本地名>，见
      // registerAppPage）；裸名路径（raw register）保留旧的前缀拼接。
      // app pages already carry the pageKey as their name (registerAppPage);
      // the raw-register path keeps the legacy prefixing.
      page: match.page.name.includes('/') ? match.page.name : `${app.definition.id}/${match.page.name}`,
      instanceTitle: instanceTitleOf(match, params),
      pageRevision: match.page.pageRevision ?? 1,
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
    await ports.sessions.appendUserMessage(sessionId, pageBlock(app, match, params, tools), 'app/page')
    await index.commit(key, sessionId)
  } catch (error: unknown) {
    // 兜底：摘工具 → 销毁半成品会话 → 删 reserved 行；原始错误码优先透出
    await ports.sessions.releaseTools(sessionId).catch(() => undefined)
    await ports.sessions.destroy(sessionId).catch(() => undefined)
    await index.fail(key, error instanceof Error ? error.message : String(error)).catch(() => undefined)
    throw error
  }
  if (options.taskId !== undefined) await takeTask(ports, options.taskId, sessionId, options.actor)
  // 新会话启动即注入收件箱通知（§5.2 inbox）；失败只降级
  await pumpDeliveries(ports, sessionId)
  await ports.sessions.focus(sessionId)
  return { sessionId, url: key, title }
}

/** 把非 PageError 的底层失败包成带稳定 code 的 PageError */
function wrap(error: unknown, code: PageErrorCode, prefix: string): unknown {
  if (error instanceof PageError) return error
  return new PageError(code, `${prefix}: ${error instanceof Error ? error.message : String(error)}`)
}
