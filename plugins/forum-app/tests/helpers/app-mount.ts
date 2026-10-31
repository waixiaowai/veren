/**
 * 论坛应用层组合测试的共享夹具：临时存储根、记录型 agent、真实全栈挂载
 * （真实存储栈 + 真实宿主服务 + 带镜像缝的真实注册表 + 应用插件），以及
 * 一次性挂载页面并等首屏落地的 mountPage。
 * Shared fixtures of the forum application composition specs: the temp storage
 * root, the recording agent, the full real stack mount (real storage + the real
 * host service + real registries with the mirror seam + the app plugin), and
 * mountPage — the one-shot page mount that waits for the first screen.
 *
 * @module @veren/forum-app/tests/helpers/app-mount
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, vi } from 'vitest'
import { Context, type Fiber } from '@deepseek-ai/cordis'
import { AppRegistryService } from '@veren/app-registry'
import { PageRegistryService } from '@veren/page-registry'
import { defineComponentPage } from '@veren/prompt-page'
import type { ComponentPageMeta, PageFC, PageParams } from '@veren/prompt-page'
import { bindForumServices } from '../../src/pages.tsx'
import * as Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as ForumApp from '../../src/index.ts'
import { Config as AppConfig } from '../../src/index.ts'
import type { ForumToolsPort } from '@veren/forum'
import ForumService, { Config as HostConfig } from '@veren/forum'

/** The roots one spec's temp storage lives under; {@link disposeTrackedRoots} removes them. 每条用例的临时存储根，由 disposeTrackedRoots 删除。 */
const roots: string[] = []

/** Remove every temp storage root this spec file created. 删除本测试文件创建的全部临时存储根。 */
export function disposeTrackedRoots(): void {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
}

/** One temporary storage root, removed after the spec. 测试结束后删除的一个临时存储根目录。 */
export function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'forum-app-'))
  roots.push(root)
  return root
}

/** The live Agent a tool reads its caller from; any non-null stands for one. 工具读取调用者所依据的活 Agent。 */
export const AGENT = { ctx: {}, session: { header: { agentPreset: 'standard' } } }

/** One app tool as the specs drive it: only the face the calls need. 用例驱动的应用工具：只取调用所需的面。 */
export interface AppTool {
  readonly name: string
  execute(args: Record<string, unknown>, exec?: { agent?: unknown }): Promise<unknown>
}

/** The canonical value one tool call returns. 一次工具调用返回的规范值。 */
export function toolValue<T>(result: unknown): T {
  return result as T
}

/**
 * 假会话 agent：记录组件体直登的定义（页面的工具面断言源）。
 * A fake session agent: records the body's direct registrations (the assertion
 * source of a page's tool face).
 */
export function fakeAgent() {
  const registered: Array<{ name: string; definition: unknown }> = []
  const followups: string[] = []
  const agent = {
    ctx: {
      tools: {
        register: (definition: { name: string }) => {
          registered.push({ name: definition.name, definition })
          return () => undefined
        },
      },
      effect: (run: () => unknown) => { void run(); return async () => undefined },
      on: () => () => undefined,
    },
    session: { id: 'spec' },
    followup: (message: { content: ReadonlyArray<{ type: string; text?: string }> }) => {
      followups.push(...message.content.map((block) => block.text ?? ''))
    },
  }
  return { agent: agent as never, registered, followups }
}

/** 记录型 agent（一次构造，多处使用）/ a recording agent (built once, used everywhere) */
export interface ForumFixture {
  registered: Array<{ name: string; definition: unknown }>
  agent: never
}

/** 绑定装配槽位（真 ctx + 真 port）并挂一只记录型 agent：组件是模块级的，
 * 依赖经 bindForumServices 进槽位，体里经 agent.ctx 解析服务
 * / bind the assembly slot (real ctx + port) and hold a recording agent: the
 * components are module-level; dependencies enter via bindForumServices and the
 * bodies resolve services through agent.ctx */
export function makeFixture(ctx: Context, port: () => ForumToolsPort): ForumFixture {
  bindForumServices(ctx, port)
  const { agent, registered } = fakeAgent()
  return { registered, agent }
}

/** 按本地名取组件体登记的全名定义（exec 与名字无关，测试直呼无碍）
 * / a body-registered full-named definition by local name (execute ignores the name) */
export function toolOf(fixture: ForumFixture, localName: string): AppTool {
  const found = fixture.registered.find((entry) => entry.name === `forum__${localName}`)
  if (found === undefined) throw new Error(`tool forum__${localName} was not registered by the page bodies`)
  return found.definition as AppTool
}

/**
 * 挂载真实页面组件（一次性渲染）并等首屏落地：正文是静态框（立即成型），
 * 首屏数据由组件体自己的 effect 异步读出、经 followup 送达——与生产同一条路，
 * 零工厂、零闭包注入。返回正文与首屏消息。
 * Mount a real page component (one-shot) and wait for the first screen to land:
 * the body is the static frame (finalized at once), the first-screen data is
 * read by the body's own effect and delivered via followup — the same path as
 * production, zero factory, zero closures. Returns the body plus the
 * first-screen messages.
 */
export async function mountPage(
  component: (props: never, agent: never) => unknown,
  meta: ComponentPageMeta<never>,
  port: () => ForumToolsPort,
  params: PageParams = {},
): Promise<{ body: string; followups: string[] }> {
  const fixture = fakeAgent()
  const body = defineComponentPage(component as PageFC, meta as ComponentPageMeta).live.mount(params, fixture.agent)
  await vi.waitFor(() => expect(fixture.followups.length).toBeGreaterThan(0))
  return { body, followups: fixture.followups }
}

/** The captured `ctx.tools` registry + the base service doubles the specs provide. 被捕获的 ctx.tools 注册表 + 用例提供的的基础服务替身。 */
function provideBaseServices(ctx: Context, tools: Map<string, AppTool>): void {
  ctx.provide('tools', {
    register(tool: AppTool) {
      tools.set(tool.name, tool)
      return () => { tools.delete(tool.name) }
    },
  } as unknown as Context['tools'])
  ctx.provide('agents', { get: () => undefined })
  ctx.provide('sessions', { flush: async () => true })
  ctx.provide('systemPrompt', { context: () => () => {} })
  ctx.provide('agentPresets', {
    list: async () => [{ id: 'standard', name: 'standard' }],
    composedPreset: () => 'standard',
  })
  ctx.provide('llm', {})
  ctx.provide('agentDefaultModel', { currentSelection: () => undefined })
  ctx.provide('workingDirectory', { get: () => 'C:/work/demo' })
  ctx.provide('workspaceRegistry', { list: () => [{ id: 'ws-1', path: 'C:/work/demo', title: 'Demo' }] })
}

/** Real storage + the real task center, over a fresh temp root. 全新临时根上的真实存储与真实任务中心。 */
async function mountStorageAndTaskCenter(ctx: Context): Promise<void> {
  await ctx.plugin(Storage.default)
  await ctx.plugin(StorageJson, { root: tempRoot() })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  // 真实任务中心：页面作用域完成回报面（task_take/task_complete/task_fail）从它构建
  // / the real task center: the page-scoped completion face builds on it
  const TaskCenter = (await import('@veren/task-center')).default
  await ctx.plugin(TaskCenter)
}

/** The real registries plus the mirror seam, wired exactly as the real host
 * assembly (app-host) does. 真实注册表加镜像缝，与真实宿主装配（app-host）完全一致地接上。 */
function wireRegistries(ctx: Context): { apps: AppRegistryService; pageRegistry: PageRegistryService } {
  const apps = new AppRegistryService(new Context())
  const pageRegistry = new PageRegistryService(new Context())
  ctx.provide('apps', apps)
  ctx.provide('pageRegistry', pageRegistry)
  apps.setPageMirror({
    registerAppPage: (appId, page, live) => pageRegistry.registerAppPage(appId, page, live),
    releaseApp: appId => pageRegistry.releaseApp(appId),
  })
  return { apps, pageRegistry }
}

/**
 * Mount the full stack: real storage, the real host service (with the same
 * minimal service doubles the host suite uses), the real registries with the
 * mirror seam, and the app plugin on top.
 * 挂全栈：真实存储、真实宿主服务（复用宿主套件的最小服务替身）、带镜像缝的真实注册表，
 * 以及其上的应用插件。
 */
export async function mount(): Promise<{
  ctx: Context
  fiber: Fiber
  apps: AppRegistryService
  pageRegistry: PageRegistryService
  port: () => ForumToolsPort
}> {
  const ctx = new Context()
  provideBaseServices(ctx, new Map<string, AppTool>())
  await mountStorageAndTaskCenter(ctx)

  // The host service, resolved the way the plugin manager resolves config.
  // 宿主服务，配置按插件管理器的方式解析。
  const hostFiber = ctx.plugin(ForumService, HostConfig({}) as Parameters<typeof HostConfig>[0])
  await hostFiber

  const { apps, pageRegistry } = wireRegistries(ctx)
  const fiber = ctx.plugin(ForumApp, AppConfig({ reserved: false }))
  await fiber
  return { ctx, fiber, apps, pageRegistry, port: () => ctx.forum.toolsPort() }
}
