/**
 * 组合测试的共享夹具：组件页三元组、假会话 agent、真实任务中心（内存后端，
 * 工具注册关闭）、工具夹具（harness），以及挂好真实注册表与应用插件的
 * install。与原单文件版本同缝——锁定目录可发现、入口 URL 可解析、三页 URL
 * 前缀、工具矩阵全名、同意门下的写流程、taskCenter 走显式 inject 的真实接缝、
 * 装配失败不留半接线。
 * Shared fixtures of the composition specs: the component-page triple, the
 * fake session agent, the real task center (in-memory backend, tool
 * registration off), the tooling harness, and install — real registries plus
 * the app plugin mounted. Same seams as the original single-file version.
 *
 * @module @veren/task-workbench/tests/helpers/composition
 */

import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import * as Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import AppRegistryPlugin, { AppRegistryService } from '@veren/app-registry'
import type { AppId } from '@veren/app-registry'
import PageRegistryPlugin, { PageRegistryService } from '@veren/page-registry'
import TaskCenterService from '@veren/task-center'
import { apply, inject, name } from '../../src/index.ts'
import { APP_ID, APP_DEFINITION } from '../../src/app.ts'
import { defineComponentPage } from '@veren/prompt-page'
import type { ComponentPageMeta, PageFC, PageParams } from '@veren/prompt-page'
import { bindWorkbenchRuntime } from '../../src/pages.tsx'
import { ListMeta, ListPage } from '../../src/page-list.tsx'
import { DetailMeta, DetailPage } from '../../src/page-detail.tsx'
import { PublishMeta, PublishPage } from '../../src/page-publish.tsx'
import { createAppTools } from '../../src/tools.ts'
import { createTaskChannel } from '../../src/channel.ts'
import type { TaskChannel } from '../../src/channel.ts'
import { ConsentBook, DriveLedger } from '../../src/consent.ts'
import { TaskStore } from '../../src/store.ts'
import type { PageTaskScope } from '../../src/types.ts'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { MemoryStorageBackend, mountMemoryBackend } from './fake-storage.ts'
import { fakeSession } from './consent-events.ts'

export { APP_ID, APP_DEFINITION }

/** 组件页工厂（一次性渲染形态）：组件与契约面成对导出
 * / the component-page factory (the one-shot form): components and contract faces ship as pairs */
export const listPage = { ...ListMeta, component: ListPage }
export const detailPage = { ...DetailMeta, component: DetailPage }
export const publishPage = { ...PublishMeta, component: PublishPage }

/** 假会话 agent：记录组件体直登的工具（页面工具面的断言源）
 * / a fake session agent: records the body's direct registrations (the assertion source of a page's tool face) */
export function fakeAgent() {
  const registered: string[] = []
  const agent = {
    ctx: {
      tools: { register: (definition: { name: string }) => { registered.push(definition.name); return () => undefined } },
      effect: () => async () => undefined,
      on: () => () => undefined,
    },
    session: fakeSession('spec'),
    followup: () => undefined,
  }
  return { agent: agent as never, registered }
}

/**
 * 起真实任务中心（内存后端，工具注册关闭）并返回工作台通道。
 * Boot the real task center (in-memory backend, tool registration off) and
 * return the workbench channel.
 */
export async function bootCenter(ctx: Context): Promise<TaskChannel> {
  await ctx.plugin(Storage.default)
  mountMemoryBackend(ctx, new MemoryStorageBackend())
  await ctx.plugin(StorageDomain, { backend: 'memory' })
  const service = new TaskCenterService(ctx, { tools: { enabled: false } })
  service.setAppResolver(async () => ({ state: 'active', version: '0.0.0' }))
  return createTaskChannel(service)
}

/** 共享夹具：真实中心 + 门/台账 + 按本地名取工具（写用例先武装用户回合）
 * / the shared harness: the real center + book/ledger + tools by local name (write cases arm a user turn first) */
export async function harness(): Promise<{
  channel: TaskChannel
  store: TaskStore
  book: ConsentBook
  ledger: DriveLedger
  toolOf(toolName: string): ToolDefinition
}> {
  const ctx = new Context()
  const channel = await bootCenter(ctx)
  const store = new TaskStore()
  const book = new ConsentBook()
  const ledger = new DriveLedger()
  const tools = createAppTools({
    store,
    channel,
    scope: { liveDetailTaskOf: async () => undefined } as PageTaskScope,
    book,
    ledger,
    catalog: () => [],
    openUrl: async (url: string) => ({ sessionId: 'nav-target', url, title: url }),
  })
  const toolOf = (toolName: string): ToolDefinition => {
    const found = tools.find((tool) => tool.name === toolName)
    if (found === undefined) throw new Error(`tool ${toolName} is not defined`)
    return found
  }
  return { channel, store, book, ledger, toolOf }
}

/** 全名工具（与 index.ts 的装配同一拼法）/ the full-named tools (same spelling as index.ts's wiring) */
export const testStore = new TaskStore()
export const testTools: ToolDefinition[] = createAppTools({
  store: testStore,
  channel: { list: async () => [] } as never,
  scope: { liveDetailTaskOf: async () => undefined } as PageTaskScope,
  book: new ConsentBook(),
  ledger: new DriveLedger(),
  catalog: () => [],
  openUrl: async (url: string) => ({ sessionId: 'x', url, title: url }),
}).map((tool) => ({ ...tool, name: `task_workbench__${tool.name}` }))
bindWorkbenchRuntime({ store: testStore, tools: testTools, catalog: () => [], channel: { list: async () => [] } as never, seedSize: 0 })

/** 本文件的卸载句柄（afterEach 由各 spec 注册）/ this file's disposal handles (each spec registers its own afterEach) */
const disposers: Array<() => Promise<void>> = []

/** 登记一个卸载句柄 / track one disposal handle */
export function trackDisposal(dispose: () => Promise<void>): void {
  disposers.push(dispose)
}

/** 逆序执行全部已登记的卸载句柄 / run every tracked disposal in reverse */
export async function disposeTracked(): Promise<void> {
  for (const dispose of disposers.reverse()) await dispose()
  disposers.length = 0
}

/** 挂好真实注册表与应用插件 / mount real registries plus the app plugin */
export async function install(): Promise<{
  ctx: Context
  apps: AppRegistryService
  pageRegistry: PageRegistryService
  fiber: Fiber
}> {
  const ctx = new Context()
  // 两个注册表服务挂在同一个宿主上下文上，镜像面由测试显式接上（app-host 语义）。
  // Both registries live on one host context; the mirror is wired explicitly
  // (app-host's semantics).
  const hostCtx = new Context()
  const apps = new AppRegistryService(hostCtx)
  const pageRegistry = new PageRegistryService(hostCtx)
  ctx.provide('apps', apps)
  ctx.provide('pageRegistry', pageRegistry)
  apps.setPageMirror({
    registerAppPage: (appId: never, page: never, live: never) => pageRegistry.registerAppPage(appId, page, live),
    releaseApp: (appId: never) => pageRegistry.releaseApp(appId),
  })
  // taskCenter 是插件的硬 inject：真实服务在 ctx 上激活（构造即注册为服务，
  // ctx.taskCenter 可解析；G13 后没有缺席降级）。
  // taskCenter is a hard inject: the real service activates on the ctx (the
  // constructor registers it under its name, so ctx.taskCenter resolves; no
  // post-G13 absent-degrade path exists).
  await bootCenter(ctx)
  const fiber = ctx.plugin({ name, inject, apply }, { listSize: 2 })
  await fiber
  return { ctx, apps, pageRegistry, fiber }
}
