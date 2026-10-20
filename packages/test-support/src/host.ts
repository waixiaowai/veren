/**
 * 测试宿主：一处搭好应用层服务面（apps / pageRegistry / taskCenter），
 * 收敛五个应用 spec 各抄一遍的「构造 + provide 双路径 + 镜像面接线」。
 * The test host: assembles the application-layer service face (apps /
 * pageRegistry / taskCenter) in one place, collapsing the "construct on a
 * host context + re-provide + wire the mirror" copy that five app specs
 * each carried.
 *
 * 每个可选项都能缺席，用来测降级路径；`dispose()` 与装配严格成对、逆序拆除。
 * Every option can be absent to exercise degrade paths; `dispose()` pairs
 * strictly with the mount and tears everything down in reverse order.
 *
 * @module @veren/test-support/host
 */
import { Context } from '@deepseek-ai/cordis'
import AppRegistryPlugin, { AppRegistryService } from '@veren/app-registry'
import PageRegistryPlugin, { PageRegistryService } from '@veren/page-registry'
import TaskCenterPlugin from '@veren/task-center'
import { ToolTable } from './sessions.ts'
import { mountStorage, TempDirs } from './storage.ts'

/** 装配选项；缺省即最小宿主。Assembly options; defaults give the minimal host. */
export interface AppHostOptions {
  /** 挂 apps + pageRegistry + 镜像面（缺省 true；置 false 测「apps 缺席」降级）。Mount apps + pageRegistry + the mirror seam (default true; false tests the "apps absent" degrade path). */
  registries?: boolean
  /** 挂真实 storage 栈（临时目录）。Mount the real storage stack (temp directory). */
  storage?: boolean
  /** 挂真实 taskCenter（隐含 storage）。Mount the real task center (implies storage). */
  taskCenter?: boolean
  /** 提供最小 agentPresets 替身（缺省 true）。Provide the minimal agentPresets stub (default true). */
  agentPresets?: boolean
}

/** 已装配的测试宿主。The assembled test host. */
export interface AppHost {
  readonly ctx: Context
  /** registries 开启时存在。Present when `registries` is on. */
  readonly apps?: AppRegistryService
  /** registries 开启时存在。Present when `registries` is on. */
  readonly pageRegistry?: PageRegistryService
  /** 宿主级工具替身表（task 工具与页面全局工具落在这里）。The host-level tool stub table (task tools and global page tools land here). */
  readonly tools: ToolTable
  /** 逆序拆除全部装配（fiber → provide → 临时目录）。Tear the mount down reversed (fibers → provides → temp dirs). */
  dispose(): Promise<void>
}

/**
 * 搭一个带应用层服务的测试宿主。注册表走真实插件激活（一条路径），
 * 镜像面在此显式接上——这正是真实宿主装配（app-host）接的同一条缝。
 * Mount a test host with the application-layer services. Registries activate
 * through the real plugins (one path only) and the mirror seam is wired here
 * explicitly — the same seam the real host assembly (app-host) wires.
 */
export async function mountAppHost(options: AppHostOptions = {}): Promise<AppHost> {
  const ctx = new Context()
  const dirs = new TempDirs()
  const disposers: Array<() => Promise<void> | void> = []
  const tools = new ToolTable()
  disposers.push(ctx.provide('tools', tools))
  if (options.agentPresets !== false) {
    disposers.push(ctx.provide('agentPresets', {
      // 空预设表 + 原样透传 preset / an empty table passing `preset` through
      list: async () => [],
      composedPreset: (agentContext: { preset?: string }) => agentContext.preset,
    }))
  }
  if (options.registries !== false) await mountRegistries(ctx, disposers)
  if (options.taskCenter === true || options.storage === true) {
    const storage = await mountStorage(ctx, dirs)
    disposers.push(storage.dispose)
  }
  if (options.taskCenter === true) {
    const fiber = await ctx.plugin(TaskCenterPlugin)
    disposers.push(() => fiber.dispose())
  }
  return {
    ctx,
    apps: options.registries === false ? undefined : ctx.get('apps'),
    pageRegistry: options.registries === false ? undefined : ctx.get('pageRegistry'),
    tools,
    dispose: async () => {
      for (const dispose of disposers.reverse()) await dispose()
      dirs.disposeAll()
    },
  }
}

/** 激活两个真实注册表插件并接上镜像面（注册表→page-registry 的单入口注册）。Activate both real registry plugins and wire the mirror (the single-entry registration path into page-registry). */
async function mountRegistries(ctx: Context, disposers: Array<() => Promise<void> | void>): Promise<void> {
  const appsFiber = await ctx.plugin(AppRegistryPlugin)
  const pagesFiber = await ctx.plugin(PageRegistryPlugin)
  disposers.push(() => pagesFiber.dispose(), () => appsFiber.dispose())
  const apps = ctx.get('apps')
  const pageRegistry = ctx.get('pageRegistry')
  if (apps === undefined || pageRegistry === undefined) {
    throw new Error('registry plugins did not provide apps/pageRegistry')
  }
  apps.setPageMirror({
    registerAppPage: (appId, page) => pageRegistry.registerAppPage(appId, page),
    releaseApp: (appId) => pageRegistry.releaseApp(appId),
  })
}
