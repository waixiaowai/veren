/**
 * 页面运行时：一个 URL 一个页面实例、一条会话（§3.4、§3.5.3）。
 * Page runtime: one url = one page instance = one session (§3.4, §3.5.3).
 *
 * 简化后的不变量：
 * - 会话内永不换页；打开另一个 URL = 创建/复用另一条会话，当前会话零改动；
 * - 工具在会话创建时挂一次、随会话销毁释放；PAGE 块写一次、永不重写；
 * - 两阶段创建：reserve → 建会话/挂工具/写 PAGE → commit；任何一步失败都
 *   清理半成品并删 reserved 行，不留幽灵索引（§3.5.3）。
 *
 * 宿主对接走注入端口（sessions/apps/toolsOf/tasks）：apps/tasks 用真实服务面，
 * 缺失时给明确错误码降级；本包只依赖各服务包的类型出口，不依赖其运行时。
 * Host access goes through injected ports (sessions/apps/toolsOf/tasks); apps and
 * tasks reuse the real service faces, degrade with explicit codes when absent.
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
  /** 该会话当前是否还挂着页面工具（恢复路径判断要不要重挂）/ whether page tools are still mounted */
  hasTools?(sessionId: string): boolean
  focus(sessionId: string): Promise<void>
  /** 创建失败兜底：销毁半成品会话 / destroy a half-built session */
  destroy(sessionId: string): Promise<void>
}

/** 运行时端口集：apps/tasks 直接复用真实服务面（Pick 投影，不另声明）
 * / the runtime's injected ports; apps/tasks reuse the real service faces */
export interface PageRuntimePorts {
  readonly sessions: PageSessionPort
  /** 应用注册表真实面（AppRecord）：缺席则 openUrl 给 app/not-found / the real app-registry face */
  readonly apps?: Pick<AppRegistryService, 'get'>
  readonly toolsOf?: ToolsFace
  /** 任务中心真实契约的 take：缺席则任务场景给 page/host-unavailable / the real task contract */
  readonly tasks?: Pick<TaskCenterContract, 'take'>
  /** 任务通知投递面（§5.2 inbox 注入）；缺席则跳过投递 / delivery face; absent → skip pumping */
  readonly deliveries?: DeliveryFace
  /** 任务租约时长（分钟），缺省 30 / lease minutes, default 30 */
  readonly leaseMinutes?: number
}

/** openUrl 的可选参数 / openUrl options */
export interface OpenPageOptions {
  /** 任务场景：先 take 再追加 TASK 块（§5.3）/ take the task, then append TASK */
  readonly taskId?: string
  readonly actor?: string
}

/** openUrl 的结果 / openUrl result */
export interface OpenPageResult {
  readonly sessionId: string
  readonly url: string
  readonly created: boolean
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
  toolsOf: ToolsFace | undefined,
): MountedTool[] {
  const localNames = match.page.tools ?? []
  if (localNames.length === 0) return []
  if (toolsOf === undefined) {
    throw new PageError(PageErrorCode.UnknownTool, `app "${app.definition.id}" exposes no tool catalog, so page tools cannot mount`)
  }
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
 * 打开一个 URL：命中即恢复并聚焦，未命中走两阶段创建（§3.5.3）。
 * Open a url: hit → restore & focus; miss → two-phase create.
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
  const app = ports.apps?.get(appId as AppRecord['definition']['id'])
  if (ports.apps === undefined || app === undefined) {
    throw new PageError(PageErrorCode.AppNotFound, `app "${appId}" is not registered`)
  }
  if (app.state !== 'active') {
    throw new PageError(PageErrorCode.AppDisabled, `app "${appId}" is ${app.state}; enable it before opening pages`)
  }
  const match = registry.resolve(key)
  if (match === null) throw new PageError(PageErrorCode.PageNotFound, `no page matches ${key}`)

  const record = await index.lookup(key)
  if (record !== undefined) {
    // 恢复路径：契约版本不兼容不静默复用（§7.3）
    if (record.pageRevision !== (match.page.pageRevision ?? 1)) {
      throw new PageError(PageErrorCode.Stale, `page "${match.page.name}" moved to revision ${match.page.pageRevision ?? 1}; the existing session was created at ${record.pageRevision}`)
    }
    // 工具随会话恢复重挂（§3.4.5）：只在确实没挂时补挂，不重复注册
    // Remount on restore (§3.4.5): only when genuinely absent, never duplicated.
    if (ports.sessions.hasTools !== undefined && !ports.sessions.hasTools(record.sessionId)) {
      const tools = resolveMountedTools(app, match, ports.toolsOf)
      await ports.sessions.mountTools(record.sessionId, tools)
    }
    if (options.taskId !== undefined) await takeTask(ports, options.taskId, record.sessionId, options.actor)
    await pumpDeliveries(ports, record.sessionId)
    await ports.sessions.focus(record.sessionId)
    return { sessionId: record.sessionId, url: key, created: false, title: record.instanceTitle }
  }
  const created = await createPageSession(index, ports, key, app, match, options)
  return created
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
      page: `${app.definition.id}/${match.page.name}`,
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
  return { sessionId, url: key, created: true, title }
}

/** 把非 PageError 的底层失败包成带稳定 code 的 PageError */
function wrap(error: unknown, code: PageErrorCode, prefix: string): unknown {
  if (error instanceof PageError) return error
  return new PageError(code, `${prefix}: ${error instanceof Error ? error.message : String(error)}`)
}
