/**
 * 装配本体：三个服务的全部接缝在这里显式接上（G13 显式接线）。
 * The assembly body: every seam between the three services is wired here,
 * explicitly, in one place.
 *
 * - `taskCenter.setAppResolver` ← `apps.get`：发任务校验发送方、卸载懒孤儿判定；
 * - `apps.setPageMirror` ← `pageRegistry.registerAppPage/releaseApp`：页面单入口
 *   注册的镜像面（含卸载摘工具）+ 先于装配注册的页面回填镜像；
 * - `pageRegistry.bindPorts({...})` ← 全部端口**纯参数**传入（G13 规则 2）：
 *   真实会话端口 + apps/tasks/deliveries/releaseLeases 能力面。
 *   pageRegistry 不再自己摸兄弟服务（守卫按属主归因，摸了就炸）；
 * - 宿主工具 `app_list` / `app_pages` / `app_open` / `page_send` 由本装配
 *   `ctx.tools.register` 挂进真实工具表（第三轮真机验证补上的丢失步骤）。
 *
 * **全成或全回滚**：各步收在同一个 try 块里，任一步抛错即逆序撤销已执行的前序
 * 步骤再重抛（G13 规则 3）——系统要么处于"全部接上"，要么"什么也没接"。
 * All-or-nothing: the steps share one try block; any failure rolls the
 * earlier ones back in reverse before rethrowing — the system is either fully
 * wired or not wired at all, never half-wired.
 *
 * 装一个新应用 = 应用插件自己 `ctx.apps.register/pages/tools`，此外零接线。
 * @module @veren/app-host/wire
 */
import type { Context } from '@deepseek-ai/cordis'
// 类型-only import：只为拉取三个服务的 declaration merging（ctx.apps / ctx.pageRegistry / ctx.taskCenter）
// type-only import: pulls the declaration merges of the three services on Context
import type {} from '@veren/app-registry'
import type {} from '@veren/page-registry'
import type {} from '@veren/task-center'
// 类型-only import：ctx.tools 来自 dsh-tools 的 declaration merging（本文件 `ctx.tools.register` 用它）
// type-only import: ctx.tools comes from the dsh-tools declaration merge.
import type {} from '@deepseek-ai/dsh-tools'
import type { AppId } from '@veren/app-registry'
import type { PageRegistryService, PageRuntimePorts } from '@veren/page-registry'
import type { TaskCenterService } from '@veren/task-center'
import { createBootstrapTools } from '@veren/app-registry'
import { createAppOpenTool, createPageSendTool } from '@veren/page-registry'

import { createRealSessionPort } from './session-port.ts'

/** 显式解析三个服务与工具注册表；缺任何一个 fail loud（misconfiguration fails loud）。
 *  服务经属性代理解析（本插件声明了 inject，属主合法）；返回面直接复用
 *  Context 上已声明的真实类型，无结构断言。 */
export function requireFaces(ctx: Context): Pick<Context, 'apps' | 'pageRegistry' | 'taskCenter' | 'tools'> {
  const apps = ctx.apps
  const pageRegistry = ctx.pageRegistry
  const taskCenter = ctx.taskCenter
  const tools = ctx.tools
  if (apps === undefined || pageRegistry === undefined || taskCenter === undefined || tools === undefined) {
    throw new Error('app-host: ctx.apps / ctx.pageRegistry / ctx.taskCenter / ctx.tools must be active before the assembly runs; '
      + 'check the profile loader rows (app-registry, page-registry, task-center before app-host)')
  }
  return { apps, pageRegistry, taskCenter, tools }
}

/**
 * 2b) 回填镜像：真实 Loader 按 inject 就绪并发激活行——应用插件（如
 * task-workbench）可能先于本装配注册页面，彼时镜像未在，注册走了"只告警"分支，
 * 页面从此对 openUrl 不可见（第四轮真机失败点）。这里把目录里所有应用的所有
 * 页面补镜像一遍：已在 page-registry 的页面跳过（幂等，正常路径的注册不受
 * 影响）；补镜像的注销器由本装配持有，回滚/卸载时逆序摘除。已知取舍：应用在
 * 装配之后卸载时，回填行会留到装配卸载才摘——彼时 openUrl 已被 app/not-found
 * 拒绝，不会误开。
 * 2b) Backfill the mirror: the real Loader activates rows concurrently by
 * inject-readiness — an app plugin may register pages before this assembly
 * installs the mirror; that registration hit the warn-only branch and stayed
 * invisible to openUrl (the round-4 live failure). Mirror every page of every
 * cataloged app here: pages already in page-registry are skipped (idempotent);
 * backfill disposers are held by this assembly and removed in reverse on
 * rollback/unload. Known tradeoff: an app uninstalling after the assembly ran
 * leaves its backfilled row until the assembly unloads — openUrl already
 * rejects via app/not-found by then.
 */
function backfillPageMirror(apps: Context['apps'], pageRegistry: PageRegistryService, disposers: Array<() => void>): void {
  for (const record of apps.catalog()) {
    // 走 listPageEntries（含实时绑定）：先注册、后装配的页面不丢 live 绑定
    // / listPageEntries (live bindings included): pages registered before the
    // assembly keep their live bindings
    for (const entry of apps.listPageEntries(record.definition.id)) {
      // 幂等键是 pageKey（<appId>/<本地名>）：本地名跨应用重名（两个应用都有
      // "list"），按裸名判存在会把别的应用的页面误当成自己的。
      // The idempotency key is the pageKey (<appId>/<localName>): local names
      // collide across apps (every app has a "list"), so a bare-name check
      // would mistake another app's page for this one.
      if (pageRegistry.get(`${record.definition.id}/${entry.page.name}`) !== undefined) continue
      disposers.push(pageRegistry.registerAppPage(record.definition.id, entry.page as never, entry.live))
    }
  }
}

/**
 * 4) pageRegistry 的全部端口纯参数传入（G13 规则 2）；本插件 inject 拥有
 * apps/taskCenter，能力面由这里穿过公开接口交给 pageRegistry。
 * 4) pageRegistry's ports arrive as pure parameters (G13 rule 2); this plugin
 * owns apps/taskCenter via inject and hands their capability faces through
 * public interfaces to pageRegistry.
 */
function buildPageRegistryPorts(ctx: Context, apps: Context['apps'], taskCenter: TaskCenterService): PageRuntimePorts {
  return {
    // focus 走缺省（eventFocus）/ focus keeps its default (eventFocus)
    sessions: createRealSessionPort(ctx),
    apps,
    // 挂载期完备性告警（§3.9，见 page-registry 的挂载期检查）：真实登记差集
    // 收集之后才有资格判"声明要写却挂不出工具"，注册期看不到组件体的动态登记。
    // / the mount-time completeness warning (§3.9): only the really-registered
    // delta may judge "declares writes but mounts none" — registration time
    // cannot see the component body's dynamic registrations.
    warn: (message: string) => { ctx.logger.warn(message) },
    tasks: taskCenter,
    deliveries: {
      pending: () => taskCenter.pendingDeliveries(),
      mark: (deliveryId, error) => taskCenter.markDelivered(deliveryId, error),
    },
    releaseLeases: async (sessionId) => {
      // 废弃会话时释放它持有的任务租约：按接取会话列出 taken，逐条 release。
      // 单条 release 失败（如已被并发回收）不影响其余；面已必在（本装配注入）。
      // Release the leases a deprecated session holds: list taken by claiming
      // session, release one by one; a single failure (already recycled
      // concurrently) must not affect the rest. The face is guaranteed present
      // (injected by this assembly).
      const taken = await taskCenter.list({ status: 'taken', claimedBySession: sessionId })
      for (const task of taken) {
        await taskCenter.release(task.id, `page session ${sessionId} deprecated`).catch(() => undefined)
      }
    },
  }
}

/** 逆序摘掉已注册的行（回滚与卸载共用）/ undo registered rows in reverse */
function undoRegistrations(ctx: Context, disposers: Array<() => void>): void {
  for (const dispose of disposers.reverse()) {
    try {
      dispose()
    } catch (error: unknown) {
      ctx.logger.error(`app-host: rollback register failed: ${String(error)}`)
    }
  }
  disposers.length = 0
}

/**
 * 回滚路径（装配任一步抛错）：逆序回滚已执行步骤（G13 规则 3）——工具行最先
 * 摘（注册最晚），然后镜像面、resolver。每个回滚步独立捕获：某步的撤销失败
 * 不得吞掉原始错误，也不得阻断其余回滚——原始错误优先透出。
 * The rollback path (any step threw): roll executed steps back in reverse
 * (G13 rule 3) — tool rows first (registered last), then the mirror, then the
 * resolver. Each undo is caught independently: a failing undo must not mask
 * the original error nor block the remaining rollbacks — the original error
 * rethrows.
 */
function rollbackSeams(
  ctx: Context,
  apps: Context['apps'],
  taskCenter: TaskCenterService,
  disposers: Array<() => void>,
  error: unknown,
): never {
  undoRegistrations(ctx, disposers)
  try { apps.setPageMirror(undefined) } catch (e: unknown) { ctx.logger.error(`app-host: rollback setPageMirror failed: ${String(e)}`) }
  try { taskCenter.setAppResolver(undefined) } catch (e: unknown) { ctx.logger.error(`app-host: rollback setAppResolver failed: ${String(e)}`) }
  throw error
}

/**
 * 1) 应用事实 → 任务中心：发送方校验 + 卸载懒孤儿判定都经这里查注册表。
 * 1) App facts → task center: sender validation and the unload-time lazy orphan
 * check both consult the registry here.
 */
function installAppResolver(apps: Context['apps'], taskCenter: TaskCenterService): void {
  taskCenter.setAppResolver(async (appId) => {
    const record = apps.get(appId as never)
    return record === undefined ? undefined : { state: record.state, version: record.version }
  })
}

/**
 * 成功路径的整体卸载（fiber 卸载时由 ctx.effect 调用）：逆序摘工具行与回填
 * 镜像行，再解镜像面与 resolver。与回滚路径不同：这里不 try/catch——卸载期
 * 的失败直接透出（与原实现一致）。
 * The success-path disposer (invoked by ctx.effect on fiber unload): undo the
 * tool rows and backfilled mirror rows in reverse, then unbind the mirror and
 * the resolver. Unlike the rollback path there is no try/catch — unload
 * failures surface as-is (same as the original).
 */
function makeAssemblyDisposer(ctx: Context, apps: Context['apps'], taskCenter: TaskCenterService, disposers: Array<() => void>): () => void {
  return () => {
    undoRegistrations(ctx, disposers)
    apps.setPageMirror(undefined)
    taskCenter.setAppResolver(undefined)
  }
}

/**
 * 执行装配；返回的 disposer 撤销全部注入（fiber 卸载时由 ctx.effect 调用）。
 * 任一步失败：逆序回滚已执行步骤后整体重抛——不留半接线。
 * 步骤注记：宿主引导工具（app_list / app_pages，归 app-registry）与 app_open /
 * page_send（归 page-registry）的工具本体在 try 之前构造，**注册**发生在装配
 * 内、注销器全程握在手里——后续任何一步失败或装配整体卸载时逆序摘除。
 * §3.9 的完备性告警已移到挂载期（page-registry 在真实登记面收集后经 ports.warn
 * 发出，bindPorts 接了 ctx.logger.warn）：注册期只看得到静态声明，看不到组件体
 * 的动态登记，"声明要写却没挂工具"在那里判必然误报。page_send（§3.9）不在页面
 * 会话的屏蔽名单里（session-port 只屏 app_open / app_list / app_pages）——页面
 * agent 必须能拿到它，按 URL 投递是智能自主行动的承载物；级联由 page-registry
 * 的链深台账硬上限兜住。
 * Run the assembly; the disposer undoes every injection in reverse order.
 * On any step failure the executed steps are rolled back in reverse before
 * the error rethrows — no half-wired state is ever left behind.
 * Step notes: the host bootstrap tools and app_open / page_send are built
 * before the try; their *registration* happens inside it and the disposers are
 * held so any later failure or the assembly's own unload removes them in
 * reverse order. The §3.9 coverage warning moved to mount time (registration
 * only sees static declarations, so judging there is a guaranteed false
 * positive). page_send is NOT in the page-session deny list — page agents must
 * hold it: url-addressed delivery lets an agent act autonomously; cascade is
 * capped by page-registry's hop ledger.
 */
export function wireAppHost(ctx: Context): () => void {
  const { apps, pageRegistry, taskCenter, tools } = requireFaces(ctx)
  const bootstrap = createBootstrapTools(apps)
  const appOpen = createAppOpenTool(() => pageRegistry)
  const pageSend = createPageSendTool(() => pageRegistry)
  // 装配持有的全部注册注销器（工具行 + 回填镜像行），逆序撤销
  // / every registration disposer the assembly holds (tool rows + backfilled mirror rows), undone in reverse.
  const disposers: Array<() => void> = []
  installAppResolver(apps, taskCenter)
  try {
    // 2) 页面镜像面：注册单入口（apps.pages(id).register 内部镜像进 URL 索引），
    //    卸载时先摘该应用所有活会话的页面工具
    apps.setPageMirror({
      registerAppPage: (appId, page, live) => pageRegistry.registerAppPage(appId, page as never, live),
      releaseApp: (appId) => pageRegistry.releaseApp(appId),
    })
    // 2b) 回填镜像（见 backfillPageMirror）/ backfill the mirror (see there)
    backfillPageMirror(apps, pageRegistry, disposers)
    // 3) 宿主工具注册：app_list / app_pages / app_open / page_send 挂进真实工具表
    for (const tool of [bootstrap.appList, bootstrap.appPages, appOpen, pageSend]) disposers.push(tools.register(tool))
    // 4) 全部端口纯参数传入 / bind all ports as pure parameters
    pageRegistry.bindPorts(buildPageRegistryPorts(ctx, apps, taskCenter))
  } catch (error: unknown) {
    rollbackSeams(ctx, apps, taskCenter, disposers, error)
  }
  return makeAssemblyDisposer(ctx, apps, taskCenter, disposers)
}
