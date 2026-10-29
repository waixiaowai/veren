/**
 * @veren/task-workbench 插件入口：注册「任务工作台」应用（定义 → 工具 → 页面）
 * + 同意门观察器（docs/task-workbench-modes-dispatch）。
 * Plugin entry: registers the task-workbench app (definition → tools → pages)
 * plus the consent-gate observer.
 *
 * 「怎样写一个 Veren 应用」的参考实现（README 有完整流程）：
 * 1. ctx.apps.register(def, ctx) —— 定义应用并绑定本 fiber（卸载即整应用摘除）；
 * 2. createAppTools —— 12 个工具以全名（`<toolPrefix>__<本地名>`）备好；
 * 3. ctx.apps.pages(id, ctx) —— 页面单入口注册（内部自动镜像进 page-registry）；
 * 4. 同意门的信号面：`ctx.on('session/event', …, { global: true })` 喂 ConsentBook
 *    （global 是硬要求——scopeTarget 载体派发，非 global 一个事件都收不到）。
 * 依赖全部显式声明（G13）：apps / pageRegistry / taskCenter 都是硬 inject。
 * 1. ctx.apps.register(def, ctx) — the app binds to this fiber (dispose removes the whole app);
 * 2. createAppTools — 12 tools prepared under full names (`<toolPrefix>__<localName>`);
 * 3. ctx.apps.pages(id, ctx) — the single-entry page registration (mirrored into page-registry internally);
 * 4. the consent gate's signal face: `ctx.on('session/event', …, { global: true })` feeds the ConsentBook
 *    (global is a hard requirement — scopeTarget carrier dispatch; a non-global listener receives nothing).
 * Dependencies are all declared (G13): apps / pageRegistry / taskCenter are hard injects.
 * @module @veren/task-workbench
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@veren/app-registry'
import type {} from '@veren/page-registry'
import type {} from '@veren/task-center'
import { APP_DEFINITION, APP_ID } from './app.ts'
import { createTaskChannel } from './channel.ts'
import { ConsentBook, DriveLedger } from './consent.ts'
import { bindWorkbenchRuntime } from './pages.tsx'
import { ListMeta, ListPage } from './page-list.tsx'
import { DetailMeta, DetailPage } from './page-detail.tsx'
import { PublishMeta, PublishPage } from './page-publish.tsx'
import { createAppTools } from './tools.ts'
import { TaskStore } from './store.ts'
import type { PageTaskScope } from './types.ts'

export const name = 'veren-task-workbench'

export interface Config {
  /** 队列为空时懒播种的示例工作单数量 / sample orders lazily seeded when the queue is empty */
  listSize: number
}

export const Config: z<Config> = z.object({
  listSize: z.number().default(5).description('队列为空时懒播种的示例工作单数量 / sample orders lazily seeded when the queue is empty'),
})

/** 三个服务依赖全部显式声明：本插件就是应用，任务中心是发布/接取的必经面 */
export const inject = ['apps', 'pageRegistry', 'taskCenter']
export const provide = []

export const apply = (ctx: Context, config: Config): void => {
  const apps = ctx.apps
  // 任务中心是声明的硬 inject：通道从注入的服务面纯参数构建，不再探测 ctx。
  // taskCenter is a declared hard inject: the channel is built from the injected
  // service face as a pure parameter — no ctx probing.
  const channel = createTaskChannel(ctx.taskCenter)
  const store = new TaskStore()
  const book = new ConsentBook()
  const ledger = new DriveLedger()
  // 页面作用域解析面（take_page_task 的"本页那条"）：用 page-registry 实例索引
  // 反查本会话在详情页上的 live 行——URL 里已有 taskId，接取天然受限，不靠参数。
  // / The page-scope resolver (take_page_task's "this page's task"): look this
  // session's live detail row up through the page-registry instance index — the
  // url already carries the taskId, so the take is naturally scoped, parameter-free.
  const scope: PageTaskScope = {
    liveDetailTaskOf: async (sessionId) => {
      const rows = await ctx.pageRegistry.instances.listByApp(APP_ID)
      const row = rows.find((candidate) => candidate.state === 'live'
        && candidate.sessionId === sessionId
        && candidate.page === `${APP_ID}/detail`)
      if (row === undefined) return undefined
      // params 键与 URL 模式逐字一致是注册期/挂载期的门禁（§3.10.5 规则 5），
      // 这里只为类型面如实收窄，不构造缺省值。
      // / params keys matching the url pattern are gated at registration/mount
      // (§3.10.5 rule 5); this is just the honest type-face narrowing, no default.
      const taskId: string | undefined = row.params.taskId
      if (taskId === undefined || taskId.length === 0) return undefined
      return { taskId, url: row.url }
    },
  }
  // 导航正门（§6）：open_task_page 走 pageRegistry.openUrl——taskId 接取与
  // 同 URL 自开守卫都在宿主侧，本包不自建导航机制。
  // / The navigation front door (§6): open_task_page rides pageRegistry.openUrl —
  // the taskId take and the same-url self-open guard both live host-side.
  const openUrl = (url: string, options?: { taskId?: string; callerSessionId?: string }): ReturnType<typeof ctx.pageRegistry.openUrl> =>
    ctx.pageRegistry.openUrl(url, options)

  // 同意门观察器：先于页面注册（首屏回合之前就要开始折叠）。global 是硬要求。
  // / The consent observer: registered before the pages (the fold must run before
  // the first screen's turn). global is a hard requirement.
  ctx.effect(() => ctx.on('session/event', book.observe, { global: true }), 'task-workbench:consent-observer')

  // 单一 effect 收线（G13 规则 3）：定义 → 工具 → 页面，体内任何一步失败都把
  // 已完成的步骤逆序回滚——绝不留下"应用在、工具缺页"的半接线状态。
  // One effect owns the wiring (G13 rule 3): definition → tools → pages; any
  // failing step rolls the finished ones back in reverse.
  ctx.effect(() => {
    const done: Array<() => void> = []
    try {
      // 1) 应用定义：绑定本 fiber，fiber 销毁 → 整应用（页面+工具）摘除
      done.push(apps.register(APP_DEFINITION, ctx))
      // 2) 工具矩阵以全名备好（§4 扩展表）：页面组件体在唯一一次渲染里直接
      //    agent.ctx.tools.register 按矩阵行登记。
      // 2) The tool matrix is prepared under full names (the §4 table): page
      //    bodies register their matrix rows in the one render.
      const tools = createAppTools({
        store, channel, scope, book, ledger, openUrl,
        catalog: () => apps.catalog(),
      }).map((tool) => ({ ...tool, name: `task_workbench__${tool.name}` }))
      // 3) 组件是模块级的：权威投影/全名工具/目录/种子数在装配此刻绑进模块槽位。
      // 3) Components are module-level: the authoritative projection / full-named
      //    tools / catalog / seed size bind into the module slot right here.
      bindWorkbenchRuntime({ store, tools, catalog: () => apps.catalog(), channel, seedSize: config.listSize })
      const pages = apps.pages(APP_ID, ctx)
      done.push(pages.register(ListPage, ListMeta))
      done.push(pages.register(DetailPage, DetailMeta))
      done.push(pages.register(PublishPage, PublishMeta))
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
