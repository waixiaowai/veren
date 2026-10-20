/**
 * 装配本体：三个服务的全部接缝在这里显式接上（G13 显式接线）。
 * The assembly body: every seam between the three services is wired here,
 * explicitly, in one place.
 *
 * - `taskCenter.setAppResolver` ← `apps.get`：发任务校验发送方、卸载懒孤儿判定；
 * - `apps.setPageMirror` ← `pageRegistry.registerAppPage/releaseApp`：页面单入口
 *   注册的镜像面（含卸载摘工具）；
 * - `pageRegistry.bindPorts({...})` ← 全部端口**纯参数**传入（G13 规则 2）：
 *   真实会话端口 + apps/tasks/toolsOf/deliveries/releaseLeases 能力面。
 *   pageRegistry 不再自己摸兄弟服务（守卫按属主归因，摸了就炸）。
 *
 * **全成或全回滚**：三步收在同一个 try 块里，任一步抛错即逆序撤销已执行的前序
 * 步骤再重抛（G13 规则 3）——系统要么处于"三步全接上"，要么"什么也没接"。
 * All-or-nothing: the three steps share one try block; any failure rolls the
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
import type { AppId } from '@veren/app-registry'
import { createRealSessionPort } from './session-port.ts'

/** 显式解析三个服务；缺任何一个 fail loud（misconfiguration fails loud）。
 *  服务经属性代理解析（本插件声明了 inject，属主合法）；返回面直接复用
 *  Context 上已声明的真实类型，无结构断言。 */
export function requireFaces(ctx: Context): Pick<Context, 'apps' | 'pageRegistry' | 'taskCenter'> {
  const apps = ctx.apps
  const pageRegistry = ctx.pageRegistry
  const taskCenter = ctx.taskCenter
  if (apps === undefined || pageRegistry === undefined || taskCenter === undefined) {
    throw new Error('app-host: ctx.apps / ctx.pageRegistry / ctx.taskCenter must be active before the assembly runs; '
      + 'check the profile loader rows (app-registry, page-registry, task-center before app-host)')
  }
  return { apps, pageRegistry, taskCenter }
}

/**
 * 执行装配；返回的 disposer 撤销全部注入（fiber 卸载时由 ctx.effect 调用）。
 * 任一步失败：逆序回滚已执行步骤后整体重抛——不留半接线。
 * Run the assembly; the disposer undoes every injection in reverse order.
 * On any step failure the executed steps are rolled back in reverse before
 * the error rethrows — no half-wired state is ever left behind.
 */
export function wireAppHost(ctx: Context): () => void {
  const { apps, pageRegistry, taskCenter } = requireFaces(ctx)

  // 1) 应用事实 → 任务中心：发送方校验 + 卸载懒孤儿判定都经这里查注册表
  taskCenter.setAppResolver(async (appId) => {
    const record = apps.get(appId as never)
    return record === undefined ? undefined : { state: record.state, version: record.version }
  })

  try {
    // 2) 页面镜像面：注册单入口（apps.pages(id).register 内部镜像进 URL 索引），
    //    卸载时先摘该应用所有活会话的页面工具
    apps.setPageMirror({
      registerAppPage: (appId, page) => pageRegistry.registerAppPage(appId, page as never),
      releaseApp: (appId) => pageRegistry.releaseApp(appId),
    })

    // 3) pageRegistry 的全部端口纯参数传入（G13 规则 2）；本插件 inject 拥有
    //    apps/taskCenter，能力面由这里穿过公开接口交给 pageRegistry
    pageRegistry.bindPorts({
      sessions: createRealSessionPort(ctx),
      apps,
      // 目录值就是 DSH ToolDefinition 本体；单应用目录异常不炸整面（回空目录）
      toolsOf: (appId) => {
        try {
          return new Map(apps.listTools(appId as AppId).map((tool) => [tool.name, tool]))
        } catch {
          return new Map()
        }
      },
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
    // 逆序回滚已执行步骤（G13 规则 3）。每个回滚步独立捕获：某步的撤销失败
    // 不得吞掉原始错误，也不得阻断其余回滚——原始错误优先透出。
    // Roll executed steps back in reverse (G13 rule 3). Each undo is caught
    // independently: a failing undo must not mask the original error nor block
    // the remaining rollbacks — the original error rethrows.
    try { apps.setPageMirror(undefined) } catch (e: unknown) { ctx.logger.error(`app-host: rollback setPageMirror failed: ${String(e)}`) }
    try { taskCenter.setAppResolver(undefined) } catch (e: unknown) { ctx.logger.error(`app-host: rollback setAppResolver failed: ${String(e)}`) }
    throw error
  }

  return () => {
    taskCenter.setAppResolver(undefined)
    apps.setPageMirror(undefined)
  }
}
