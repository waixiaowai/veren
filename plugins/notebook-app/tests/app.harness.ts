/**
 * Shared harness for the notebook-app composition specs: one temporary
 * storage root and one mounted full stack per case (real storage, the real
 * `@veren/notebook` service, the real registries with the mirror seam), plus
 * the small drivers the specs assert through. Lifecycle cleanup runs newest
 * fiber first, then removes the temp roots.
 *
 * 记事本应用层组合测试的共享夹具：每条用例一份临时存储根与一套挂好的全栈（真实存储、
 * 真实 `@veren/notebook` 服务、接好镜像缝的真实注册表），以及用例断言所经的小驱动。
 * 生命周期清理先逆序拆 fiber，再删除临时根目录。
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach } from 'vitest'
import { Context, type Fiber } from '@deepseek-ai/cordis'
import { AppRegistryService } from '@veren/app-registry'
import { PageRegistryService } from '@veren/page-registry'
import * as Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as NotebookApp from '../src/index.ts'
import { Config as AppConfig } from '../src/index.ts'
import { defineComponentPage } from '@veren/prompt-page'
import NotebookService, { Config as HostConfig } from '@veren/notebook'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'

/** The roots one spec's temp storage lives under, removed after the spec. 每条用例的临时存储根，测后删除。 */
const roots: string[] = []

/** Fibers mounted by one test, disposed newest-first after it. 一条用例挂的 fiber，测后逆序拆除。 */
const fibers: Fiber[] = []

afterEach(async () => {
  for (const fiber of fibers.reverse()) await fiber.dispose()
  fibers.length = 0
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** One temporary storage root, removed after the spec. 测试结束后删除的一个临时存储根目录。 */
export function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'notebook-app-'))
  roots.push(root)
  return root
}

/**
 * Mount the full stack: real storage, the real notebook service, and the real
 * registries with the mirror seam wired exactly as the host assembly does.
 * 挂全栈：真实存储、真实记事本服务，以及与真实宿主装配完全一致地接好镜像缝的真实注册表。
 */
export async function mount(): Promise<{
  ctx: Context
  fiber: Fiber
  apps: AppRegistryService
  pageRegistry: PageRegistryService
}> {
  const ctx = new Context()
  // 页面工具经这一服务面解析调用者的预设。
  // The page tools resolve their caller's preset through this face.
  ctx.provide('agentPresets', {
    list: async () => [],
    composedPreset: (agentContext: { preset?: string }) => agentContext.preset,
  })
  // 任务中心声明 inject ['storageDomain','tools']：宿主工具注册表的最小替身
  // / task center declares inject ['storageDomain','tools']: a minimal host tool-registry stand-in
  ctx.provide('tools', {
    register: () => () => undefined,
  })
  await ctx.plugin(Storage.default)
  await ctx.plugin(StorageJson, { root: tempRoot() })
  await ctx.plugin(StorageDomain, { backend: 'json' })
  // 真实任务中心：页面作用域完成回报面（task_take/task_complete/task_fail）从它构建
  // / the real task center: the page-scoped completion face builds on it
  const TaskCenter = (await import('@veren/task-center')).default
  fibers.push(await ctx.plugin(TaskCenter))
  // 宿主服务，配置按插件管理器的方式解析（0.2.0 起无配置项）。
  // The host service, config resolved the way the plugin manager resolves it (no options since 0.2.0).
  fibers.push(await ctx.plugin(NotebookService, HostConfig({})))

  // The real registries plus the mirror seam, wired exactly as the real host
  // assembly (app-host) does.
  // 真实注册表加镜像缝，与真实宿主装配（app-host）完全一致地接上。
  const apps = new AppRegistryService(new Context())
  const pageRegistry = new PageRegistryService(new Context())
  ctx.provide('apps', apps)
  ctx.provide('pageRegistry', pageRegistry)
  apps.setPageMirror({
    registerAppPage: (appId, page, live) => pageRegistry.registerAppPage(appId, page, live),
    releaseApp: appId => pageRegistry.releaseApp(appId),
  })

  const fiber = await ctx.plugin(NotebookApp, AppConfig({}))
  fibers.push(fiber)
  return { ctx, fiber, apps, pageRegistry }
}

/** The execution context one tool call carries. 一次工具调用携带的执行上下文。 */
export function execution(preset: string): { agent: unknown } {
  return { agent: { ctx: { preset }, session: { header: { agentPreset: preset } } } }
}

/**
 * 假会话 agent：记录组件体直登的定义与首屏 followup（工具面与首屏的断言源）。
 * A fake session agent: records the body's direct registrations and first-screen
 * followups (the assertion source of the tool face and the first screen).
 */
export function fakeAgent(preset?: string) {
  const registered: string[] = []
  const followups: string[] = []
  const agent = {
    ctx: {
      tools: { register: (definition: { name: string }) => { registered.push(definition.name); return () => undefined } },
      effect: (run: () => unknown) => { void run(); return async () => undefined },
      on: () => () => undefined,
    },
    session: { id: 'spec', ...(preset === undefined ? {} : { header: { agentPreset: preset } }) },
    followup: (message: { content: ReadonlyArray<{ type: string; text?: string }> }) => {
      followups.push(...message.content.map((block) => block.text ?? ''))
    },
  }
  return { agent: agent as never, registered, followups }
}

/** 挂一页并返回正文与登记名（一次性渲染；快照通道已随 load 退役）
 * / mount one page, returning the body and the registered names (the snapshot channel died with load) */
export function mountPage(
  page: (props: never, agent: never) => unknown,
  meta: object,
  tools: readonly ToolDefinition[],
  params: Record<string, string> = {},
): { body: string; registered: string[] } {
  const { agent, registered } = fakeAgent()
  void tools
  const body = defineComponentPage(page as never, meta as never).live.mount(params, agent)
  return { body, registered }
}

/** The canonical value one tool call returns. 一次工具调用返回的规范值。 */
export function toolValue<T>(result: unknown): T {
  return result as T
}

/** 说明里是否点名了该工具（词边界匹配，避免 rewrite_note 被误当 write_note）。 */
/** Whether the instructions name the tool (word-bounded, so rewrite_note does not count as write_note). */
export function names(instructions: string, tool: string): boolean {
  return new RegExp(`(?<![\\w])${tool}(?![\\w])`).test(instructions)
}

/** One app tool as the specs drive it: only the face the calls need. 用例驱动的应用工具：只取调用所需的面。 */
export interface AppTool {
  readonly name: string
  execute(args: unknown, exec: unknown): Promise<unknown>
}

/** The app tools in registration order. 按注册顺序的应用工具名。 */
export const TOOL_NAMES = ['list_notes', 'read_note', 'write_note', 'rewrite_note', 'delete_note']
