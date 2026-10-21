/**
 * @veren/task-workbench 插件入口：注册「任务工作台」应用（定义 → 工具 → 页面）。
 * Plugin entry: registers the task-workbench app (definition → tools → pages).
 *
 * 这是「怎样写一个 Veren 应用」的参考实现（README 有完整流程）：
 * 1. ctx.apps.register(def, ctx) —— 定义应用并绑定本 fiber（卸载即整应用摘除）；
 * 2. ctx.apps.tools(id, ctx) —— 定义应用级工具目录（本地名，前缀由注册表拼）；
 * 3. ctx.apps.pages(id, ctx) —— 注册页面（/apps/<appId>/...，tools 引用本地名）。
 *    页面注册是单入口：app-registry 内部自动镜像进 page-registry 的 URL 索引，
 *    应用作者不再（也不能）自己调 ctx.pageRegistry.registerAppPage。
 * 4. 依赖全部显式声明（G13）：apps / pageRegistry / taskCenter 都是硬 inject，
 *    没有任何运行期探测兄弟服务的降级通道——那条通道在真实宿主上从未生效过。
 * @module @veren/task-workbench
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { AppCapability } from '@veren/app-registry'
import type {} from '@veren/app-registry'
import type {} from '@veren/page-registry'
import type {} from '@veren/task-center'
import { APP_DEFINITION, APP_ID, createAppTools, createTaskChannel, PUBLISH_TASK_REQUIRES } from './app.ts'
import { detailPage, listPage, publishPage } from './pages.tsx'
import { TaskStore, makeList } from './store.ts'

export const name = 'veren-task-workbench'

export interface Config {
  /** 初始示例任务数量 / initial number of sample tasks */
  listSize: number
}

export const Config: z<Config> = z.object({
  listSize: z.number().default(5).description('初始示例任务数量 / initial number of sample tasks'),
})

/** 三个服务依赖全部显式声明：本插件就是应用，任务中心是发布/拆分的必经面 */
export const inject = ['apps', 'pageRegistry', 'taskCenter']
export const provide = []

export const apply = (ctx: Context, config: Config): void => {
  const apps = ctx.apps
  // 任务中心是声明的硬 inject：通道从注入的服务面纯参数构建，不再探测 ctx。
  // taskCenter is a declared hard inject: the channel is built from the injected
  // service face as a pure parameter — no ctx probing.
  const channel = createTaskChannel(ctx.taskCenter)
  const store = new TaskStore(makeList(config.listSize))

  // 单一 effect 收线（G13 规则 3）：定义 → 工具 → 页面，体内任何一步失败都把
  // 已完成的步骤逆序回滚——绝不留下"应用在、工具缺页"的半接线状态。
  // One effect owns the wiring (G13 rule 3): definition → tools → pages; any
  // failing step rolls the finished ones back in reverse, never leaving a
  // half-wired "app present, tools/pages missing" state.
  ctx.effect(() => {
    const done: Array<() => void> = []
    try {
      // 1) 应用定义：绑定本 fiber，fiber 销毁 → 整应用（页面+工具）摘除
      done.push(apps.register(APP_DEFINITION, ctx))
      // 2) 工具目录先于页面：defineTool 产物进应用目录（publish 需要 tasks:send
      //    能力，经 define 的 meta 参数声明）
      const tools = apps.tools(APP_ID, ctx)
      for (const tool of createAppTools(store, channel)) {
        done.push(tools.define(tool, tool.name === 'publish_task'
          ? { requires: [...PUBLISH_TASK_REQUIRES] as AppCapability[] }
          : undefined))
      }
      // 3) 页面注册：单入口，app-registry 内部镜像进 page-registry（可被 openUrl
      //    解析）；镜像失败会回滚并抛错。三页都带权威 store（§3.10.3 活的视图）：
      //    页面会话建立时宿主按参数挂载订阅该 store 的视图，store 变化经
      //    PAGE-DATA 块同步进上下文——S 在这里的 register 调用处被消费。
      // 3) Page registration: single entry, app-registry mirrors into
      //    page-registry internally (resolvable by openUrl); a mirror failure
      //    rolls back and throws. All three pages carry the authoritative store
      //    (§3.10.3 live views): the host mounts a store-subscribed view per
      //    page session and store changes reach the context as PAGE-DATA
      //    blocks — S is consumed here, at the register call.
      const pages = apps.pages(APP_ID, ctx)
      done.push(pages.register(listPage, { store }))
      done.push(pages.register(detailPage, { store }))
      done.push(pages.register(publishPage, { store }))
    } catch (error: unknown) {
      for (const dispose of done.reverse()) dispose()
      throw error
    }
    // 本接线不持有独立资源：清理全部由注册表侧的 disposer 承担，effect 返回空清理器。
    // This wiring owns no standalone resource: cleanup lives in the registry
    // disposers, so the effect returns a no-op disposer.
    return () => undefined
  }, 'task-workbench:app')
}
