/**
 * 测试宿主：一处搭好应用层服务面（apps / pageRegistry / taskCenter），
 * 收敛五个应用 spec 各抄一遍的「构造 + provide 双路径 + 镜像面接线」。
 * The test host: assembles the application-layer service face (apps /
 * pageRegistry / taskCenter) in one place, collapsing the "construct on a
 * host context + re-provide + wire the mirror" copy that five app specs
 * each carried.
 *
 * 各开关都能显式关闭来测降级路径（storage 缺席须连 registries 一起关）；
 * `dispose()` 与装配严格成对、逆序拆除。
 * Every switch can be turned off explicitly to exercise degrade paths (turning
 * storage off requires turning registries off too); `dispose()` pairs strictly
 * with the mount and tears everything down in reverse order.
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
  /**
   * 挂真实 storage 栈（临时目录）。**缺省 true**：page-registry 声明
   * `inject: ['storageDomain']`，绝大多数应用层测试都需要它在场才能激活，
   * 所以默认挂上、需要「无存储降级」的测试显式置 false（此时 registries
   * 也必须置 false，否则装配 fail loud）。
   * Mount the real storage stack (temp directory). **Defaults to true**:
   * page-registry declares `inject: ['storageDomain']`, so nearly every
   * application-layer test needs it present for the registry to activate.
   * Storage-off is the explicit opt-out for degrade tests (which must also
   * pass `registries: false`, or the mount fails loud).
   */
  storage?: boolean
  /** 挂真实 taskCenter（隐含 storage，即使 storage 为 false 也会挂）。Mount the real task center (implies storage, mounted even when `storage` is false). */
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
  // storage 先挂、最后拆（disposers 逆序）：page-registry 的存储域句柄在
  // 自己的 fiber dispose 时关闭，storage 栈必须活得比注册表 fiber 更久。
  // Storage mounts first and disposes last (reversed disposers): page-registry
  // closes its domain handle on its own fiber dispose, so the storage stack
  // must outlive the registry fibers.
  const storageOn = options.storage !== false || options.taskCenter === true
  const registriesOn = options.registries !== false
  if (registriesOn && options.storage === false && options.taskCenter !== true) {
    // fail loud：page-registry 声明 inject ['storageDomain']，无存储装不上。
    // Fail loud: page-registry declares inject ['storageDomain'] and cannot
    // activate without storage.
    throw new Error('mountAppHost: storage is required while registries are on '
      + '(page-registry injects storageDomain); pass registries: false for storage-off degrade tests')
  }
  if (storageOn) {
    const storage = await mountStorage(ctx, dirs)
    disposers.push(storage.dispose)
  }
  if (registriesOn) await mountRegistries(ctx, disposers)
  if (options.taskCenter === true) {
    const fiber = await ctx.plugin(TaskCenterPlugin)
    disposers.push(() => fiber.dispose())
  }
  // 开关关掉的键干脆不出现在结果上（exactOptionalPropertyTypes 下不写显式
  // undefined），调用方拿到的形状与装配事实一致。apps/pageRegistry 走
  // declaration merging 的真实服务面，缺席在 mountRegistries 里已 fail loud。
  // Switched-off keys are absent from the result entirely (never an explicit
  // undefined under exactOptionalPropertyTypes), so the shape callers see
  // matches what was actually assembled. apps/pageRegistry use the real
  // declaration-merged service faces; absence already fails loud in
  // mountRegistries.
  return {
    ctx,
    ...(registriesOn ? { apps: ctx.apps, pageRegistry: ctx.pageRegistry } : {}),
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
