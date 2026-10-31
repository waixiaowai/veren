/**
 * The acceptance scenarios' full-host boot: the real storage stack (json
 * backend under a temp dir), the four plugins, the file-backed session
 * directory, and the assembly wiring in the same three steps the real host
 * assembly (app-host wireAppHostHost) performs — resolver ← apps, mirror ←
 * pageRegistry, bindPorts ← pure parameters. Plus the scenario helpers: open
 * a detail url, let the async first-screen lifecycle settle, and read a
 * rejection's stable code.
 *
 * 验收场景的完整宿主启动：真实存储栈（json backend 落临时目录）、四个插件、
 * 落盘会话目录，以及与真实宿主装配（app-host wireAppHost）同型的三步装配接线
 * ——resolver ← apps、镜像面 ← pageRegistry、bindPorts ← 纯参数。外加场景助手：
 * 打开详情页 URL、等异步首屏生命周期落定、读取拒绝的稳定错误码。
 *
 * @module @veren/task-workbench/tests/helpers/acceptance-boot
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import * as Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import AppRegistryPlugin from '@veren/app-registry'
import type { AppRegistryService } from '@veren/app-registry'
import PageRegistryPlugin from '@veren/page-registry'
import type { PageRegistryService } from '@veren/page-registry'
import type { PageInstanceKey } from '@veren/prompt-page'
import TaskCenterPlugin from '@veren/task-center'
import type { TaskCenterService } from '@veren/task-center'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { apply, inject, name as workbenchName } from '../../src/index.ts'
import { FileSessionStore } from './file-session-store.ts'

/** What one boot hands the scenarios. 一次启动交给场景的事实。 */
export interface Boot {
  ctx: Context
  store: FileSessionStore
  tools: Map<string, ToolDefinition>
  apps: AppRegistryService
  pages: PageRegistryService
  tasks: TaskCenterService
  wb: Fiber
}

/** The roots and stop-handles one spec file created, cleaned by {@link disposeTrackedBoot}. 本测试文件创建的临时根与停止句柄，由 disposeTrackedBoot 清理。 */
const roots: string[] = []
const made: Array<() => Promise<void>> = []

/** Reverse-order teardown of every tracked boot, then the temp roots. 逆序销毁全部被跟踪的启动，然后删除临时根。 */
export async function disposeTrackedBoot(): Promise<void> {
  for (const dispose of made.reverse()) await dispose().catch(() => undefined)
  made.length = 0
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
}

/** One temporary storage root, removed after the spec. 测试结束后删除的一个临时存储根目录。 */
export function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'phase1-acceptance-'))
  roots.push(root)
  return root
}

/** provide 的宽松封装（测试桩不需要 InjectKey 精确类型）/ loose provide for test stubs */
function provideStub(ctx: Context, name: string, value: unknown): void {
  ;(ctx.provide as unknown as (n: string, v: unknown) => void)(name, value)
}

/**
 * 起一套完整宿主：真实存储栈（json backend → 临时目录）+ 四个插件 +
 * 落盘会话目录。返回的 stop() 按依赖逆序销毁每个 fiber。
 * 装配接线 = app-host（plugins/app-host/src/wire.ts）在真实宿主做的三步，
 * 这里显式做同型三步：resolver ← apps、镜像面 ← pageRegistry、
 * bindPorts ← 全部端口纯参数（G13 后没有隐式探测兜底）。
 */
/** The session-side stubs: the file-backed store, the tool registry double, and the session/event bridge. 会话侧替身：落盘 store、工具注册表替身与 session/event 桥。 */
function wireSessionSide(ctx: Context, root: string): { store: FileSessionStore; tools: Map<string, ToolDefinition> } {
  // 工具注册表替身：register 记录，disposer 摘除（真实释放语义）
  const tools = new Map<string, ToolDefinition>()
  const store = new FileSessionStore(join(root, 'sessions.json'), tools)
  // session/event 桥：目录的注入消息同步喂给插件纤维上的同意门观察器
  // / the session/event bridge: the store's injected messages feed the consent observer on the plugin fiber
  store.emitSessionEvent = (session, event) => { ctx.emit('session/event', session as never, event as never) }
  provideStub(ctx, 'tools', {
    register: (tool: ToolDefinition) => {
      tools.set(tool.name, tool)
      return () => { tools.delete(tool.name) }
    },
  })
  provideStub(ctx, 'sessions', store.dsh)
  provideStub(ctx, 'agents', store.agents)
  return { store, tools }
}

/** The real storage stack plus the four registry/task plugins. 真实存储栈与四个注册表/任务插件。 */
async function mountPlugins(ctx: Context, root: string): Promise<{ storageFiber: Fiber; jsonFiber: Fiber; domainFiber: Fiber }> {
  const storageFiber = await ctx.plugin(Storage.default)
  const jsonFiber = await ctx.plugin(StorageJson, { root })
  const domainFiber = await ctx.plugin(StorageDomain, { backend: 'json' })
  await ctx.plugin(AppRegistryPlugin)
  await ctx.plugin(PageRegistryPlugin)
  await ctx.plugin(TaskCenterPlugin)
  return { storageFiber, jsonFiber, domainFiber }
}

/**
 * 接线第一步：resolver ← apps.get（应用禁用/卸载经它生效）。
 * Wiring step 1: resolver ← apps.get (app disable/uninstall takes effect through it).
 */
function wireAppResolver(ctx: Context): void {
  ctx.taskCenter.setAppResolver(async (appId) => {
    const record = ctx.apps.get(appId as never)
    return record === undefined ? undefined : { state: record.state, version: record.version }
  })
}

/**
 * 接线第二步：镜像面 ← pageRegistry（live 绑定必须透传：组件页的每会话视图
 * ——首屏正文/动态工具——全靠它；丢掉它 openUrl 只剩目录工具与空正文）。
 * Wiring step 2: mirror ← pageRegistry (the live binding must pass through:
 * the component page's per-session view — first-screen body/dynamic tools —
 * depends on it; dropping it leaves catalog-only tools and an empty body).
 */
function wirePageMirror(ctx: Context): void {
  ctx.apps.setPageMirror({
    registerAppPage: (appId, page, live) => ctx.pageRegistry.registerAppPage(appId, page, live),
    releaseApp: (appId) => ctx.pageRegistry.releaseApp(appId),
  })
}

/** 接线第三步：会话端口/投递口/租约释放全部纯参数注入。Wiring step 3: the session port, the delivery face, and the lease release as pure parameters. */
function wireSessionPorts(ctx: Context, store: FileSessionStore): void {
  const taskCenter = ctx.taskCenter
  ctx.pageRegistry.bindPorts({
    sessions: store.port,
    apps: ctx.apps,
    tasks: taskCenter,
    deliveries: {
      pending: () => taskCenter.pendingDeliveries(),
      mark: (deliveryId, error) => taskCenter.markDelivered(deliveryId, error),
    },
    releaseLeases: async (sessionId) => {
      const taken = await taskCenter.list({ status: 'taken', claimedBySession: sessionId })
      for (const task of taken) {
        await taskCenter.release(task.id, `page session ${sessionId} deprecated`).catch(() => undefined)
      }
    },
  })
}

/**
 * 装配接线（与 app-host wireAppHost 同型三步）：
 * 1) resolver ← apps.get；2) 镜像面 ← pageRegistry；3) bindPorts 纯参数。
 * The assembly wiring (the same three steps as app-host's wireAppHost):
 * 1) resolver ← apps.get; 2) mirror ← pageRegistry; 3) bindPorts as pure parameters.
 */
function wireAssembly(ctx: Context, store: FileSessionStore): void {
  wireAppResolver(ctx)
  wirePageMirror(ctx)
  wireSessionPorts(ctx, store)
}

/** 等实例索引就绪（域打开是异步的，lookup 不再是失败索引）/ wait for the instance index to be ready (domain opens are async) */
async function warmUpIndex(pages: PageRegistryService): Promise<void> {
  for (let i = 0; i < 100; i += 1) {
    try {
      await pages.instances.listByApp('warm-up')
      break
    } catch { await new Promise((resolve) => setTimeout(resolve, 10)) }
  }
}

export async function boot(root: string): Promise<Boot & { stop(): Promise<void> }> {
  const ctx = new Context()
  const { store, tools } = wireSessionSide(ctx, root)
  const { storageFiber, jsonFiber, domainFiber } = await mountPlugins(ctx, root)
  wireAssembly(ctx, store)
  const wb = await ctx.plugin({ name: workbenchName, inject, apply }, { listSize: 3 })
  const pages = ctx.pageRegistry
  await warmUpIndex(pages)
  const stop = async (): Promise<void> => {
    for (const fiber of [wb, domainFiber, jsonFiber, storageFiber]) {
      await fiber.dispose().catch(() => undefined)
    }
  }
  made.push(stop)
  return { ctx, store, tools, apps: ctx.apps, pages, tasks: ctx.taskCenter, wb, stop }
}

/** 打开应用详情页 URL 的便捷封装 / open a detail-page url */
export function open(pages: PageRegistryService, taskId: string, options: { taskId?: string } = {}) {
  return pages.openUrl(`/apps/task-workbench/task/${taskId}` as PageInstanceKey, options)
}

/** 等异步首屏生命周期落定（effect fire-and-forget 后的存储写与 followup）/ let the async first-screen lifecycle settle (storage writes and the followup after fire-and-forget effects) */
export async function flush(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setTimeout(resolve, 5))
}

/** 读一次拒绝的稳定错误码（无码则标注 NO_CODE）/ read one rejection's stable code (NO_CODE when absent) */
export function errorCode(promise: Promise<unknown>): Promise<string> {
  return promise.then(
    () => { throw new Error('expected rejection') },
    (error: { code?: string }) => error.code ?? `NO_CODE:${String(error)}`,
  )
}
