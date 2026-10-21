/**
 * 宿主装配层（app-host）的组合与隔离验收。
 * Composition and isolation acceptance for the host assembly layer.
 *
 * 真实程度（如实）：真实 cordis 装配 + 真实 storage 栈（json backend，临时目录）
 * + 真实 PageSessionPort 接线路径；`ctx.sessions` / `ctx.agents` 用最小结构面
 * 替身——但**每个会话的 agent 作用域是一个真实的 cordis 子上下文**，工具经
 * `agent.ctx.tools.register` 挂进该子上下文自己的工具表（与 AgentRegistry 的
 * `resolve: sessionId => this.get(sessionId)?.ctx` 同机制、同注销器语义）。
 * 未做：完整 DSH profile 启动（需要测试节点安装，归 H/部署侧），因此
 * ToolRuntime 的 scope 层不在本测试覆盖内。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { agentEvents } from '@deepseek-ai/dsh-agent'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import * as Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { Data, Keyed, defineAppPage, definePage } from '@veren/prompt-page'
import type { Entity, PageDefinition } from '@veren/prompt-page'
import AppRegistryPlugin from '@veren/app-registry'
import type { AppCapability, AppId, PageKey } from '@veren/app-registry'
import PageRegistryPlugin from '@veren/page-registry'
import type { PageRegistryService } from '@veren/page-registry'
import TaskCenterPlugin from '@veren/task-center'
import type { TaskCenterService } from '@veren/task-center'
import type { PageInstanceKey } from '@veren/prompt-page'
import { apply, Config, inject, name, wireAppHost } from '../src/index.ts'

// ---- 每会话一个真实 cordis 子上下文的 agent 作用域替身 ----
// ---- Per-session agent scopes: real cordis child contexts ----

/** 一个 agent 作用域：cordis 子上下文 + 它自己的工具表（注销器语义真实） */
interface AgentScope {
  readonly ctx: Context
  readonly registry: Map<string, unknown>
  readonly followups: string[]
  /** restrict({deny}) 收到的工具名（屏蔽断言用）/ tool names received by restrict({deny}) */
  readonly denials: string[]
  disposeAll(): void
}

function makeAgentScope(parent: Context): AgentScope {
  const registry = new Map<string, unknown>()
  const followups: string[] = []
  const denials: string[] = []
  // isolate('tools')：该子树上 'tools' 服务解析进独立作用域（cordis 服务隔离，
  // 与 AgentRegistry 给每个 agent 独立 ctx 的机制同向）。
  const ctx = parent.isolate('tools')
  ;(ctx.provide as unknown as (n: string, v: unknown) => void)('tools', {
    register: (tool: { name: string }) => {
      registry.set(tool.name, tool)
      return () => { registry.delete(tool.name) }
    },
    restrict: (filter: { deny?: readonly string[] }) => {
      denials.push(...(filter.deny ?? []))
      return () => { denials.length = 0 }
    },
  })
  return {
    ctx,
    registry,
    followups,
    denials,
    disposeAll() {
      // agent fiber 销毁的注销器语义：作用域内全部登记逆序摘除
      registry.clear()
      followups.length = 0
      denials.length = 0
    },
  }
}

/** 最小 agents/sessions 结构面：live agent 表 + agent/created、agent/disposed 事件 */
function makeHostSessions(ctx: Context, failTool?: string) {
  // task-center / app-host 的 inject 都要 'tools'；装配测试给真实登记的工具表
  // 替身：register 按名入表、注销器按名出表——"注册必须发生"才能被断言。
  const hostTools = new Map<string, unknown>()
  ;(ctx.provide as unknown as (n: string, v: unknown) => void)('tools', {
    register: (tool: { name: string }) => {
      if (failTool !== undefined && tool.name === failTool) throw new Error(`boom registering ${tool.name}`)
      hostTools.set(tool.name, tool)
      return () => { hostTools.delete(tool.name) }
    },
  })
  const sessions = new Map<string, { id: string; messages: string[]; alive: boolean; titles: Array<{ title: string; source: { kind: string } }>; append(type: string, data: { title: string; source: { kind: string } }): void }>()
  const scopes = new Map<string, AgentScope>()
  /** 替身会话工厂：带上 append，session/title 的落盘断言用 / stub session factory with append for title assertions */
  const newSession = (id: string) => {
    const record: { id: string; messages: string[]; alive: boolean; titles: Array<{ title: string; source: { kind: string } }>; append(type: string, data: { title: string; source: { kind: string } }): void } = {
      id, messages: [], alive: true, titles: [],
      append: (_type, data) => { record.titles.push(data) },
    }
    return record
  }
  ;(ctx.provide as unknown as (n: string, v: unknown) => void)('sessions', {
    get: (id: string) => (sessions.get(id)?.alive === true ? sessions.get(id) : undefined),
    create: (id?: string) => {
      const key = id ?? crypto.randomUUID()
      const record = newSession(key)
      sessions.set(key, record)
      return record
    },
    flush: () => true,
  })
  const agentView = (id: string) => {
    const scope = scopes.get(id)
    if (scope === undefined || sessions.get(id)?.alive !== true) return undefined
    return {
      ctx: scope.ctx,
      session: sessions.get(id),
      followup: (m: { content: Array<{ text?: string }> }) => { scope.followups.push(m.content.map((b) => b.text ?? '').join('')) },
    }
  }
  const emit = ctx.emit as unknown as (event: string, payload: unknown) => void
  ;(ctx.provide as unknown as (n: string, v: unknown) => void)('agentDefaultModel', {
    currentSelection: () => ({ provider: 'test', model: 'test-model' }),
  })
  ;(ctx.provide as unknown as (n: string, v: unknown) => void)('agents', {
    // 活 agent 面：作用域 ctx + 会话 + followup（会话活着才有）
    get: (id: string) => agentView(id),
    // H 后的创建面：agents.create 连同创建会话并发布 agent/created（打开即激活）
    create: async (options: { sessionId: string }) => {
      const id = options.sessionId
      const scope = makeAgentScope(ctx)
      scopes.set(id, scope)
      sessions.set(id, newSession(id))
      emit('agent/created', { agent: agentView(id) })
      return {
        agent: agentView(id),
        dispose: async () => {
          scopes.get(id)?.disposeAll()
          scopes.delete(id)
          const session = sessions.get(id)
          if (session !== undefined) session.alive = false
          emit('agent/disposed', { agent: { session: { id } } })
        },
      }
    },
  })
  return {
    sessions,
    scopes,
    hostTools,
    /** agent 销毁：作用域注销器全部执行（真实 cordis 语义）+ 广播 agent/disposed */
    stopAgent(id: string): void {
      scopes.get(id)?.disposeAll()
      scopes.delete(id)
      emit('agent/disposed', { agent: { session: { id } } })
    },
  }
}

// ---- PAGE-DATA 同步测试的极简件（看板应用 + store + pre-step 派发） ----
// ---- Minimal pieces for the PAGE-DATA sync tests (board app + store + pre-step dispatch) ----

/** 看板条目 / one board card */
interface BoardCard extends Entity { readonly title: string }

/** 权威 store 假件：可变、可订阅、引用稳定 / the authoritative store fake */
function makeBoardStore(initial: BoardCard[]): {
  getState(): BoardCard[]
  subscribe(listener: () => void): () => void
  mutate(next: BoardCard[]): void
} {
  let items = initial
  const listeners = new Set<() => void>()
  return {
    getState: () => items,
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    mutate(next) {
      items = next
      for (const listener of listeners) listener()
    },
  }
}

/** 看板页面：一个 keyed 集合块 + 一个字段块 / the board page: one keyed collection + one field */
function boardPage(): PageDefinition<BoardCard[]> {
  return definePage<BoardCard[]>({
    name: 'board',
    url: '/apps/board/board/:id',
    description: '看板页',
    tree: (_params, state) => [...Keyed({ path: 'cards', items: state }), ...Data({ path: 'count', value: state.length })],
  })
}

/** 在该会话的 agent 作用域上跑一轮 pre-step（最内层 next 返回已认领消息）
 * / run one pre-step in that session's agent scope (innermost next returns the claimed messages) */
async function runPreStep(ctx: Context, agentCtx: Context, sessionId: string): Promise<PreStepDecision> {
  // 唯一的类型断言：假 Agent 只实现派发所需的身份与作用域（同结算测试的先例）
  // The single type assertion: the fake carries only the identity and scope dispatch needs
  const agent = { id: sessionId, ctx: agentCtx, session: { id: sessionId } } as unknown as Agent
  const claimed: UserMessage[] = [createUserMessage({ content: [{ type: 'text', text: '继续' }] })]
  return await agentEvents(ctx, agent).waterfall('agent/pre-step', {
    messages: claimed,
    turn: 0,
    step: 0,
    signal: new AbortController().signal,
  }, async (): Promise<PreStepDecision> => ({ kind: 'enter', messages: claimed }))
}

// ---- 装配 + 一个迷你应用 ----

const roots: string[] = []
const made: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const dispose of made.reverse()) await dispose()
  made.length = 0
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'app-host-'))
  roots.push(root)
  return root
}

interface Boot {
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

async function boot(options: { enabled?: boolean; failTool?: string } = {}): Promise<Boot> {
  const ctx = new Context()
  const host = makeHostSessions(ctx, options.failTool)
  const storageFiber = await ctx.plugin(Storage.default)
  const jsonFiber = await ctx.plugin(StorageJson, { root: tempRoot() })
  const domainFiber = await ctx.plugin(StorageDomain, { backend: 'json' })
  await ctx.plugin(AppRegistryPlugin)
  await ctx.plugin(PageRegistryPlugin)
  await ctx.plugin(TaskCenterPlugin)
  const fh = await ctx.plugin({ name, inject, apply, Config }, { enabled: options.enabled ?? true })
  await fh.await()
  const pages = ctx.pageRegistry
  for (let i = 0; i < 100; i += 1) {
    try {
      await pages.instances.listByApp('warm-up')
      break
    } catch { await new Promise((resolve) => setTimeout(resolve, 10)) }
  }
  const dispose = async (): Promise<void> => {
    for (const fiber of [domainFiber, jsonFiber, storageFiber]) await fiber.dispose().catch(() => undefined)
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

/** 迷你应用：一页一工具（defineTool 本体）/ a mini app: one page, one defineTool tool */
function registerMiniApp(h: Boot): void {
  const { ctx } = h
  const apps = ctx.apps
  apps.register({ id: 'mini' as AppId, name: 'mini', description: '装配层验证应用', entry: 'task' as PageKey }, ctx)
  apps.tools('mini' as AppId, ctx).define(defineTool({
    name: 'read',
    description: '读取材料',
    parameters: {},
    output: { schema: { type: 'object', additionalProperties: true } as const, render: () => [] },
    execute: async () => ({ ok: true }),
  }), { requires: ['files:read' as AppCapability] })
  apps.pages('mini' as AppId, ctx).register(defineAppPage({
    name: 'task', url: '/apps/mini/task/:id', description: '任务页',
    tools: ['read'], tree: () => [],
  }) as unknown as PageDefinition<never>)
}

describe('装配是一处：wireAppHost 显式接上全部接缝', () => {
  it('resolver / 镜像面 / 会话端口由装配接好：发任务校验发送方、页面可被 openUrl 解析', async () => {
    const h = await boot()
    registerMiniApp(h)
    // 镜像面：apps.pages 单入口注册 → openUrl 直接可解析（装配接的线在起作用）
    const opened = await h.pages.openUrl('/apps/mini/task/1' as PageInstanceKey)
    expect(opened.sessionId).toBeTypeOf('string')
    // resolver：未注册应用 send 被拒（装配接的线在起作用）
    await expect(h.tasks.send({
      kind: 'mini/kind' as never, title: 't',
      target: { url: '/apps/mini/task/1' as PageInstanceKey, appId: 'ghost', page: 'task', params: {} },
    })).rejects.toMatchObject({ code: 'task/send-forbidden' })
  })

  it('装配 disposer 撤销全部注入：dispose 后镜像失效（注册只告警不镜像）', async () => {
    const ctx = new Context()
    ;(ctx.provide as unknown as (n: string, v: unknown) => void)('sessions', { get: () => undefined, create: () => ({}) })
    ;(ctx.provide as unknown as (n: string, v: unknown) => void)('agents', { get: () => undefined })
    await ctx.plugin(Storage.default)
    const jsonFiber = await ctx.plugin(StorageJson, { root: tempRoot() })
    await ctx.plugin(StorageDomain, { backend: 'json' })
    await ctx.plugin(AppRegistryPlugin)
    await ctx.plugin(PageRegistryPlugin)
      await ctx.plugin(TaskCenterPlugin)
      const fiber = await ctx.plugin({ name, inject, apply, Config }, { enabled: true })
    await fiber.await()
    await fiber.dispose() // 卸载装配层
    const apps = ctx.apps
    const warnings: string[] = []
    const original = ctx.logger.warn
    ;(ctx.logger as { warn: (m: string) => void }).warn = (m: string) => { warnings.push(m) }
    try {
      apps.register({ id: 'solo' as AppId, name: 'solo', description: 'd', entry: 'main' as PageKey })
      apps.pages('solo' as AppId).register(defineAppPage({
        name: 'main', url: '/apps/solo/main', description: 'd', tree: () => [],
      }) as unknown as PageDefinition<never>)
      expect(warnings.some((m) => m.includes('no page mirror wired'))).toBe(true)
      expect(ctx.pageRegistry.resolve('/apps/solo/main')).toBeNull() // 未镜像
    } finally {
      ;(ctx.logger as { warn: (m: string) => void }).warn = original
      await jsonFiber.dispose().catch(() => undefined)
    }
  })
})

describe('G13 全成或全回滚：接线一步失败，系统回到"什么也没接"', () => {
  it('镜像面抛错 → resolver 被回滚、端口未绑定、镜像面不在场', async () => {
    // enabled:false：装配层不自动接线，本用例手工触发一次会失败的装配
    const h = await boot({ enabled: false })
    registerMiniApp(h)
    const warnings: string[] = []
    const original = h.ctx.logger.warn
    ;(h.ctx.logger as { warn: (m: string) => void }).warn = (m: string) => { warnings.push(m) }
    // 注入一个会失败的镜像面（装配第 2 步抛错）
    const apps = h.ctx.apps as { setPageMirror: (mirror: unknown) => void }
    apps.setPageMirror = () => { throw new Error('mirror boom') }
    try {
      expect(() => wireAppHost(h.ctx)).toThrow('mirror boom')
      // resolver 已回滚：未注册应用的 send 不被拒（resolver 在场时会 task/send-forbidden）
      await expect(h.tasks.send({
        kind: 'mini/kind' as never, title: 't',
        target: { url: '/apps/mini/task/1' as PageInstanceKey, appId: 'ghost', page: 'task', params: {} },
      })).resolves.toBeDefined()
      // 端口未绑定：openUrl 给 page/host-unavailable（装配第 3 步从未执行）
      await expect(h.pages.openUrl('/apps/mini/task/1' as PageInstanceKey))
        .rejects.toMatchObject({ code: 'page/host-unavailable' })
      // 镜像面不在场：注册页面只告警，不镜像进 page-registry
      h.ctx.apps.pages('mini' as AppId, h.ctx).register(defineAppPage({
        name: 'solo', url: '/apps/mini/solo', description: 'd', tree: () => [],
      }) as unknown as PageDefinition<never>)
      expect(warnings.some((m) => m.includes('no page mirror wired'))).toBe(true)
      expect(h.pages.resolve('/apps/mini/solo')).toBeNull()
    } finally {
      ;(h.ctx.logger as { warn: (m: string) => void }).warn = original
    }
  })
})

describe('注册必须发生：宿主工具表里真能看到引导工具（第三轮真机失败的自动化收编）', () => {
  const TASK_TOOLS = ['task_list', 'task_get', 'task_take', 'task_complete', 'task_fail', 'task_cancel', 'task_split']

  it('装配完成后，app_list / app_pages / app_open 与 task_* 都在真实工具表里', async () => {
    const h = await boot()
    registerMiniApp(h)
    // 这三个名字此前在生产装配里从未被注册（真机上模型只能 NO_APP_OPEN）——
    // 本断言堵住"写好了但没人调用"这类缺陷的回归通道。
    expect(h.host.hostTools.has('app_list')).toBe(true)
    expect(h.host.hostTools.has('app_pages')).toBe(true)
    expect(h.host.hostTools.has('app_open')).toBe(true)
    for (const name of TASK_TOOLS) expect(h.host.hostTools.has(name)).toBe(true)
  })

  it('装配整体卸载后，这三个工具一起从工具表里消失', async () => {
    const h = await boot()
    registerMiniApp(h)
    expect(h.host.hostTools.has('app_open')).toBe(true)
    // 卸载 app-host fiber：装配 disposer 逆序摘掉自己注册的工具行
    await h.disposeAssembly()
    expect(h.host.hostTools.has('app_list')).toBe(false)
    expect(h.host.hostTools.has('app_pages')).toBe(false)
    expect(h.host.hostTools.has('app_open')).toBe(false)
  })

  it('装配中途失败（工具注册行抛错）→ 已注册的工具行被逆序回滚摘掉', async () => {
    const h = await boot({ enabled: false, failTool: 'app_open' })
    registerMiniApp(h)
    // app_list / app_pages 先注册成功，app_open 抛错 → 整组回滚
    expect(() => wireAppHost(h.ctx)).toThrow('boom registering app_open')
    expect(h.host.hostTools.has('app_list')).toBe(false)
    expect(h.host.hostTools.has('app_pages')).toBe(false)
    expect(h.host.hostTools.has('app_open')).toBe(false)
    // 其余接缝同样回到"什么也没接"
    await expect(h.pages.openUrl('/apps/mini/task/1' as PageInstanceKey))
      .rejects.toMatchObject({ code: 'page/host-unavailable' })
  })

  it('先于装配注册的页面被回填镜像：wireAppHost 后 openUrl 可解析（真机并发激活的收编）', async () => {
    const h = await boot({ enabled: false })
    // 真机 Loader 按 inject 就绪并发激活：应用插件可能先于装配注册页面
    // （彼时镜像未在 → 只告警不镜像）。装配必须回填，页面才对 openUrl 可见。
    registerMiniApp(h)
    wireAppHost(h.ctx)
    const opened = await h.pages.openUrl('/apps/mini/task/1' as PageInstanceKey)
    expect(opened.sessionId).toBeTypeOf('string')
  })

  it('两个应用的页面本地名同名（task/task）→ 都能被 openUrl 解析（pageKey 命名空间的收编）', async () => {
    const h = await boot()
    registerMiniApp(h)
    // 第二个应用注册同名本地页：裸名登记会让它在 duplicate-name 上炸掉
    // （或在幂等检查里被别的应用顶掉）——真机上 notebook/list 与
    // task-workbench/list 正是这么互相吞掉的。
    const apps = h.ctx.apps
    apps.register({ id: 'twin' as AppId, name: 'twin', description: '同名页面应用', entry: 'task' as PageKey }, h.ctx)
    apps.pages('twin' as AppId, h.ctx).register(defineAppPage({
      name: 'task', url: '/apps/twin/task/1', description: '同名页', tree: () => [],
    }) as unknown as PageDefinition<never>)
    const a = await h.pages.openUrl('/apps/mini/task/1' as PageInstanceKey)
    const b = await h.pages.openUrl('/apps/twin/task/1' as PageInstanceKey)
    expect(a.sessionId).not.toBe(b.sessionId)
  })
})

describe('隔离是真的：同一宿主两个会话的 agent 作用域互不可见', () => {
  it('/task/1 与 /task/2 各自的作用域只看得到自己的工具；销毁 A 后 B 原样', async () => {
    const h = await boot()
    registerMiniApp(h)
    // 打开即激活（H 根因修复）：两个会话的 agent 在 openUrl 内就被创建，
    // 各自的工具挂进各自的作用域，销毁 A 不影响 B
    const a = await h.pages.openUrl('/apps/mini/task/1' as PageInstanceKey)
    const b = await h.pages.openUrl('/apps/mini/task/2' as PageInstanceKey)
    expect(a.sessionId).not.toBe(b.sessionId)
    const scopeA = h.host.scopes.get(a.sessionId)
    const scopeB = h.host.scopes.get(b.sessionId)
    if (scopeA === undefined || scopeB === undefined) throw new Error('expected both agents to be created at open')
    // 各自作用域里恰好挂了一次页面工具（同名工具不互相覆盖、不串台）
    expect([...scopeA.registry.keys()]).toEqual(['mini__read'])
    expect([...scopeB.registry.keys()]).toEqual(['mini__read'])
    // 页面引导工具在页面作用域内被屏蔽（递归自开防护 + 作用域互斥）
    expect(scopeA.denials).toEqual(['app_open', 'app_list', 'app_pages'])
    // 作用域实例不同：A 的登记与 B 的登记是两个真实的、分开的表
    expect(scopeA.ctx).not.toBe(scopeB.ctx)
    // 销毁 A 的 agent（作用域随 fiber 注销）：A 工具消失，B 原样
    h.host.stopAgent(a.sessionId)
    expect(scopeA.registry.size).toBe(0)
    expect([...scopeB.registry.keys()]).toEqual(['mini__read'])
  })

  it('打开即激活：openUrl 返回时 agent 已在场，页面工具已挂、PAGE 块已 followup、标题已落盘', async () => {
    const h = await boot()
    registerMiniApp(h)
    const focusEvents: Array<{ sessionId: string }> = []
    h.ctx.on('app-host/focus', (payload) => { focusEvents.push(payload) })
    const opened = await h.pages.openUrl('/apps/mini/task/1' as PageInstanceKey)
    const scope = h.host.scopes.get(opened.sessionId)
    if (scope === undefined) throw new Error('expected the page agent to activate at open')
    expect([...scope.registry.keys()]).toEqual(['mini__read']) // 工具只对该 agent 可见
    expect(scope.followups.some((m) => m.startsWith('PAGE mini/task'))).toBe(true) // PAGE 块（pageKey 名）经 followup 进入会话
    // instanceTitle 以 user source 的 session/title 落盘：侧栏按它显示
    const titles = h.sessions.get(opened.sessionId)?.titles ?? []
    expect(titles).toEqual([{ title: '任务页', messageSeqs: [], source: { kind: 'user' } }])
    // focus 端口真实实现：openUrl 结束时发了切界面事件
    expect(focusEvents).toEqual([{ sessionId: opened.sessionId }])
  })
})

describe('真机探针的可自动化收编（原 @veren/app-host-verify 六项中的 5/6 项）', () => {
  it('重开同一 URL → 总是新会话：旧会话废弃、工具摘除，索引指向新会话（真实实例索引持久化，非替身）', async () => {
    const h = await boot()
    registerMiniApp(h)
    const first = await h.pages.openUrl('/apps/mini/task/1' as PageInstanceKey)
    // 打开即激活：旧会话的 agent 已在场（工具挂进它的作用域），再重开同 URL
    const scopeA = h.host.scopes.get(first.sessionId)
    if (scopeA === undefined) throw new Error('expected the page agent to activate at open')
    expect([...scopeA.registry.keys()]).toEqual(['mini__read'])
    const second = await h.pages.openUrl('/apps/mini/task/1' as PageInstanceKey)
    expect(second.sessionId).not.toBe(first.sessionId)
    // 索引（URL 键）指向新会话；旧行挪进废弃历史且状态 deprecated
    const rows = await h.pages.instances.listByApp('mini')
    expect(rows.find((row) => row.url === '/apps/mini/task/1' && row.state === 'live')?.sessionId).toBe(second.sessionId)
    expect(rows.some((row) => row.state === 'deprecated' && row.sessionId === first.sessionId)).toBe(true)
    // 旧会话的页面工具已被废弃路径整组摘除；销毁旧 agent 不再是唯一清理者
    expect(scopeA.registry.size).toBe(0)
  })

  it('任务通知经投递泵落进真实会话：重开后的新会话拿到 TASK 块与收件箱 [task-center] 文本', async () => {
    const h = await boot()
    registerMiniApp(h)
    const opened = await h.pages.openUrl('/apps/mini/task/1' as PageInstanceKey)
    void opened // 第一次打开的会话马上被重开废弃；任务落在新会话上
    // 重开同 URL：新建会话（agent 打开即激活）
    const fresh = await h.pages.openUrl('/apps/mini/task/1' as PageInstanceKey)
    const scope = h.host.scopes.get(fresh.sessionId)
    if (scope === undefined) throw new Error('expected the page agent to activate at open')
    const task = await h.tasks.send({
      kind: 'mini/kind' as never, title: '真机验证任务',
      target: { url: '/apps/mini/task/1' as PageInstanceKey, appId: 'mini', page: 'task', params: { taskId: '1' } },
    })
    // 带 taskId 打开 = 再一次新建（废弃上一条），take 成功 → TASK 块进入新会话
    const opened2 = await h.pages.openUrl('/apps/mini/task/1' as PageInstanceKey, { taskId: task.id })
    expect(opened2.sessionId).not.toBe(fresh.sessionId)
    const scope2 = h.host.scopes.get(opened2.sessionId)
    if (scope2 === undefined) throw new Error('expected the reopened page agent to activate at open')
    // TASK 块与收件箱通知在打开流程里 followup 进活 agent
    expect(scope2.followups.some((m) => m.includes(`TASK ${task.id}`))).toBe(true)
    expect(scope2.followups.some((m) => m.includes('[task-center] 真机验证任务'))).toBe(true)
    // 新会话 PAGE 块也在；旧会话没有收到任务的任何块
    expect(scope.followups.some((m) => m.includes(`TASK ${task.id}`))).toBe(false)
  })
})

describe('PAGE-DATA 同步（§3.10.2）走真实装配链：回填镜像携带 live', () => {
  it('先注册（带 store）、后装配 → openUrl 后 store 变化进下一轮 pre-step 的 PAGE-DATA', async () => {
    const h = await boot({ enabled: false })
    // 真机 Loader 的激活顺序：应用插件可能先于装配注册页面（镜像未在，只告警）。
    // 回填必须把 live 绑定一起带过来，否则页面"能开"但"看不到变化"。
    // The loader's activation order: the app may register before the assembly.
    // The backfill must carry the live binding, or the page opens but never syncs.
    const store = makeBoardStore([{ id: 'i-1', title: '基线卡' }])
    const apps = h.ctx.apps
    apps.register({ id: 'board' as AppId, name: 'board', description: '看板应用', entry: 'board' as PageKey }, h.ctx)
    apps.pages('board' as AppId, h.ctx).register(boardPage(), { store })
    wireAppHost(h.ctx)
    const opened = await h.pages.openUrl('/apps/board/board/1' as PageInstanceKey)
    const scope = h.host.scopes.get(opened.sessionId)
    if (scope === undefined) throw new Error('expected the page agent to activate at open')
    // store 变化 → 下一轮 pre-step 的决策消息里真的出现新数据
    // Store change → the next pre-step decision really carries the new data
    store.mutate([{ id: 'i-1', title: '基线卡' }, { id: 'i-2', title: '装配链新卡' }])
    const decision = await runPreStep(h.ctx, scope.ctx, opened.sessionId)
    const injected = decision.messages.at(-1)
    const text = injected?.content.map((block) => (block.type === 'text' ? block.text : '')).join('') ?? ''
    expect(text.startsWith('PAGE-DATA board/board /apps/board/board/1 v')).toBe(true)
    expect(text).toContain('装配链新卡')
  })
})
