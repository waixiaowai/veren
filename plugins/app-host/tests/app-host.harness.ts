/**
 * 装配测试 harness：真实 cordis 装配 + 真实 storage 栈（json backend，临时目录）
 * + 真实 PageSessionPort 接线路径；`ctx.sessions` / `ctx.agents` 用最小结构面
 * 替身（见 host-sessions.harness）。附带一个 §3.10 合规的迷你应用夹具。
 * The assembly test harness: a real cordis assembly + a real storage stack
 * (json backend, temp dirs) + the real PageSessionPort wiring path; ctx.sessions
 * / ctx.agents are minimal structural stubs (see host-sessions.harness). Ships
 * a §3.10-compliant mini app fixture.
 *
 * 未做：完整 DSH profile 启动（需要测试节点安装，归 H/部署侧），因此
 * ToolRuntime 的 scope 层不在本测试覆盖内。
 * Not covered: a full DSH profile boot (needs a test node install; owned by
 * H/deployment), so ToolRuntime's scope layer is out of scope here.
 * @module tests/app-host.harness
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import * as Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { createElement } from '@veren/prompt-core'
import AppRegistryPlugin from '@veren/app-registry'
import type { AppId, PageKey, AppRegistryService } from '@veren/app-registry'
import PageRegistryPlugin from '@veren/page-registry'
import type { PageRegistryService } from '@veren/page-registry'
import TaskCenterPlugin from '@veren/task-center'
import type { TaskCenterService } from '@veren/task-center'
import { apply, Config, inject, name } from '../src/index.ts'
import { makeHostSessions } from './host-sessions.harness.ts'

// ---- 临时目录与卸载登记：每个用例结束后逆序清理（vitest 按文件隔离模块状态） ----
// ---- Temp roots + disposal registry: reverse-order cleanup per test (vitest isolates module state per file) ----

const roots: string[] = []
const made: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const dispose of made.reverse()) await dispose()
  made.length = 0
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** 建一个用例私有的临时根目录（afterEach 统一删除）/ one temp root per case (removed by afterEach) */
export function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'app-host-'))
  roots.push(root)
  return root
}

export interface Boot {
  ctx: Context
  host: ReturnType<typeof makeHostSessions>
  pages: PageRegistryService
  tasks: TaskCenterService
  /** 替身会话表（session/title 落盘断言用）/ stub session table for the title assertions */
  sessions: ReturnType<typeof makeHostSessions>['sessions']
  /** 只卸载 app-host 装配层（storage 栈不动）/ dispose only the app-host assembly fiber */
  disposeAssembly(): Promise<void>
  dispose(): Promise<void>
}

/** 起真实 storage 栈：json backend + storage 域，根目录用例私有 / boot the real storage stack: json backend + the storage domain */
async function bootStorage(ctx: Context): Promise<Array<{ dispose(): Promise<void> }>> {
  const storageFiber = await ctx.plugin(Storage.default)
  const jsonFiber = await ctx.plugin(StorageJson, { root: tempRoot() })
  const domainFiber = await ctx.plugin(StorageDomain, { backend: 'json' })
  return [domainFiber, jsonFiber, storageFiber]
}

/** warm-up：等 storage 域就绪（listByApp 不再抛错）/ wait for the storage domain to settle */
async function warmUpStorage(pages: PageRegistryService): Promise<void> {
  for (let i = 0; i < 100; i += 1) {
    try {
      await pages.instances.listByApp('warm-up')
      break
    } catch { await new Promise((resolve) => setTimeout(resolve, 10)) }
  }
}

/**
 * 起一套真实装配：storage 三件套 + 三个服务插件 + app-host 装配层。
 * Boot one real assembly: the storage trio + the three service plugins + the
 * app-host assembly layer.
 */
export async function boot(options: { enabled?: boolean; failTool?: string } = {}): Promise<Boot> {
  const ctx = new Context()
  const host = makeHostSessions(ctx, options.failTool)
  const storageFibers = await bootStorage(ctx)
  await ctx.plugin(AppRegistryPlugin)
  await ctx.plugin(PageRegistryPlugin)
  await ctx.plugin(TaskCenterPlugin)
  const fh = await ctx.plugin({ name, inject, apply, Config }, { enabled: options.enabled ?? true })
  await fh.await()
  const pages = ctx.pageRegistry
  await warmUpStorage(pages)
  const dispose = async (): Promise<void> => {
    for (const fiber of storageFibers) await fiber.dispose().catch(() => undefined)
  }
  made.push(dispose)
  return {
    ctx,
    host,
    pages,
    tasks: ctx.taskCenter,
    sessions: host.sessions,
    disposeAssembly: () => fh.dispose(),
    dispose,
  }
}

/** 迷你应用的工具夹具（组件体在唯一一次渲染里直登全名工具——构建器只是夹具）
 * / the mini app's tool fixtures (bodies register full-named tools in the one
 * render — the builders are fixtures only) */
function miniFixtures(): { readTool: () => ReturnType<typeof defineTool>; writeTool: () => ReturnType<typeof defineTool> } {
  const readTool = () => defineTool({
    name: 'mini__read',
    description: '读取材料',
    parameters: {},
    output: { schema: { type: 'object', additionalProperties: true } as const, render: () => [] },
    execute: async () => ({ ok: true }),
  })
  // 写工具：二级页规则 3 要求详情页至少登记一个写工具 / the write tool: rule 3 wants a write tool recorded on the detail page
  const writeTool = () => defineTool({
    name: 'mini__write',
    description: '写入材料。Parameters: text.',
    parameters: { text: { type: 'string', required: true, description: '要写入的文本' } },
    output: { schema: { type: 'object', additionalProperties: true } as const, render: () => [] },
    execute: async () => ({ ok: true }),
  })
  return { readTool, writeTool }
}

/** 事件页：`agent.ctx.on` 注册在该会话的 agent 作用域（跨会话隔离断言）
 * / the events page: `agent.ctx.on` registers on that session's agent scope (cross-session isolation) */
function registerEventsPage(pages: ReturnType<AppRegistryService['pages']>, deliveries: string[]): void {
  pages.register(
    (_props: Record<string, string>, agent) => {
      agent.ctx.on('agent/status', (payload: unknown) => {
        const status = (payload as { status?: string }).status
        if (status !== undefined) deliveries.push(status)
      })
      return createElement('p', { children: '事件页' })
    },
    { url: '/apps/mini/events/:id', description: '事件页', instructions: '事件页：只报事件。' },
  )
}

/** 一级页（entry）：map 由注册表推导（§3.5 定案），首页也登记一个只读工具
 * / the home page (entry): the map is registry-derived (§3.5); it records one read tool too ("pick = open") */
function registerListPage(pages: ReturnType<AppRegistryService['pages']>, readTool: () => ReturnType<typeof defineTool>): void {
  pages.register(
    (_props: { id?: string }, agent) => {
      agent.ctx.tools.register(readTool())
      return createElement('p', { children: `任务 ${_props.id ?? ''}` })
    },
    { url: '/apps/mini/list', description: '任务列表页', instructions: '这是 mini 应用的首页：看列表，去详情。' },
  )
}

/** 二级页：带参数 + writes + 说明；工具与单会话 skill 都在组件体直登（随 agent fiber 生灭）
 * / the detail page: params + writes + instructions; tools and the single-session skill register in the body */
function registerDetailPage(
  pages: ReturnType<AppRegistryService['pages']>,
  readTool: () => ReturnType<typeof defineTool>,
  writeTool: () => ReturnType<typeof defineTool>,
): void {
  pages.register(
    (_props: { id?: string }, agent) => {
      agent.ctx.tools.register(readTool())
      agent.ctx.tools.register(writeTool())
      agent.ctx.skills.register({ name: 'mini-skill', description: '任务页专属技能', content: '# mini skill\n只在任务页可见。', source: 'runtime' })
      return createElement('p', { children: `任务 ${_props.id ?? ''}` })
    },
    {
      url: '/apps/mini/task/:id',
      description: '任务页',
      writes: true,
      instructions: '只处理 params.id 指定的这一条任务。',
    },
  )
}

/**
 * 迷你应用：两级页面（一级首页 + 参数化详情 + 事件页）+ 一读一写两个工具
 * （§3.10 合规夹具）。工具只在页面存在（设计律）：注册动作发生在每个页面的
 * 组件体里。
 * The mini app: two levels (a home page + a parameterized detail + an events
 * page) and one read + one write tool (a §3.10-compliant fixture). A tool
 * exists only inside a page (design law): registration happens in the bodies.
 * @param h - 已启动的装配 / the booted assembly
 * @param eventDeliveries - 事件页 agent.ctx.on 的收集面 / the events page's collection face
 */
export function registerMiniApp(h: Boot, eventDeliveries: string[] = []): void {
  const { ctx } = h
  const apps = ctx.apps
  apps.register({ id: 'mini' as AppId, name: 'mini', description: '装配层验证应用', entry: 'list' as PageKey }, ctx)
  const { readTool, writeTool } = miniFixtures()
  const pages = apps.pages('mini' as AppId, ctx)
  registerEventsPage(pages, eventDeliveries)
  registerListPage(pages, readTool)
  registerDetailPage(pages, readTool, writeTool)
}
