/**
 * 第 1 阶段验收（docs/application-concept.cn.md §8.1 八场景）。
 * Phase-1 acceptance: the eight §8.1 scenarios end to end.
 *
 * 与 page-registry 单测里的"内存 KV 重启"不同：这里场景 2/3/4 走**真实持久化
 * 文件**——真实 storage 栈（json backend）落在临时目录，会话目录也是落盘的
 * JSON 文件；"重启" = 整个 Context（含存储栈）销毁后在新 Context 上重开同一
 * 个目录。没有内存假替身。
 * Unlike the in-memory-kv "restart" in page-registry unit tests, scenarios
 * 2/3/4 here use real persisted files: the real storage stack (json backend)
 * under a temp dir, plus a file-backed session directory; "restart" = dispose
 * the whole Context (storage stack included) and boot a fresh one on the same
 * dir. No in-memory stand-ins.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import * as Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import AppRegistryPlugin from '@veren/app-registry'
import type { AppRegistryService } from '@veren/app-registry'
import PageRegistryPlugin from '@veren/page-registry'
import type { PageRegistryService } from '@veren/page-registry'
import TaskCenterPlugin from '@veren/task-center'
import type { TaskCenterService } from '@veren/task-center'
import type { AppId, PageKey } from '@veren/app-registry'
import type { PageInstanceKey } from '@veren/prompt-page'
import { apply, inject, name as workbenchName } from '../src/index.ts'

// ---- 落盘的会话目录（DSH 会话系统的最小替身，但状态在文件里）----
// ---- The file-backed session directory (a minimal DSH-session stand-in whose state lives on disk) ----

interface SessionFile {
  sessions: Record<string, { title: string; messages: string[]; alive: boolean }>
}

/** 会话目录：JSON 文件落盘；agent.followup 追加消息并立即写回。 */
class FileSessionStore {
  private readonly data: SessionFile = { sessions: {} }

  constructor(readonly file: string) {
    if (existsSync(file)) this.data.sessions = JSON.parse(readFileSync(file, 'utf8')) as SessionFile['sessions']
  }

  private save(): void {
    writeFileSync(this.file, JSON.stringify(this.data.sessions, null, 2))
  }

  alive(id: string): boolean {
    return this.data.sessions[id]?.alive === true
  }

  messages(id: string): readonly string[] {
    return this.data.sessions[id]?.messages ?? []
  }

  titles(): readonly string[] {
    return Object.values(this.data.sessions).map((row) => row.title)
  }

  /** 宿主 `sessions` 服务的最小面 / the minimal host `sessions` face */
  readonly dsh = {
    get: (id: string) => (this.alive(id) ? { dispose: () => { this.data.sessions[id]!.alive = false; this.save() } } : undefined),
    create: (id: string, title?: string) => {
      this.data.sessions[id] = { title: title ?? id, messages: [], alive: true }
      this.save()
    },
  }

  /** 宿主 `agents` 服务的最小面 / the minimal host `agents` face */
  readonly agents = {
    get: (id: string) => (this.alive(id)
      ? { followup: (message: { content: Array<{ type: string; text?: string }> }) => {
          const text = message.content.map((block) => block.text ?? '').join('')
          this.data.sessions[id]!.messages.push(text)
          this.save()
        } }
      : undefined),
  }
}

// ---- 组装 / assembly ----

const roots: string[] = []
const made: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const dispose of made.reverse()) await dispose().catch(() => undefined)
  made.length = 0
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'phase1-acceptance-'))
  roots.push(root)
  return root
}

interface Boot {
  ctx: Context
  store: FileSessionStore
  tools: Map<string, { name: string }>
  apps: AppRegistryService
  pages: PageRegistryService
  tasks: TaskCenterService
  wb: Fiber
}

/** provide 的宽松封装（测试桩不需要 InjectKey 精确类型）/ loose provide for test stubs */
function provideStub(ctx: Context, name: string, value: unknown): void {
  ;(ctx.provide as unknown as (n: string, v: unknown) => void)(name, value)
}

/**
 * 起一套完整宿主：真实存储栈（json backend → 临时目录）+ 四个插件 +
 * 落盘会话目录。返回的 stop() 按依赖逆序销毁每个 fiber。
 */
async function boot(root: string): Promise<Boot & { stop(): Promise<void> }> {
  const ctx = new Context()
  const store = new FileSessionStore(join(root, 'sessions.json'))
  // 工具注册表替身：register 记录，disposer 摘除（真实释放语义）
  const tools = new Map<string, { name: string }>()
  provideStub(ctx, 'tools', {
    register: (tool: { name: string }) => {
      tools.set(tool.name, tool)
      return () => { tools.delete(tool.name) }
    },
  })
  provideStub(ctx, 'sessions', store.dsh)
  provideStub(ctx, 'agents', store.agents)
  const storageFiber = await ctx.plugin(Storage.default)
  const jsonFiber = await ctx.plugin(StorageJson, { root })
  const domainFiber = await ctx.plugin(StorageDomain, { backend: 'json' })
  await ctx.plugin(AppRegistryPlugin)
  await ctx.plugin(PageRegistryPlugin)
  await ctx.plugin(TaskCenterPlugin)
  const wb = await ctx.plugin({ name: workbenchName, inject, apply }, { listSize: 3 })
  const pages = ctx.pageRegistry
  // 域打开是异步的：等索引就绪（lookup 不再是失败索引）
  for (let i = 0; i < 100; i += 1) {
    try {
      await pages.instances.listByApp('warm-up')
      break
    } catch { await new Promise((resolve) => setTimeout(resolve, 10)) }
  }
  const stop = async (): Promise<void> => {
    for (const fiber of [wb, domainFiber, jsonFiber, storageFiber]) {
      await fiber.dispose().catch(() => undefined)
    }
  }
  made.push(stop)
  return { ctx, store, tools, apps: ctx.apps, pages, tasks: ctx.taskCenter, wb, stop }
}

/** 打开应用详情页 URL 的便捷封装 / open a detail-page url */
function open(pages: PageRegistryService, taskId: string, options: { taskId?: string } = {}) {
  return pages.openUrl(`/apps/task-workbench/task/${taskId}` as PageInstanceKey, options)
}

const errorCode = (promise: Promise<unknown>): Promise<string> => promise.then(
  () => { throw new Error('expected rejection') },
  (error: { code?: string }) => error.code ?? `NO_CODE:${String(error)}`,
)

// ---- 场景 1 ----

describe('场景 1：装示例应用 → 可发现、入口可解析、预设零新增', () => {
  it('app 目录含 task-workbench；入口 URL 可解析；没有 presets 服务/条目', async () => {
    const { ctx, apps, pages } = await boot(tempRoot())
    const record = apps.catalog().find((app) => app.definition.id === 'task-workbench')
    expect(record?.state).toBe('active')
    expect(record?.toolPrefix).toBe('task_workbench')
    // 入口 URL 可被 openUrl 解析（解析 = 建实例会话成功）
    const opened = await pages.openUrl('/apps/task-workbench/list')
    expect(opened.created).toBe(true)
    // 预设选择器零新增：装配里不存在 presets 服务；四个插件的注册路径全部
    // 走 ctx.apps / ctx.pageRegistry / ctx.taskCenter，没有任何预设注册调用
    // （grep 层面见 docs/phase1-acceptance.cn.md 的核对记录）。
    expect(ctx.get('presets' as never)).toBeUndefined()
  })
})

// ---- 场景 2 ----

describe('场景 2：/task/1 → 会话 A；/task/2 → 会话 B；A 原样保留', () => {
  it('两条 URL 两条会话；A 的工具和消息不被 B 影响', async () => {
    const { pages, tools, store } = await boot(tempRoot())
    const a = await open(pages, '1')
    const b = await open(pages, '2')
    expect(a.created && b.created).toBe(true)
    expect(a.sessionId).not.toBe(b.sessionId)
    expect(store.titles()).toContain('任务 #1')
    // A 的工具仍挂着（键 = task_workbench__* 且带会话分组的实现按名字记录）
    expect([...tools.keys()].filter((name) => name.startsWith('task_workbench__')).length).toBeGreaterThan(0)
    // A 的 PAGE 块还在
    expect(store.messages(a.sessionId).some((m) => m.startsWith('PAGE detail'))).toBe(true)
  })
})

// ---- 场景 3 ----

describe('场景 3：整机重启（真实落盘）→ /task/1 回到会话 A', () => {
  it('销毁整个 Context（含存储栈）后重开同一目录：索引命中、会话复用、工具重挂', async () => {
    const root = tempRoot()
    const first = await boot(root)
    const a = await open(first.pages, '1')
    await first.stop() // 真实销毁：存储域关闭、fiber 逆序卸载

    const second = await boot(root) // 同一目录重开 = 重启后的宿主
    const reopened = await open(second.pages, '1')
    expect(reopened.created).toBe(false)
    expect(reopened.sessionId).toBe(a.sessionId)
    expect(second.store.messages(a.sessionId).some((m) => m.startsWith('PAGE detail'))).toBe(true)
    // 工具不持久化（§7.5）：重启后打开时重挂，页面工具再次可见
    expect([...second.tools.keys()].filter((name) => name.startsWith('task_workbench__')).length).toBeGreaterThan(0)
  })
})

// ---- 场景 4 ----

describe('场景 4：删除会话 A → /task/1 重建新会话，工具正常', () => {
  it('索引失效、重建会话 C；旧会话消失', async () => {
    const { pages, store, tools } = await boot(tempRoot())
    const a = await open(pages, '1')
    store.dsh.get(a.sessionId)!.dispose() // 用户删除会话 A（落盘）
    const c = await open(pages, '1')
    expect(c.created).toBe(true)
    expect(c.sessionId).not.toBe(a.sessionId)
    expect(store.alive(a.sessionId)).toBe(false)
    expect(store.alive(c.sessionId)).toBe(true)
    expect([...tools.keys()].filter((name) => name.startsWith('task_workbench__')).length).toBeGreaterThan(0)
  })
})

// ---- 场景 5 ----

describe('场景 5：两个应用同名工具 → 不同前缀共存', () => {
  it('同名本地工具以 <toolPrefix>__ 同时可见，互不覆盖', async () => {
    const { ctx, apps, pages, tools } = await boot(tempRoot())
    // 第二个应用：同名工具 take_task，页面 /apps/other-app/task/:taskId
    const { defineAppPage } = await import('@veren/prompt-page')
    apps.register({ id: 'other-app' as AppId, name: '另一个应用', description: '同名工具共存验证', entry: 'task' as PageKey }, ctx)
    const otherTools = apps.tools('other-app' as AppId, ctx)
    // defineTool 产物进目录（与本应用同一正路）/ defineTool product, same path as the host app
    const { defineTool } = await import('@deepseek-ai/dsh-tools')
    otherTools.define(defineTool({
      name: 'take_task', description: '另一个应用的 take_task', parameters: {},
      output: { schema: { type: 'object', additionalProperties: true } as const, render: () => [] },
      execute: async () => ({ ok: true }),
    }))
    const otherPages = apps.pages('other-app' as AppId, ctx)
    otherPages.register(defineAppPage({
      name: 'task', url: '/apps/other-app/task/:taskId', description: '另一应用任务页',
      tools: ['take_task'], pageRevision: 1, tree: () => [],
    }) as never)
    const a = await open(pages, '1')
    const b = await pages.openUrl('/apps/other-app/task/1')
    const names = [...tools.keys()]
    // 详情页挂 complete_task/abandon_task；另一应用挂自己的 take_task——前缀共存
    expect(names).toContain('task_workbench__complete_task')
    expect(names).toContain('other_app__take_task')
    // DSH ToolDefinition 本体直达模型侧：output 契约字段未在挂载路上丢失
    const mounted = tools.get('task_workbench__complete_task') as unknown as import('@deepseek-ai/dsh-tools').ToolDefinition
    expect(mounted?.output?.schema).toBeDefined()
    expect(mounted?.presentCall).toBeTypeOf('function')
    expect(mounted?.name).toBe('task_workbench__complete_task')
    expect(a.sessionId).not.toBe(b.sessionId)
  })
})

// ---- 场景 6 ----

describe('场景 6：发任务 → 通知进会话 → app_open 接取 → 完成 → 应用收到 task/completed', () => {
  it('端到端闭环：投递文本正确、TASK 块、完成事件', async () => {
    const { ctx, pages, tasks, store } = await boot(tempRoot())
    const completed: Array<{ taskId: string; appId: string }> = []
    ;(ctx.on as unknown as (event: string, listener: (payload: unknown) => void) => void)(
      'task-center/completed',
      (payload: unknown) => { completed.push(payload as { taskId: string; appId: string }) },
    )
    const record = await tasks.send({
      kind: 'task-workbench/publish' as never,
      title: '审阅 PR #42 的错误处理',
      target: {
        url: '/apps/task-workbench/task/1' as PageInstanceKey,
        appId: 'task-workbench', page: 'detail', params: { taskId: '1' },
      },
    })
    // 通知还没进任何会话（尚未打开页面）
    const opened = await open(pages, '1', { taskId: record.id })
    // 活会话收到通知：投递泵把渲染好的文本注进了刚建的页面会话
    const messages = store.messages(opened.sessionId)
    const notice = messages.find((m) => m.includes('[task-center]'))
    expect(notice).toBeDefined()
    expect(notice).toContain('审阅 PR #42 的错误处理')
    expect(notice).toContain('/apps/task-workbench/task/1')
    // 通知已回报 delivered
    const after = await tasks.get(record.id)
    expect(after?.status).toBe('taken') // openUrl 带 taskId → 先 take 再写 TASK 块
    expect(messages.some((m) => m.startsWith(`TASK ${record.id}`))).toBe(true)
    // 完成 → 应用收到 task/completed
    await tasks.complete(record.id, { summary: '已审阅，两处建议补充边界检查' })
    expect(completed).toMatchObject([{ taskId: record.id, appId: 'task-workbench' }])
  })
})

// ---- 场景 7 ----

describe('场景 7：任务过期 → task/expired；应用禁用 → app/disabled', () => {
  it('过期任务打开被拒；禁用应用后页面打不开', async () => {
    const { apps, pages, tasks } = await boot(tempRoot())
    const record = await tasks.send({
      kind: 'task-workbench/publish' as never,
      title: '会过期的任务',
      target: { url: '/apps/task-workbench/task/2' as PageInstanceKey, appId: 'task-workbench', page: 'detail', params: { taskId: '2' } },
      expiresAt: new Date(Date.now() + 30).toISOString(),
    })
    await new Promise((resolve) => setTimeout(resolve, 60))
    expect((await tasks.get(record.id))?.status).toBe('expired')
    expect(await errorCode(open(pages, '2', { taskId: record.id }))).toBe('task/expired')
    apps.disable('task-workbench' as AppId)
    expect(await errorCode(open(pages, '2'))).toBe('app/disabled')
    // 禁用的应用不能再发任务（resolver 生效）
    expect(await errorCode(tasks.send({
      kind: 'task-workbench/publish' as never,
      title: '禁用后发送',
      target: { url: '/apps/task-workbench/task/3' as PageInstanceKey, appId: 'task-workbench', page: 'detail', params: { taskId: '3' } },
    }))).toBe('task/send-forbidden')
  })
})

// ---- 场景 8 ----

describe('场景 8：卸载 → 工具摘掉、会话保留、任务 orphaned；重装后工具恢复', () => {
  it('fiber 销毁执行全部卸载语义；重装后同一会话可继续工作', async () => {
    const root = tempRoot()
    const first = await boot(root)
    const a = await open(first.pages, '1')
    const record = await first.tasks.send({
      kind: 'task-workbench/publish' as never,
      title: '会被孤儿的任务',
      target: { url: '/apps/task-workbench/task/9' as PageInstanceKey, appId: 'task-workbench', page: 'detail', params: { taskId: '9' } },
    })
    expect(first.tools.has('task_workbench__complete_task')).toBe(true)
    await first.wb.dispose() // 卸载应用（fiber 销毁 → 镜像面摘工具）
    await new Promise((resolve) => setTimeout(resolve, 0)) // releaseApp 是 fire-and-forget，让它落定
    expect(first.tools.has('task_workbench__complete_task')).toBe(false) // 工具摘掉
    expect(first.store.alive(a.sessionId)).toBe(true) // 会话保留
    const orphaned = await first.tasks.get(record.id) // 懒孤儿判定（resolver 查不到应用）
    expect(orphaned?.status).toBe('orphaned')

    const second = await boot(root) // 重装（新宿主、同一持久目录）
    const reopened = await open(second.pages, '1')
    expect(reopened.created).toBe(false)
    expect(reopened.sessionId).toBe(a.sessionId)
    // 重装后页面会话可恢复工具（恢复路径重挂）
    expect(second.tools.has('task_workbench__complete_task')).toBe(true)
  })
})
