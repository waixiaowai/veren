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
import { randomUUID } from 'node:crypto'
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
import type { PageSessionPort, PageToolEntry } from '@veren/page-registry'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'

// ---- 落盘的会话目录（DSH 会话系统的最小替身，但状态在文件里）----
// ---- The file-backed session directory (a minimal DSH-session stand-in whose state lives on disk) ----

interface SessionFile {
  sessions: Record<string, { title: string; messages: string[]; alive: boolean }>
}

/** 注入的 session/event 发射器（boot 接线：消息落目录时同步喂同意门折叠）
 * / the injected session/event emitter (wired by boot: every append feeds the consent fold) */
export type SessionEventEmit = (session: object, event: object) => void

/** 会话目录：JSON 文件落盘；agent.followup 追加消息并立即写回。 */
class FileSessionStore {
  private readonly data: SessionFile = { sessions: {} }
  /** 各会话登记的页面工具名（内存即可：重启后由重开路径重新登记）。
   *  Page tool names registered per session (memory only: a restart re-registers via reopen). */
  readonly #mountedTools = new Map<string, string[]>()
  /** 各会话的登记面（agentOf 假 agent 写它，toolFace 快照读它）
   * / each session's registration face (the agentOf fake writes it; toolFace snapshots read it) */
  readonly #toolFaces = new Map<string, PageToolEntry[]>()
  /** 稳定会话对象（同意门按对象键：exec.agent.session 必须与事件桥同一对象）
   * / stable session objects (the consent gate keys on the object: exec.agent.session must be the same object the event bridge emits) */
  readonly #sessionFaces = new Map<string, { readonly id: string }>()
  /** session/event 发射器（boot 注入）/ the session/event emitter (injected by boot) */
  emitSessionEvent: SessionEventEmit = () => undefined

  constructor(readonly file: string, private readonly tools: Map<string, ToolDefinition>) {
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
    // header 是 app-host 会话端口 presetOf 的同源字段（页面 load 的 PageLoadEnv）
    // / header feeds app-host's session-port presetOf (the page load's PageLoadEnv)
    get: (id: string) => (this.alive(id)
      ? { header: { agentPreset: 'standard' }, dispose: () => { this.data.sessions[id]!.alive = false; this.save() } }
      : undefined),
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

  /** 会话的稳定对象（工具执行与事件桥共用）/ the session's stable object (shared by tool execs and the event bridge) */
  sessionFace(id: string): { readonly id: string } {
    const existing = this.#sessionFaces.get(id)
    if (existing !== undefined) return existing
    const face = { id }
    this.#sessionFaces.set(id, face)
    return face
  }

  /** 摘掉一个会话登记的全部页面工具（废弃/销毁路径共用）：名字来自登记面快照
   * / strip every page tool a session registered (shared by deprecate & destroy): names come from the registration face */
  releaseToolsOf(id: string): void {
    for (const entry of this.#toolFaces.get(id) ?? []) this.tools.delete(entry.name)
    this.#toolFaces.delete(id)
    this.#mountedTools.delete(id)
  }

  /**
   * page-registry 的会话端口（G13 后端口是纯参数，由装配显式传入；这里是测试
   * 版的真实会话机制——状态落盘、组件体直登的工具进共享注册表、retire 真的摘掉）。
   * The page-registry session port (post-G13 ports arrive as pure parameters
   * from the assembly). This is the test face of the real session mechanism:
   * state on disk, body-registered tools into the shared registry, retire
   * actually strips.
   */
  readonly port: PageSessionPort = {
    exists: (id) => this.alive(id),
    mintId: () => `s-${randomUUID()}`,
    create: async (id, title) => {
      this.data.sessions[id] = { title, messages: [], alive: true }
      this.#toolFaces.set(id, [])
      this.save()
    },
    agentOf: (id) => {
      if (!this.alive(id)) return undefined
      const face = this.#toolFaces.get(id) ?? []
      return {
        ctx: {
          tools: {
            register: (definition: ToolDefinition) => {
              const entry: PageToolEntry = { name: definition.name, description: definition.description }
              face.push(entry)
              this.tools.set(definition.name, definition)
              return () => undefined
            },
          },
          // effect 真跑（异步首屏生命周期：重建投影 + followup 送达），fire-and-forget
          // / effects really run (the async first-screen lifecycle: rebuild + followup), fire-and-forget
          effect: (callback: () => unknown) => {
            void Promise.resolve().then(callback).catch(() => undefined)
            return () => undefined
          },
          on: () => () => undefined,
        },
        // followup：页面自推消息直接落会话日志（与宿主 agents.followup 同语义）
        // / followup: the page's own messages land straight in the session log (same semantics as the host agents.followup)
        followup: (message: { content: ReadonlyArray<{ type: string; text?: string }> }) => {
          const text = message.content.map((block) => block.text ?? '').join('')
          this.data.sessions[id]?.messages.push(text)
          this.save()
        },
        session: this.sessionFace(id),
      } as never
    },
    // 快照必须拷贝：活引用会让 before/after 同数组、差集恒空
    // / the snapshot must copy: a live reference makes before/after one array and the delta permanently empty
    toolFace: (id) => [...(this.#toolFaces.get(id) ?? [])],
    retire: async (id) => { this.releaseToolsOf(id) },
    appendUserMessage: async (id, text, source) => {
      this.data.sessions[id]?.messages.push(text)
      this.save()
      // session/event 桥：注入消息（PAGE 块/通知/TASK 块）同步喂同意门折叠
      // / the session/event bridge: injected messages (PAGE block / notice / TASK block) feed the consent fold
      if (source !== undefined) {
        this.emitSessionEvent(this.sessionFace(id), {
          type: 'user/message',
          data: { message: { source: { kind: source }, content: [{ type: 'text', text }] } },
        })
      }
    },
    focus: async () => undefined,
    destroy: async (id) => {
      this.releaseToolsOf(id)
      delete this.data.sessions[id]
      this.save()
    },
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
  tools: Map<string, ToolDefinition>
  apps: AppRegistryService
  pages: PageRegistryService
  tasks: TaskCenterService
  wb: Fiber
}

/**
 * 起一套完整宿主：真实存储栈（json backend → 临时目录）+ 四个插件 +
 * 落盘会话目录。返回的 stop() 按依赖逆序销毁每个 fiber。
 * 装配接线 = app-host（plugins/app-host/src/wire.ts）在真实宿主做的三步，
 * 这里显式做同型三步：resolver ← apps、镜像面 ← pageRegistry、
 * bindPorts ← 全部端口纯参数（G13 后没有隐式探测兜底）。
 */
/** provide 的宽松封装（测试桩不需要 InjectKey 精确类型）/ loose provide for test stubs */
function provideStub(ctx: Context, name: string, value: unknown): void {
  ;(ctx.provide as unknown as (n: string, v: unknown) => void)(name, value)
}

async function boot(root: string): Promise<Boot & { stop(): Promise<void> }> {
  const ctx = new Context()
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
  const storageFiber = await ctx.plugin(Storage.default)
  const jsonFiber = await ctx.plugin(StorageJson, { root })
  const domainFiber = await ctx.plugin(StorageDomain, { backend: 'json' })
  await ctx.plugin(AppRegistryPlugin)
  await ctx.plugin(PageRegistryPlugin)
  await ctx.plugin(TaskCenterPlugin)
  const apps = ctx.apps
  const pageRegistry = ctx.pageRegistry
  const taskCenter = ctx.taskCenter
  // 装配接线（与 app-host wireAppHost 同型三步）：
  // 1) resolver ← apps.get；2) 镜像面 ← pageRegistry；3) bindPorts 纯参数。
  taskCenter.setAppResolver(async (appId) => {
    const record = apps.get(appId as never)
    return record === undefined ? undefined : { state: record.state, version: record.version }
  })
  apps.setPageMirror({
    // live 绑定必须透传：组件页的每会话视图（首屏正文/动态工具）全靠它——
    // 丢掉它 openUrl 只剩目录工具与空正文（store 页首屏被架空）。
    // / the live binding must pass through: the component page's per-session
    // view (first-screen body/dynamic tools) depends on it — dropping it leaves
    // catalog-only tools and an empty body.
    registerAppPage: (appId, page, live) => pageRegistry.registerAppPage(appId, page, live),
    releaseApp: (appId) => pageRegistry.releaseApp(appId),
  })
  pageRegistry.bindPorts({
    sessions: store.port,
    apps,
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

/** 等异步首屏生命周期落定（effect fire-and-forget 后的存储写与 followup）/ let the async first-screen lifecycle settle (storage writes and the followup after fire-and-forget effects) */
async function flush(): Promise<void> {
  for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setTimeout(resolve, 5))
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
    expect(opened.sessionId).toBeTypeOf('string')
    // 预设选择器零新增：装配里不存在 presets 服务；四个插件的注册路径全部
    // 走 ctx.apps / ctx.pageRegistry / ctx.taskCenter，没有任何预设注册调用
    // （grep 层面见 docs/phase1-acceptance.cn.md 的核对记录）。
    expect(ctx.get('presets' as never)).toBeUndefined()
  })
})

// ---- 场景 2 ----

describe('场景 2：/task/1 → 会话 A；/task/2 → 会话 B；A 原样保留', () => {
  it('两条 URL 两条会话；A 的工具和消息不被 B 影响', async () => {
    const { pages, tasks, tools, store } = await boot(tempRoot())
    // v2 队列权威在中心：先落一条工作单，详情页首屏消息才能携带它
    // / v2 keeps the queue's authority in the center: seed one order so the detail first-screen message can carry it
    await tasks.send({
      kind: 'task-workbench/publish' as never,
      title: '示例任务 1',
      target: { url: '/apps/task-workbench/task/t-1' as PageInstanceKey, appId: 'task-workbench', page: 'detail', params: { taskId: 't-1' } },
    })
    const a = await open(pages, 't-1')
    const b = await open(pages, 't-2')
    expect(a.sessionId).not.toBe(b.sessionId)
    expect(store.titles()).toContain('任务 #t-1')
    // A 的工具仍挂着（键 = task_workbench__* 且带会话分组的实现按名字记录）
    expect([...tools.keys()].filter((name) => name.startsWith('task_workbench__')).length).toBeGreaterThan(0)
    // A 的 PAGE 块还在，且首屏消息携带中心真身（含标题；投影正文随重建对齐）
    // / A's PAGE block is intact, and the first-screen message carries the center's real body (title included)
    const pageBlockA = store.messages(a.sessionId).find((m) => m.startsWith('PAGE task-workbench/detail'))
    expect(pageBlockA).toBeDefined()
    await flush()
    expect(store.messages(a.sessionId).some((m) => m.includes('中心真身') && m.includes('示例任务 1'))).toBe(true)
  })
})

// ---- 场景 3（§9.1 反转后语义：重开 = 新建 + 旧废弃）----

describe('场景 3：整机重启（真实落盘）→ 索引仍指向最新活会话；重开新建并废弃旧会话', () => {
  it('销毁整个 Context（含存储栈）后重开同一目录：索引指针跨重启保留、指向最新活会话；再开一次新建且旧会话标废弃', async () => {
    const root = tempRoot()
    const first = await boot(root)
    // 先落一条工作单（顺带证明记录跨重启持久）/ seed one order (also proves records survive the restart)
    await first.tasks.send({
      kind: 'task-workbench/publish' as never,
      title: '示例任务 1',
      target: { url: '/apps/task-workbench/task/t-1' as PageInstanceKey, appId: 'task-workbench', page: 'detail', params: { taskId: 't-1' } },
    })
    const a = await open(first.pages, 't-1')
    await first.stop() // 真实销毁：存储域关闭、fiber 逆序卸载

    const second = await boot(root) // 同一目录重开 = 重启后的宿主
    // 重启后：URL 索引行还在且指向 a（宿主恢复了会话目录，a 仍是"最新活会话"）
    const rows = await second.pages.instances.listByApp('task-workbench')
    const pointer = rows.find((row) => row.url === '/apps/task-workbench/task/t-1' && row.state === 'live')
    expect(pointer?.sessionId).toBe(a.sessionId)
    expect(pointer?.state).toBe('live')
    // 但打开不再复用：新建会话 B；索引改指 B；a 落废弃历史，不会被误当活的
    const b = await open(second.pages, 't-1')
    expect(b.sessionId).not.toBe(a.sessionId)
    const after = await second.pages.instances.listByApp('task-workbench')
    expect(after.find((row) => row.url === '/apps/task-workbench/task/t-1' && row.state === 'live')?.sessionId).toBe(b.sessionId)
    const deprecatedRow = after.find((row) => row.state === 'deprecated' && row.sessionId === a.sessionId)
    expect(deprecatedRow?.state).toBe('deprecated')
    // 新会话的 PAGE 块与页面工具照常；首屏消息携带中心真身
    // / the fresh session's PAGE block and tools are in place; the first-screen message carries the center's real body
    const pageBlockB = second.store.messages(b.sessionId).find((m) => m.startsWith('PAGE task-workbench/detail'))
    expect(pageBlockB).toBeDefined()
    await flush()
    expect(second.store.messages(b.sessionId).some((m) => m.includes('中心真身') && m.includes('示例任务 1'))).toBe(true)
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
    const { createElement } = await import('@veren/prompt-core')
    apps.register({ id: 'other-app' as AppId, name: '另一个应用', description: '同名工具共存验证', entry: 'list' as PageKey }, ctx)
    const { defineTool } = await import('@deepseek-ai/dsh-tools')
    const otherPages = apps.pages('other-app' as AppId, ctx)
    // 一级页（entry）：map 由注册表推导（§3.5），不再手写 / the home: the map is registry-derived (§3.5)
    otherPages.register(
      () => createElement('p', { children: 'other list' }),
      { url: '/apps/other-app/list', description: '另一应用列表页', instructions: '这是 other-app 的首页：看列表，去详情。' },
    )
    // 二级页：带 :param + writes + 工具 + 说明（规则 3）
    // detail page: a :param plus writes, a tool and instructions (rule 3)
    otherPages.register(
      (_props: { taskId?: string }, agent) => {
        // 工具只在页面存在：组件体直登全名（设计律；工具不再走目录声明）
        // / a tool exists only inside a page: the body registers the full name (design law; no catalog indirection)
        agent.ctx.tools.register(defineTool({
          name: 'other_app__take_task', description: '另一个应用的 take_task', parameters: {},
          output: { schema: { type: 'object', additionalProperties: true } as const, render: () => [] },
          execute: async () => ({ ok: true }),
        }))
        return createElement('p', { children: 'other task' })
      },
      { url: '/apps/other-app/task/:taskId', description: '另一应用任务页', writes: true, instructions: '只处理 params.taskId 指定的这一条任务。' },
    )
    const a = await open(pages, '1')
    const b = await pages.openUrl('/apps/other-app/task/1')
    const names = [...tools.keys()]
    // 详情页挂 complete_task/abandon_task；另一应用挂自己的 take_task——前缀共存
    expect(names).toContain('task_workbench__complete_task')
    expect(names).toContain('other_app__take_task')
    // DSH ToolDefinition 本体直达模型侧：output 契约字段未在挂载路上丢失
    const mounted = tools.get('task_workbench__complete_task')
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

describe('场景 8：卸载 → 工具摘掉、会话保留、任务 orphaned；重装后新建会话恢复工具', () => {
  it('fiber 销毁执行全部卸载语义；重装后打开新建会话，旧会话废弃但可读', async () => {
    const root = tempRoot()
    const first = await boot(root)
    const a = await open(first.pages, 't-1')
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
    const reopened = await open(second.pages, 't-1')
    // 重装后打开 = 新建会话；索引指向新会话，旧会话落废弃历史但消息仍可读
    expect(reopened.sessionId).not.toBe(a.sessionId)
    const rows = await second.pages.instances.listByApp('task-workbench')
    expect(rows.find((row) => row.url === '/apps/task-workbench/task/t-1' && row.state === 'live')?.sessionId).toBe(reopened.sessionId)
    expect(rows.some((row) => row.state === 'deprecated' && row.sessionId === a.sessionId)).toBe(true)
    // 旧会话消息仍可读（PAGE 块在；首屏消息带过中心真身）
    // / the old session's log stays readable (the PAGE block is there; the first-screen message carried the center's real body)
    const pageBlockOld = second.store.messages(a.sessionId).find((m) => m.startsWith('PAGE task-workbench/detail'))
    expect(pageBlockOld).toBeDefined()
    expect(first.store.messages(a.sessionId).some((m) => m.includes('中心真身'))).toBe(true)
    // 新会话的页面工具照常挂载
    expect(second.tools.has('task_workbench__complete_task')).toBe(true)
  })
})

// ---- 场景 9（§9.1 反转的关键边角：废弃会话释放任务租约）----

describe('场景 9：旧会话持有任务租约时被废弃 → 租约释放 → 新会话可接取', () => {
  it('旧会话 taken 的任务，重开同 URL 后新会话再次 take 成功（不会被 already-taken 挡住）', async () => {
    const { pages, tasks, store } = await boot(tempRoot())
    const record = await tasks.send({
      kind: 'task-workbench/publish' as never,
      title: '租约要随废弃释放的任务',
      target: { url: '/apps/task-workbench/task/1' as PageInstanceKey, appId: 'task-workbench', page: 'detail', params: { taskId: '1' } },
    })
    const a = await open(pages, '1', { taskId: record.id })
    expect((await tasks.get(record.id))?.claimedBy?.sessionId).toBe(a.sessionId)
    // 重开同 URL：旧会话废弃；它持有的租约随之释放
    const b = await open(pages, '1', { taskId: record.id })
    expect(b.sessionId).not.toBe(a.sessionId)
    const after = await tasks.get(record.id)
    expect(after?.status).toBe('taken')
    expect(after?.claimedBy?.sessionId).toBe(b.sessionId) // 新会话拿到，不再 already-taken
    // TASK 块在新会话里；旧会话的日志保持只有它自己的那一次
    expect(store.messages(b.sessionId).some((m) => m.startsWith(`TASK ${record.id}`))).toBe(true)
  })
})

// ---- 场景 10（投递闭环修复：§3.9 page_send → §3.10.1 详情页接取 → done）----
// 真机缺陷：page_send 把任务投给详情页会话，但详情页按当时的工具矩阵没有接取
// 工具（只有 complete/abandon 系），三轮跑满后任务落 failed/task-not-taken。
// The live defect: page_send delivered a task to a detail-page session, but the
// page's tool matrix had no take tool (complete/abandon only); after its turns
// ran out the task landed failed/task-not-taken.

describe('场景 10：page_send 投递 → 详情页 take_page_task 接取 → 完成 → 终态 done', () => {
  it('投递只投消息不接取；详情页会话接的就是本页那条；重复接取幂等；完成后任务翻 done', async () => {
    const { pages, tasks, tools, store } = await boot(tempRoot())
    const record = await tasks.send({
      kind: 'task-workbench/publish' as never,
      title: '投递给详情页的任务',
      target: { url: '/apps/task-workbench/task/t-1' as PageInstanceKey, appId: 'task-workbench', page: 'detail', params: { taskId: 't-1' } },
    })
    // §3.9 page_send：只投消息，不接取（openUrl 带 taskId 的宿主接取路径不在场）
    // / §3.9 page_send: message only, no take (the host's openUrl+taskId path is absent here)
    const delivered = await pages.deliverUrl('/apps/task-workbench/task/t-1', { message: `[task-center] 新任务 ${record.id} 请处理` })
    expect(delivered.created).toBe(true)
    // 断裂态重现：投了、会话在、任务没人接、没有 TASK 块
    // / the broken shape: delivered, session alive, nobody took it, no TASK block
    expect((await tasks.get(record.id))?.status).toBe('open')
    expect(store.messages(delivered.sessionId).some((m) => m.startsWith('TASK '))).toBe(false)
    // v2 投递闭环（§5 分解）：通知先进会话（投递同意按记录 id 收窄）→ drive_begin
    // 声明范围 → take_page_task 接取本页那条 → complete_task 提交。
    // / the v2 delivery loop (§5's decomposition): the notice lands first (delivery
    // consent narrowed to the record id) → drive_begin declares the scope →
    // take_page_task takes this page's order → complete_task submits.
    await flush()
    const take = tools.get('task_workbench__take_page_task')
    expect(take).toBeDefined()
    const session = store.sessionFace(delivered.sessionId)
    const exec = { agent: { session } } as never
    // 门未声明时先拒绝：先 take 会被 consent/drive-required 挡住
    // / with no declared drive the take is refused first: consent/drive-required
    expect(await take!.execute({}, exec)).toMatchObject({ ok: false, code: 'consent/drive-required' })
    const drive = tools.get('task_workbench__drive_begin')
    expect(await drive!.execute({ reason: '处理投递来的任务', scope: 'tasks', task_ids: [record.id] }, exec))
      .toMatchObject({ ok: true })
    expect(await take!.execute({}, exec)).toMatchObject({ ok: true })
    // 接取者就是本页会话（租约）；同会话重复接取幂等（§4.4）
    // / the claimant is this page session (the lease); re-take by the same session is idempotent (§4.4)
    const taken = await tasks.get(record.id)
    expect(taken?.status).toBe('taken')
    expect(taken?.claimedBy?.sessionId).toBe(delivered.sessionId)
    expect(await take!.execute({}, exec)).toMatchObject({ ok: true })
    // 接取者提交 → 终态 done，而不是 failed/task-not-taken
    // / the claimant submits → terminal done, not failed/task-not-taken
    expect(await tools.get('task_workbench__complete_task')!.execute({ task_id: 't-1', summary: '闭环完成' }, exec))
      .toMatchObject({ ok: true })
    expect((await tasks.get(record.id))?.status).toBe('done')
  })

  it('页面作用域限制：列表页会话调用 take_page_task 被结构化拒绝（page-task-unresolvable）', async () => {
    const { pages, tools } = await boot(tempRoot())
    const listed = await pages.openUrl('/apps/task-workbench/list')
    // 工具表里要有这个工具才轮得到"拒绝"：先开一个详情页让它挂载（列表页按矩阵不声明它）
    // / the tool must be in the table before a refusal is even possible: mount a
    // detail page first (the list page does not declare it, by the matrix)
    await open(pages, 't-1')
    const take = tools.get('task_workbench__take_page_task')!
    const outcome = await take.execute({}, { agent: { session: { id: listed.sessionId } } } as never) as { ok: boolean; code?: string }
    expect(outcome).toMatchObject({ ok: false, code: 'page-task-unresolvable' })
  })

  it('重开同 URL（旧会话废弃、租约释放）后，新会话依然接得了本页那条（§3.5.3 收敛）', async () => {
    const { pages, tasks, tools, store } = await boot(tempRoot())
    const record = await tasks.send({
      kind: 'task-workbench/publish' as never,
      title: '废弃后要能被新会话接走的任务',
      target: { url: '/apps/task-workbench/task/t-1' as PageInstanceKey, appId: 'task-workbench', page: 'detail', params: { taskId: 't-1' } },
    })
    const first = await open(pages, 't-1', { taskId: record.id })
    expect((await tasks.get(record.id))?.claimedBy?.sessionId).toBe(first.sessionId)
    const reopened = await open(pages, 't-1')
    expect(reopened.sessionId).not.toBe(first.sessionId)
    // §3.5.3 收敛在门内验证：旧会话废弃释放租约后，新会话经"用户点名 + drive"接走本页那条
    // / the §3.5.3 convergence inside the gate: after the deprecated session's lease
    // is released, the fresh session takes the order via a user turn + drive
    const session = store.sessionFace(reopened.sessionId)
    const exec = { agent: { session } } as never
    await flush()
    store.emitSessionEvent(session, { type: 'turn/start' })
    store.emitSessionEvent(session, { type: 'user/message', data: { message: { source: { kind: 'user' }, content: [{ type: 'text', text: '接了它' }] } } })
    expect(await tools.get('task_workbench__drive_begin')!.execute({ reason: '用户点名接取' }, exec))
      .toMatchObject({ ok: true })
    expect(await tools.get('task_workbench__take_page_task')!.execute({}, exec))
      .toMatchObject({ ok: true })
    const after = await tasks.get(record.id)
    expect(after?.status).toBe('taken')
    expect(after?.claimedBy?.sessionId).toBe(reopened.sessionId)
  })
})
