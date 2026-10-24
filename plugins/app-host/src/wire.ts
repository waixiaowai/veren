/**
 * 装配本体：三个服务的全部接缝在这里显式接上（G13 显式接线）。
 * The assembly body: every seam between the three services is wired here,
 * explicitly, in one place.
 *
 * - `taskCenter.setAppResolver` ← `apps.get`：发任务校验发送方、卸载懒孤儿判定；
 * - `apps.setPageMirror` ← `pageRegistry.registerAppPage/releaseApp`：页面单入口
 *   注册的镜像面（含卸载摘工具）；
 * - `pageRegistry.bindPorts({...})` ← 全部端口**纯参数**传入（G13 规则 2）：
 *   真实会话端口 + apps/tasks/deliveries/releaseLeases 能力面。
 *   pageRegistry 不再自己摸兄弟服务（守卫按属主归因，摸了就炸）；
 * - 宿主工具 `app_list` / `app_pages` / `app_open` 由本装配 `ctx.tools.register`
 *   挂进真实工具表（第三轮真机验证补上的丢失步骤）。
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
 * 执行装配；返回的 disposer 撤销全部注入（fiber 卸载时由 ctx.effect 调用）。
 * 任一步失败：逆序回滚已执行步骤后整体重抛——不留半接线。
 * Run the assembly; the disposer undoes every injection in reverse order.
 * On any step failure the executed steps are rolled back in reverse before
 * the error rethrows — no half-wired state is ever left behind.
 */
export function wireAppHost(ctx: Context): () => void {
  const { apps, pageRegistry, taskCenter, tools } = requireFaces(ctx)

  // 宿主引导工具（app_list / app_pages，归 app-registry）与 app_open（归
  // page-registry）的工具本体在这里构造——**注册**发生在本装配的最后一步，
  // 注册得到的注销器全程握在手里：后续任何一步失败或装配整体卸载时逆序摘除。
  // Host bootstrap tools (app_list / app_pages, owned by app-registry) and
  // app_open (owned by page-registry) are built here — the *registration* is
  // the assembly's final step; the disposers are held so any later failure or
  // the assembly's own unload removes them in reverse order.
  const bootstrap = createBootstrapTools(apps)
  const appOpen = createAppOpenTool(() => pageRegistry)
  const pageSend = createPageSendTool(() => pageRegistry)
  // 装配持有的全部注册注销器（工具行 + 回填镜像行），逆序撤销
  // / every registration disposer the assembly holds (tool rows + backfilled
  // mirror rows), undone in reverse.
  const disposers: Array<() => void> = []

  /** 逆序摘掉已注册的行（回滚与卸载共用）/ undo registered rows in reverse */
  const undoRegistrations = (): void => {
    for (const dispose of disposers.reverse()) {
      try {
        dispose()
      } catch (error: unknown) {
        ctx.logger.error(`app-host: rollback register failed: ${String(error)}`)
      }
    }
    disposers.length = 0
  }

  // 1) 应用事实 → 任务中心：发送方校验 + 卸载懒孤儿判定都经这里查注册表
  taskCenter.setAppResolver(async (appId) => {
    const record = apps.get(appId as never)
    return record === undefined ? undefined : { state: record.state, version: record.version }
  })

  try {
    // 2) 页面镜像面：注册单入口（apps.pages(id).register 内部镜像进 URL 索引），
    //    卸载时先摘该应用所有活会话的页面工具
    apps.setPageMirror({
      registerAppPage: (appId, page, live) => pageRegistry.registerAppPage(appId, page as never, live),
      releaseApp: (appId) => pageRegistry.releaseApp(appId),
    })

    // 2b) 回填镜像：真实 Loader 按 inject 就绪并发激活行——应用插件（如
    //     task-workbench）可能先于本装配注册页面，彼时镜像未在，注册走了
    //     "只告警"分支，页面从此对 openUrl 不可见（第四轮真机失败点）。这里把
    //     目录里所有应用的所有页面补镜像一遍：已在 page-registry 的页面跳过
    //     （幂等，正常路径的注册不受影响）；补镜像的注销器由本装配持有，
    //     回滚/卸载时逆序摘除。已知取舍：应用在装配之后卸载时，回填行会留到
    //     装配卸载才摘——彼时 openUrl 已被 app/not-found 拒绝，不会误开。
    // 2b) Backfill the mirror: the real Loader activates rows concurrently by
    //     inject-readiness — an app plugin (e.g. task-workbench) may register
    //     pages before this assembly installs the mirror; that registration hit
    //     the warn-only branch and stayed invisible to openUrl (the round-4
    //     live failure). Mirror every page of every cataloged app here: pages
    //     already in page-registry are skipped (idempotent; the normal path is
    //     untouched); backfill disposers are held by this assembly and removed
    //     in reverse on rollback/unload. Known tradeoff: if an app uninstalls
    //     after the assembly ran, its backfilled row lingers until the assembly
    //     unloads — openUrl already rejects via app/not-found by then.
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

    // §3.9 的完备性告警已移到挂载期（page-registry 在真实登记面收集后经 ports.warn
    // 发出，上面 bindPorts 接了 ctx.logger.warn）：注册期只看得到静态声明，看不到
    // 组件体的动态登记，"声明要写却没挂工具"在那里判必然误报。
    // The §3.9 coverage warning moved to mount time (page-registry emits it via
    // ports.warn after the real tool face is collected; bindPorts above wires
    // ctx.logger.warn): registration time only sees static declarations, never
    // the component body's dynamic registrations, so judging "declares writes
    // but mounts none" there is a guaranteed false positive.

    // 3) 宿主工具注册：app_list / app_pages / app_open / page_send 挂进真实工具表。
    //    page_send（§3.9）不在页面会话的屏蔽名单里（session-port 只屏 app_open /
    //    app_list / app_pages）——页面 agent 必须能拿到它，按 URL 投递是智能
    //    自主行动的承载物；级联由 page-registry 的链深台账硬上限兜住。
    // 3) Host tool registration: app_list / app_pages / app_open / page_send
    //    land in the real tool table. page_send (§3.9) is NOT in the page-session
    //    deny list (session-port masks only app_open / app_list / app_pages) —
    //    page agents must hold it: url-addressed delivery is what lets an agent
    //    act autonomously; cascade is capped by page-registry's hop ledger.
    for (const tool of [bootstrap.appList, bootstrap.appPages, appOpen, pageSend]) {
      disposers.push(tools.register(tool))
    }

    // 4) pageRegistry 的全部端口纯参数传入（G13 规则 2）；本插件 inject 拥有
    //    apps/taskCenter，能力面由这里穿过公开接口交给 pageRegistry。
    // 4) pageRegistry's ports arrive as pure parameters (G13 rule 2); this
    //    plugin owns apps/taskCenter via inject and hands their capability
    //    faces through public interfaces to pageRegistry.
    pageRegistry.bindPorts({
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
        const taken = await taskCenter.list({ status: 'taken', claimedBySession: sessionId })
        for (const task of taken) {
          await taskCenter.release(task.id, `page session ${sessionId} deprecated`).catch(() => undefined)
        }
      },
    })
  } catch (error: unknown) {
    // 逆序回滚已执行步骤（G13 规则 3）：工具行最先摘（注册最晚），然后镜像
    // 面、resolver。每个回滚步独立捕获：某步的撤销失败不得吞掉原始错误，
    // 也不得阻断其余回滚——原始错误优先透出。
    // Roll executed steps back in reverse (G13 rule 3): tool rows go first
    // (registered last), then the mirror, then the resolver. Each undo is
    // caught independently: a failing undo must not mask the original error
    // nor block the remaining rollbacks — the original error rethrows.
    undoRegistrations()
    try { apps.setPageMirror(undefined) } catch (e: unknown) { ctx.logger.error(`app-host: rollback setPageMirror failed: ${String(e)}`) }
    try { taskCenter.setAppResolver(undefined) } catch (e: unknown) { ctx.logger.error(`app-host: rollback setAppResolver failed: ${String(e)}`) }
    throw error
  }

  return () => {
    undoRegistrations()
    apps.setPageMirror(undefined)
    taskCenter.setAppResolver(undefined)
  }
}
