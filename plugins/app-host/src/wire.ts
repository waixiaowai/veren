/**
 * 装配本体：三个服务的全部接缝在这里显式接上（第 1 阶段"结构探测 + 惰性端口"
 * 松对接的收敛解，§8.2 宿主装配层）。
 * The assembly body: every seam between the three services is wired here,
 * explicitly, in one place.
 *
 * - `taskCenter.setAppResolver` ← `apps.get`：发任务校验发送方、卸载懒孤儿判定；
 * - `apps.setPageMirror` ← `pageRegistry.registerAppPage/releaseApp`：页面单入口
 *   注册的镜像面（含卸载摘工具）；
 * - `pageRegistry.bindPorts({ sessions })` ← 真实会话端口（agent 作用域工具、
 *   followup+flush、focus 接缝）。
 *
 * 装一个新应用 = 应用插件自己 `ctx.apps.register/pages/tools`，此外零接线。
 * @module @veren/app-host/wire
 */
import type { Context } from '@deepseek-ai/cordis'
import type { AppRegistryService } from '@veren/app-registry'
import type { PageRegistryService } from '@veren/page-registry'
import type { TaskCenterService } from '@veren/task-center'
import { createRealSessionPort } from './session-port.ts'

/** 三个服务在 ctx 上的最小面（类型来自各自包，读取走 ctx.get 显式解析） */
interface HostFaces {
  readonly apps: AppRegistryService
  readonly pageRegistry: PageRegistryService
  readonly taskCenter: TaskCenterService
}

/** 显式解析三个服务；缺任何一个 fail loud（misconfiguration fails loud）。
 *  服务经属性代理解析（Service 插件注册在 fiber 拓扑上，`ctx.get` 的全局
 *  store 读不到它们）；可选服务才走 `ctx.get`。 */
export function requireFaces(ctx: Context): HostFaces {
  const host = ctx as unknown as { apps?: AppRegistryService; pageRegistry?: PageRegistryService; taskCenter?: TaskCenterService }
  const apps = host.apps
  const pageRegistry = host.pageRegistry
  const taskCenter = host.taskCenter
  if (apps === undefined || pageRegistry === undefined || taskCenter === undefined) {
    throw new Error('app-host: ctx.apps / ctx.pageRegistry / ctx.taskCenter must be active before the assembly runs; '
      + 'check the profile loader rows (app-registry, page-registry, task-center before app-host)')
  }
  return { apps, pageRegistry, taskCenter }
}

/**
 * 执行装配；返回的 disposer 撤销全部注入（fiber 卸载时由 ctx.effect 调用）。
 * Run the assembly; the disposer undoes every injection in reverse order.
 */
export function wireAppHost(ctx: Context): () => void {
  const { apps, pageRegistry, taskCenter } = requireFaces(ctx)

  // 1) 应用事实 → 任务中心：发送方校验 + 卸载懒孤儿判定都经这里查注册表
  taskCenter.setAppResolver(async (appId) => {
    const record = apps.get(appId as never)
    return record === undefined ? undefined : { state: record.state, version: record.version }
  })

  // 2) 页面镜像面：注册单入口（apps.pages(id).register 内部镜像进 URL 索引），
  //    卸载时先摘该应用所有活会话的页面工具
  apps.setPageMirror({
    registerAppPage: (appId, page) => pageRegistry.registerAppPage(appId, page as never),
    releaseApp: (appId) => pageRegistry.releaseApp(appId),
  })

  // 3) 真实会话端口：agent 作用域工具 + followup/flush + focus 接缝
  pageRegistry.bindPorts({ sessions: createRealSessionPort(ctx) })

  return () => {
    taskCenter.setAppResolver(undefined)
    apps.setPageMirror(undefined)
  }
}
