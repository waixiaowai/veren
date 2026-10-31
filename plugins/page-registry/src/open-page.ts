/**
 * 页面打开流程：解析 URL →（幂等守卫）→ 废弃旧会话 → 两阶段建新会话 →
 * 一次性渲染 + PAGE 块 → 任务接取 → 收件箱投递 → focus。
 * 打开一个 URL 一律新建一条会话，旧会话废弃（§3.5.3、§9.1）。
 * The page-open flow: resolve the url → (idempotence guard) → deprecate the
 * previous session → two-phase create → one-shot render + PAGE block → task
 * take → inbox pump → focus. Opening a url ALWAYS creates a fresh session and
 * deprecates the previous one (§3.5.3, §9.1).
 *
 * 不变量：
 * - 同一 URL 连开两次得到两条会话，索引指向后一条，前一条被标废弃（agent 退役、
 *   租约释放），但仍可读、不再追加 PAGE 块；
 * - **一个会话恰好一次渲染**：组件体在建会话激活 agent 之后、写 PAGE 块之前
 *   执行恰好一次——工具由组件体直接登记，PAGE 块的 tools 行取挂载前后工具面的
 *   差集（单一事实源 = 真实登记面）；
 * - 废弃释放顺序（§3.5.3）：退役 agent → 释放任务租约 → 写废弃标记（索引腾出
 *   URL）→ 建新会话；任何一步失败都收敛（废弃标记写失败 = 旧会话仍是活会话，
 *   下次打开重试；建新会话失败 = 销毁半成品 + reserved 行删除，URL 下次重试）；
 * - 任务租约随废弃释放，否则新会话会 `already-taken`，任务被废弃会话占死。
 * Invariants:
 * - Two opens of one url yield two sessions; the index points at the second,
 *   the first is deprecated (agent retired, leases released) but stays
 *   readable and never receives another PAGE block;
 * - **exactly one render per session**: the body runs once, after the agent
 *   activates and before the PAGE block — tools register via the body, and the
 *   block's tools line is the snapshot delta (single fact source = the real
 *   registration face);
 * - deprecation release order (§3.5.3): retire agent → release leases → write
 *   the marker (freeing the url) → create the new session; every failure
 *   converges (marker failure = the old session stays live and the next open
 *   retries; create failure = the half-built session is destroyed and the
 *   reserved row dropped, the url retries);
 * - task leases release with deprecation, or the new session hits
 *   `already-taken` and the task stays squatted by the deprecated session.
 *
 * @module @veren/page-registry/open-page
 */
import { PageError, PageErrorCode, assertParamsMatchPattern, pageToolWarning, patternParamsOf } from '@veren/prompt-page'
import type { PageInstanceIndex, PageInstanceKey, PageMatch, PageParams } from '@veren/prompt-page'
import type { AppRecord } from '@veren/app-registry'
import type { TaskId } from '@veren/task-center'
import { appIdOf, resolvePageTarget } from './resolve-target.ts'
import { collectPageTools, componentPageBlock, instanceTitleOf, pageKeyOf, taskBlock } from './page-block.ts'
import type { OpenPageOptions, OpenPageResult, PageRuntimePorts, PageToolEntry } from './runtime-ports.ts'

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
  const own = options.callerSessionId === undefined ? undefined : await index.lookup(key)
  // 自我打开守卫(幂等返回):调用方已持有该 URL 的 live 行时,"另起新会话"会
  // 废弃调用方自己——页面会话经 app_open 打开自己的页面等于自杀。这里原样
  // 返回当前会话,不废弃、不新建;需要 fresh 会话的调用方显式放弃 caller 身份。
  // Self-open guard (idempotent return): when the caller already owns the url's
  // live row, "always fresh" would deprecate the caller itself — a page session
  // opening its own page via app_open is suicide. Return the current session
  // as-is; a caller that truly wants a fresh session must forgo its identity.
  if (own !== undefined && own.state === 'live' && own.sessionId === options.callerSessionId) {
    // 自我打开也兑现 taskId(在自己的页面上接任务依旧合法)/ a self-open still honors taskId (taking a task on your own page is legitimate)
    if (options.taskId !== undefined) await takeTask(ports, options.taskId, own.sessionId, options.actor)
    return { sessionId: own.sessionId, url: key, title: own.instanceTitle }
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
export async function deprecatePrevious(index: PageInstanceIndex, ports: PageRuntimePorts, key: PageInstanceKey): Promise<void> {
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
    await pumpOne(ports, deliveries, sessionId, notice)
  }
}

/** 投一条通知并回报结果；追加失败保持 pending 并带原因 / pump one notice and report; append failure keeps it pending with the reason */
async function pumpOne(
  ports: PageRuntimePorts,
  deliveries: NonNullable<PageRuntimePorts['deliveries']>,
  sessionId: string,
  notice: { deliveryId: string; text: string },
): Promise<void> {
  try {
    await ports.sessions.appendUserMessage(sessionId, notice.text, 'task-center/notice')
    await deliveries.mark(notice.deliveryId)
  } catch (error: unknown) {
    await deliveries.mark(notice.deliveryId, error instanceof Error ? error.message : String(error)).catch(() => undefined)
  }
}

/**
 * 两阶段创建；每一步失败都清理半成品 + 删 reserved 行。`focus: false` 用于
 *  投递路径（§3.9）：建会话但不把 GUI 切过去——投递不是导航。
 * Two-phase create; every failed step cleans the half-built session and drops
 * the reserved row. `focus: false` serves the delivery path (§3.9): the session
 * is created but the GUI never switches — delivery is not navigation.
 */
export async function createPageSession(
  index: PageInstanceIndex,
  ports: PageRuntimePorts,
  key: PageInstanceKey,
  app: AppRecord,
  match: PageMatch<never>,
  options: OpenPageOptions,
): Promise<OpenPageResult> {
  const params: PageParams = { ...match.params }
  // §3.10.5 规则 5（挂载期）：params 必须覆盖 URL 模式的每个 :param，写 PAGE 块前 fail loud。
  // §3.10.5 rule 5 (mount time): params must cover every :param of the pattern, failing loud before the PAGE block.
  assertParamsMatchPattern(match.page.url, params)
  const sessionId = ports.sessions.mintId()
  await reserveRow(index, key, app, match, params, sessionId)
  const title = instanceTitleOf(match, params)
  await createSessionOrRollback(index, ports, key, sessionId, title)
  await renderAndCommit(index, ports, key, app, match, params, sessionId)
  if (options.taskId !== undefined) await takeTask(ports, options.taskId, sessionId, options.actor)
  // 新会话启动即注入收件箱通知（§5.2 inbox）；失败只降级。
  // A new session gets the inbox pumped at start (§5.2); failures degrade.
  await pumpDeliveries(ports, sessionId)
  if (options.focus !== false) await ports.sessions.focus(sessionId)
  return { sessionId, url: key, title }
}

/** 落 reserved 行（快照带 pageKey/标题/参数）；失败包成 IndexUnavailable / reserve the row (pageKey/title/params snapshot); wrap failures as IndexUnavailable */
async function reserveRow(
  index: PageInstanceIndex,
  key: PageInstanceKey,
  app: AppRecord,
  match: PageMatch<never>,
  params: PageParams,
  sessionId: string,
): Promise<void> {
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
}

/** 建会话；失败销毁半成品 + 删 reserved 行，错误包成 SessionCreateFailed / create the session; on failure destroy the half-build, drop the row, wrap as SessionCreateFailed */
async function createSessionOrRollback(
  index: PageInstanceIndex,
  ports: PageRuntimePorts,
  key: PageInstanceKey,
  sessionId: string,
  title: string,
): Promise<void> {
  try {
    await ports.sessions.create(sessionId, title)
  } catch (error: unknown) {
    await ports.sessions.destroy(sessionId).catch(() => undefined)
    await index.fail(key, error instanceof Error ? error.message : String(error)).catch(() => undefined)
    throw wrap(error, PageErrorCode.SessionCreateFailed, `session create failed for ${key}`)
  }
}

/** 渲染并落 PAGE 块 + commit；失败销毁半成品 + 删 reserved 行，原始错误码优先 / render, append the PAGE block and commit; on failure roll back with the original code */
async function renderAndCommit(
  index: PageInstanceIndex,
  ports: PageRuntimePorts,
  key: PageInstanceKey,
  app: AppRecord,
  match: PageMatch<never>,
  params: PageParams,
  sessionId: string,
): Promise<void> {
  try {
    const { pageTools, body } = renderOnce(ports, match, params, sessionId)
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
}

/** 一次渲染的事实收集：agent 在席校验 + 工具差集 + 规则 3 的工具半边（均 fail loud）/ gather the one render's facts: agent presence, the tool delta, rule 3's tool half */
function renderOnce(
  ports: PageRuntimePorts,
  match: PageMatch<never>,
  params: PageParams,
  sessionId: string,
): { pageTools: PageToolEntry[]; body: string } {
  // 唯一一次渲染的载体：页面会话的真实 Agent。缺席 = 装配错误，fail loud
  // （一次性渲染没有"等 agent"的回退形态）。
  // The carrier of the only render: the page session's real Agent. A miss is
  // an assembly error and fails loud (no "wait for the agent" fallback).
  const agent = ports.sessions.agentOf(sessionId)
  if (agent === undefined) {
    throw new PageError(PageErrorCode.HostUnavailable, `page session ${sessionId} has no active agent; the one-shot render cannot run`)
  }
  // 工具差集的两端：渲染前后各一次真实工具面快照（deny 屏蔽已在 create 内
  // 生效，两次快照都不含引导工具）。
  // Both ends of the tool delta: a real tool-face snapshot before and after
  // the render (the deny masking took effect inside create).
  const before = ports.sessions.toolFace(sessionId)
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
  return { pageTools, body }
}

/** 把非 PageError 的底层失败包成带稳定 code 的 PageError / wrap a non-PageError failure into a coded PageError */
function wrap(error: unknown, code: PageErrorCode, prefix: string): unknown {
  if (error instanceof PageError) return error
  return new PageError(code, `${prefix}: ${error instanceof Error ? error.message : String(error)}`)
}
