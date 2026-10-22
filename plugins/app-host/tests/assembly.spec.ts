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
import type { SessionId } from '@deepseek-ai/dsh-session'
// 与生产同型：每个 agent 一个 createScope（独立 fiber + scope tag），事件过滤才真实
// / same shape as production: one createScope per agent (own fiber + scope tag), so event filtering is real
import { createScope } from '@deepseek-ai/dsh-scope'
import * as Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { defineComponentPage } from '@veren/prompt-page'
import type { ComponentPageRegistration } from '@veren/prompt-page'
import { createElement } from '@veren/prompt-core'
import type { Entity } from '@veren/prompt-core'
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
  /** 该作用域上注册的页面级 skills（按名入表）/ page-scope skills registered on this scope, by name */
  readonly skills: Map<string, unknown>
  disposeAll(): void
}

/**
 * 建一个与生产同型的 agent 作用域：`createScope(parent, agent)` 给出独立 fiber +
 * scope tag，工具服务由该作用域自己提供。tag 必须是**同一个 agent 对象**——
 * `agentEvents(ctx, agent)` 用 agent 作 scopeTarget 的 key，事件过滤才成立。
 * Build a production-shaped agent scope: `createScope(parent, agent)` provides
 * the private fiber + scope tag, and the tools service is provided on that
 * scope. The tag must be the **same agent object** — `agentEvents(ctx, agent)`
 * uses the agent as the scopeTarget key, which is what makes event filtering
 * real.
 * @param parent - 根测试 ctx / the root test ctx
 * @param agent - 该作用域的 agent 对象（同时是 tag）/ the agent object (also the tag)
 * @returns 作用域替身 / the scope stub
 */
function makeAgentScope(parent: Context, agent: Agent): AgentScope {
  const registry = new Map<string, unknown>()
  const followups: string[] = []
  const denials: string[] = []
  const skills = new Map<string, unknown>()
  const scope = createScope(parent, agent)
  // 与真实 AgentRegistry 同型：在带 tag 的作用域下再 isolate('tools') 出独立工具表，
  // 否则与根 ctx 的 tools 服务同名冲突。isolate 继承父的 scope tag，事件过滤仍成立。
  // skills 同款：再 isolate('skills') 出本作用域的技能表（根上有 inject 替身，不
  // isolate 会在 provide 时撞名）。
  // Same shape as the real AgentRegistry: isolate('tools') under the tagged
  // scope for a private tool table; otherwise the root's tools service collides.
  // The isolated child inherits the parent's scope tag, so event filtering holds.
  // skills gets the same treatment: isolate('skills') for this scope's own skill
  // table (the root carries the inject stub; providing without the isolate would
  // collide).
  const ctx = scope.ctx.isolate('tools').isolate('skills')
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
  // 页面级 skills 的替身注册表：挂在 agent 作用域上（真实路径里 ctx.skills 是
  // 宿主共享实例、layer 按 agent 作用域分桶——替身直接按作用域各备一张表）。
  // The fake registry for page-scope skills: provided on the agent scope (in the
  // real path ctx.skills is the host-shared instance with per-agent layers — the
  // stub keeps one table per scope instead).
  ;(ctx.provide as unknown as (n: string, v: unknown) => void)('skills', {
    register: (skill: { name: string }) => {
      skills.set(skill.name, skill)
      return () => { skills.delete(skill.name) }
    },
  })
  return {
    ctx,
    registry,
    followups,
    denials,
    skills,
    disposeAll() {
      // agent fiber 销毁的注销器语义：作用域内全部登记逆序摘除
      // / the agent-fiber teardown semantics: every scope registration goes away
      void scope.dispose()
      registry.clear()
      followups.length = 0
      denials.length = 0
      skills.clear()
    },
  }
}

/** 替身会话记录：页面运行时只读 header.agentPreset（presetOf 的同源字段）与 append
 * / stub session record: the runtime reads only header.agentPreset (presetOf's
 * source) and append */
interface StubSession {
  id: string
  header: { agentPreset: string }
  messages: string[]
  alive: boolean
  titles: Array<{ title: string; source: { kind: string } }>
  append(type: string, data: { title: string; source: { kind: string } }): void
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
  // 装配的 inject 新增 'skills'（页面级 skills 的服务面）：根上给替身，
  // agent 作用域另有按作用域分桶的替身（见 makeAgentScope）。
  // The assembly's inject gained 'skills' (the page-scope skill service face):
  // a root stub, with per-scope stubs in makeAgentScope.
  ;(ctx.provide as unknown as (n: string, v: unknown) => void)('skills', {
    register: () => () => undefined,
  })
  const sessions = new Map<string, StubSession>()
  const scopes = new Map<string, AgentScope>()
  /** 替身会话工厂：带上 append 与会话头（presetOf 的同源字段）/ stub session factory with append and the header (presetOf's source) */
  const newSession = (id: string) => {
    const record: StubSession = {
      id, header: { agentPreset: 'standard' }, messages: [], alive: true, titles: [],
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
  // 稳定 agent 对象：同一会话每次 get 返回同一个对象（它同时是 createScope 的 tag）
  // / stable agent objects: one identity per session (it is also the createScope tag)
  const agentObjects = new Map<string, Agent>()
  const agentView = (id: string): Agent | undefined => {
    if (sessions.get(id)?.alive !== true) return undefined
    return agentObjects.get(id)
  }
  const emit = ctx.emit as unknown as (event: string, payload: unknown) => void
  ;(ctx.provide as unknown as (n: string, v: unknown) => void)('agentDefaultModel', {
    currentSelection: () => ({ provider: 'test', model: 'test-model' }),
  })
  // 工作区注册表（页面会话的归属落点）：默认工作区 + 一个更新的工作区——
  // list() 按注册序（新的在前），默认工作区是最早创建的那条。
  // The workspace registry (the page session's membership home): a default
  // workspace plus a newer one — list() is registry order (newest first), so the
  // default is the oldest entry.
  const defaultWorkspacePath = 'C:\\fake-default-workspace'
  /** 记录加入工作区的会话（attachSession 的断言面）/ records workspace attachments */
  const attached: Array<{ workspaceId: string; sessionId: string }> = []
  const makeWorkspace = (id: string, path: string) => ({
    id,
    path,
    sessionIds: [] as string[],
    attachSession: async (sessionId: string) => { attached.push({ workspaceId: id, sessionId }) },
  })
  ;(ctx.provide as unknown as (n: string, v: unknown) => void)('workspaceRegistry', {
    list: () => [makeWorkspace('ws-newer', 'C:\\fake-newer-workspace'), makeWorkspace('ws-default', defaultWorkspacePath)],
    initializeDefault: async () => makeWorkspace('ws-default', defaultWorkspacePath),
  })
  /** 记录 agents.create 的入参（页面会话 cwd 归属的断言面）/ records agents.create options */
  const agentCreations: Array<{ sessionId: string; cwd?: string }> = []
  ;(ctx.provide as unknown as (n: string, v: unknown) => void)('agents', {
    // 活 agent 面：作用域 ctx + 会话 + followup（会话活着才有）
    get: (id: string) => agentView(id),
    // H 后的创建面：agents.create 连同创建会话并发布 agent/created（打开即激活）
    create: async (options: { sessionId: string; meta?: { cwd?: string } }) => {
      const id = options.sessionId
      agentCreations.push({ sessionId: id, ...(options.meta?.cwd === undefined ? {} : { cwd: options.meta.cwd }) })
      const session = newSession(id)
      sessions.set(id, session)
      // 同一个对象既是 agent 又是 createScope 的 tag：agentEvents 的 carrier key
      // 与作用域标签一致，事件过滤才是真的。
      // One object is both the agent and the createScope tag: the agentEvents
      // carrier key equals the scope tag, so filtering is real.
      const agent = {
        id,
        session,
        followup: (m: { content: Array<{ text?: string }> }) => {
          scopes.get(id)?.followups.push(m.content.map((block) => block.text ?? '').join(''))
        },
      } as unknown as Agent
      const scope = makeAgentScope(ctx, agent)
      ;(agent as { ctx: Context }).ctx = scope.ctx
      scopes.set(id, scope)
      agentObjects.set(id, agent)
      emit('agent/created', { agent })
      return {
        agent,
        dispose: async () => {
          scopes.get(id)?.disposeAll()
          scopes.delete(id)
          agentObjects.delete(id)
          const current = sessions.get(id)
          if (current !== undefined) current.alive = false
          emit('agent/disposed', { agent: { session: { id } } })
        },
      }
    },
  })
  return {
    sessions,
    scopes,
    hostTools,
    agentCreations,
    attached,
    defaultWorkspacePath,
    /** 该会话的稳定 agent 对象（也是作用域 tag）；agent 未创建 → undefined */
    agentOf(id: string): Agent | undefined { return agentObjects.get(id) },
    /** 先发布会话记录、不建 agent：暂存预览 / 队列挂载测试的懒创建场景 */
    publishSession(id: string): StubSession {
      const record = newSession(id)
      sessions.set(id, record)
      return record
    },
    /** agent 销毁：作用域注销器全部执行（真实 cordis 语义）+ 广播 agent/disposed */
    stopAgent(id: string): void {
      scopes.get(id)?.disposeAll()
      scopes.delete(id)
      agentObjects.delete(id)
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

/** 看板详情页（二级页夹具，§3.10 合规）：组件读权威 store 渲染卡片列表
 * / the board detail page (a compliant second-level fixture): the component reads the authoritative store to render cards */
function boardPage(store: { getState(): BoardCard[]; subscribe(listener: () => void): () => void }): ComponentPageRegistration {
  return defineComponentPage(
    () => createElement('ul', { children: store.getState().map((c) => createElement('li', { key: c.id, children: c.title })) }),
    {
      name: 'board',
      url: '/apps/board/board/:id',
      description: '看板页',
      tools: ['pin'],
      writes: true,
      instructions: '只处理 params.id 指定的这一块看板。',
      store,
    },
  )
}

/** 在该会话的 agent 作用域上跑一轮 pre-step（最内层 next 返回已认领消息）
 * / run one pre-step in that session's agent scope (innermost next returns the claimed messages) */
async function runPreStep(ctx: Context, agent: Agent): Promise<PreStepDecision> {
  // 用稳定的 agent 对象派发：它与 createScope 的 tag 同一身份，agent.ctx 上的
  // pre-step 监听器（staging / PAGE-DATA）才会被作用域过滤放行。
  // Dispatch with the stable agent object: it is the same identity as the
  // createScope tag, so pre-step listeners on agent.ctx pass the scope filter.
  const claimed: UserMessage[] = [createUserMessage({ content: [{ type: 'text', text: '继续' }], source: { kind: 'user' } })]
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

/** 迷你应用：两级页面（一级首页 + 参数化详情）+ 一读一写两个工具（§3.10 合规夹具）
 * / a mini app: two levels (a home page + a parameterized detail) and one read +
 * one write tool (a §3.10-compliant fixture) */
function registerMiniApp(h: Boot, eventDeliveries: string[] = []): void {
  const { ctx } = h
  const apps = ctx.apps
  apps.register({ id: 'mini' as AppId, name: 'mini', description: '装配层验证应用', entry: 'list' as PageKey }, ctx)
  const tools = apps.tools('mini' as AppId, ctx)
  tools.define(defineTool({
    name: 'read',
    description: '读取材料',
    parameters: {},
    output: { schema: { type: 'object', additionalProperties: true } as const, render: () => [] },
    execute: async () => ({ ok: true }),
  }), { requires: ['files:read' as AppCapability] })
  // 写工具：二级页规则 3 要求详情页至少挂一个写工具 / the write tool: rule 3 wants a write tool on the detail page
  tools.define(defineTool({
    name: 'write',
    description: '写入材料。Parameters: text.',
    parameters: { text: { type: 'string', required: true, description: '要写入的文本' } },
    output: { schema: { type: 'object', additionalProperties: true } as const, render: () => [] },
    execute: async () => ({ ok: true }),
  }))
  const pages = apps.pages('mini' as AppId, ctx)
  // 事件页：`ctx.page.on` 注册在该会话的 agent 作用域（跨会话隔离断言）
  // / an event page: `ctx.page.on` registers on that session's agent scope (cross-session isolation)
  pages.register(
    (_props: Record<string, string>, pageCtx) => {
      pageCtx.page.on('agent/status', (payload: unknown) => {
        const status = (payload as { status?: string }).status
        if (status !== undefined) eventDeliveries.push(status)
      })
      return createElement('p', { children: '事件页' })
    },
    { url: '/apps/mini/events/:id', description: '事件页', instructions: '事件页：只报事件。' },
  )
  // 一级页（entry）：map 由注册表推导（§3.5 定案），不再手写
  // / the home page (entry): the map is registry-derived (§3.5), never hand-written
  pages.register(
    (props: { id?: string }) => createElement('p', { children: `任务 ${props.id ?? ''}` }),
    // 首页也挂一个只读工具：暂存测试要观察"预挂的面非空且提升后不重复"
    // / the home page mounts one read tool too: the staging test observes a
    // non-empty pre-mounted face that does not duplicate at promotion
    { url: '/apps/mini/list', description: '任务列表页', tools: ['read'], instructions: '这是 mini 应用的首页：看列表，去详情。' },
  )
  // 二级页：带参数 + writes + 工具 + 说明 + 页面级 skill（skills 挂载断言面）
  // / the detail page: params + writes + tools + instructions + a page-scope
  // skill (the skills-mounting assertion face)
  pages.register(
    (props: { id?: string }) => createElement('p', { children: `任务 ${props.id ?? ''}` }),
    {
      url: '/apps/mini/task/:id',
      description: '任务页',
      tools: ['read', 'write'],
      writes: true,
      instructions: '只处理 params.id 指定的这一条任务。',
      skills: [{ name: 'mini-skill', description: '任务页专属技能', content: '# mini skill\n只在任务页可见。' }],
    },
  )
}

describe('装配是一处：wireAppHost 显式接上全部接缝', () => {
  it('resolver / 镜像面 / 会话端口由装配接好：发任务校验发送方、页面可被 openUrl 解析', async () => {
    const h = await boot()
    registerMiniApp(h)
    // 镜像面：apps.pages 单入口注册 → openUrl 直接可解析（装配接的线在起作用）
    const opened = await h.pages.openUrl('/apps/mini/task/1' as PageInstanceKey)
    expect(opened.sessionId).toBeTypeOf('string')
    // 页面会话加入部署默认工作区：会话头 cwd 决定工作区归属（真机缺陷：曾落进
    // 「未分组」——进程 cwd 不属于任何工作区）。
    // / the page session joins the deployment default workspace: the header cwd
    // decides membership (live defect: it used to land in "ungrouped" because
    // the process cwd belongs to no workspace).
    expect(h.host.agentCreations.at(-1)).toEqual({
      sessionId: opened.sessionId,
      cwd: h.host.defaultWorkspacePath,
    })
    // 候选表登记同样必需：sessionIds 是候选列表的过滤视图，不 attach 就只剩 cwd
    // / the candidate account is required too: sessionIds filters the candidate list
    expect(h.host.attached.at(-1)).toEqual({ workspaceId: 'ws-default', sessionId: opened.sessionId })
    // resolver：未注册应用 send 被拒（装配接的线在起作用）
    await expect(h.tasks.send({
      kind: 'mini/kind' as never, title: 't',
      target: { url: '/apps/mini/task/1' as PageInstanceKey, appId: 'ghost', page: 'task', params: {} },
    })).rejects.toMatchObject({ code: 'task/send-forbidden' })
  })

  it('页面级 skills 随工具进 agent 作用域：本页可见，重开（废弃）时与工具同组释放', async () => {
    const h = await boot()
    registerMiniApp(h)
    // 详情页声明了 mini-skill：agent/created 即挂进该会话的作用域
    // / the detail page declares mini-skill: it lands in the scope at agent/created
    const opened = await h.pages.openUrl('/apps/mini/task/1' as PageInstanceKey)
    const firstScope = h.host.scopes.get(opened.sessionId)
    if (firstScope === undefined) throw new Error('expected the first page session scope')
    expect(firstScope.skills.has('mini-skill')).toBe(true)
    expect(firstScope.registry.has('mini__read')).toBe(true)
    // 重开同 URL：旧会话废弃 → releaseTools 摘工具，skills 注销器同组逆序执行
    // / reopen the same url: the old session is deprecated → releaseTools strips
    // the tools and the skill disposers run in the same reverse-order group
    const reopened = await h.pages.openUrl('/apps/mini/task/1' as PageInstanceKey)
    expect(firstScope.skills.has('mini-skill')).toBe(false)
    expect(firstScope.registry.has('mini__read')).toBe(false)
    const secondScope = h.host.scopes.get(reopened.sessionId)
    if (secondScope === undefined) throw new Error('expected the second page session scope')
    expect(secondScope.skills.has('mini-skill')).toBe(true)
  })

  it('网关 sessionApp：页面会话解析到所属应用（工具栏"已选应用"的事实源），普通会话 null', async () => {
    const h = await boot()
    registerMiniApp(h)
    const opened = await h.pages.openUrl('/apps/mini/list' as PageInstanceKey)
    const owner = await h.ctx.appHost.sessionApp(opened.sessionId)
    expect(owner?.id).toBe('mini')
    expect(owner?.name).toBe('mini')
    // 普通会话（不在页面实例索引里）→ null，工具栏保持下拉
    // / an ordinary session (absent from the page instance index) → null; the toolbar keeps the dropdown
    expect(await h.ctx.appHost.sessionApp('session-ordinary')).toBeNull()
    // 被重开取代的旧会话是废弃行，不再属于该应用（查询只认 live 行）
    // / a session superseded by a reopen is a deprecated row and no longer owns
    // the app (the query counts live rows only)
    const reopened = await h.pages.openUrl('/apps/mini/list' as PageInstanceKey)
    expect(await h.ctx.appHost.sessionApp(opened.sessionId)).toBeNull()
    expect((await h.ctx.appHost.sessionApp(reopened.sessionId))?.id).toBe('mini')
  })

  it('暂存应用：选中不建会话，首条消息的 pre-step 把该会话提升为页面会话', async () => {
    const h = await boot()
    registerMiniApp(h)
    // GUI 的普通会话（"未命名"）：先存在，用户还没发送
    // / the GUI's ordinary session ("untitled"): it exists before the user sends
    // 品牌收窄只发生在测试边界（与生产 spawn/会话端口的 sid() 同一纪律）
    // / the brand narrows once at the test boundary (the same rule as the host's sid())
    const sessionId = 'session-gui-1' as SessionId
    await h.ctx.agents.create({
      sessionId,
      agentOptions: { provider: 'test', model: 'test-model' },
      meta: { cwd: h.host.defaultWorkspacePath, agentPreset: 'standard' },
    })
    // 选中应用：预挂工具面 + 登记意图，不建页面实例 / the pick pre-mounts the face and records intent; no instance
    const staged = await h.ctx.appHost.stage('mini', sessionId)
    expect(staged.id).toBe('mini')
    expect(await h.pages.instances.listByApp('mini')).toHaveLength(0)
    // 工具栏显示已选应用（暂存态）/ the toolbar shows the selected app (staged)
    expect(await h.ctx.appHost.sessionApp(sessionId)).toMatchObject({ id: 'mini' })
    const scope = h.host.scopes.get(sessionId)
    if (scope === undefined) throw new Error('expected the agent scope')
    // 发送前工具面就已挂好：第一步请求头 = 最终形态；引导工具同时被屏蔽
    // / the face is mounted before the send: step 1's header is final, and the
    // bootstrap tools are denied at the same time
    expect([...scope.registry.keys()]).toEqual(['mini__read'])
    expect(scope.denials).toEqual(['app_open', 'app_list', 'app_pages'])
    const previewFace = [...scope.registry.values()].map((tool) => JSON.stringify(tool))
    // 首条消息的 pre-step：提升为页面会话 / the first message's pre-step promotes it
    const agent = h.host.agentOf(sessionId)
    if (agent === undefined) throw new Error('expected the stable agent object')
    const decision = await runPreStep(h.ctx, agent)
    expect(decision.kind).toBe('enter')
    const rows = await h.pages.instances.listByApp('mini')
    expect(rows.some((row) => row.sessionId === sessionId && row.state === 'live')).toBe(true)
    // PAGE 块进入本轮决策（而不是事后补一条日志）/ the PAGE block enters this round's decision
    expect(JSON.stringify(decision)).toContain('PAGE mini/')
    // 正式提升重挂同一套定义：没有重复登记，定义逐字相同（第二步不会"工具已更新"）
    // / the promotion re-mounts the same definitions: no duplicates, byte-identical
    // (step 2 must not report "tools updated")
    expect([...scope.registry.keys()]).toEqual(['mini__read'])
    expect([...scope.registry.values()].map((tool) => JSON.stringify(tool))).toEqual(previewFace)
    // 侧栏标题换成实例标题 / the sidebar title becomes the instance title
    expect(h.host.sessions.get(sessionId)?.titles).toContainEqual(expect.objectContaining({ title: '任务列表页' }))
  })

  it('暂存时 agent 尚未创建：预挂工具排队到 agent/created，首条消息第一步可见', async () => {
    const h = await boot()
    registerMiniApp(h)
    const sessionId = 'session-gui-lazy' as SessionId
    // GUI 的会话记录先存在，agent 懒创建（发送首条消息时）——暂存预览必须能等
    // / the GUI session record exists first; the agent is lazy (created on send) — staging must wait
    h.host.publishSession(sessionId)
    await h.ctx.appHost.stage('mini', sessionId)
    // 还没有 agent：工具在端口的等待队列里，没有作用域可挂
    // / no agent yet: the tools wait in the port queue, with no scope to mount on
    expect(h.host.scopes.get(sessionId)).toBeUndefined()
    expect(await h.pages.instances.listByApp('mini')).toHaveLength(0)
    // 首条消息前创建 agent：agent/created 把队列里的工具面挂上
    // / the agent is created before the first message: agent/created mounts the queued face
    await h.ctx.agents.create({
      sessionId,
      agentOptions: { provider: 'test', model: 'test-model' },
      meta: { cwd: h.host.defaultWorkspacePath, agentPreset: 'standard' },
    })
    const scope = h.host.scopes.get(sessionId)
    if (scope === undefined) throw new Error('expected the agent scope after creation')
    expect([...scope.registry.keys()]).toEqual(['mini__read'])
    expect(scope.denials).toEqual(['app_open', 'app_list', 'app_pages'])
    const agent = h.host.agentOf(sessionId)
    if (agent === undefined) throw new Error('expected the stable agent object')
    const decision = await runPreStep(h.ctx, agent)
    expect(JSON.stringify(decision)).toContain('PAGE mini/')
    // 正式提升重挂同一套定义，仍只有一份 / the promotion re-mounts the same definitions, no duplicates
    expect([...scope.registry.keys()]).toEqual(['mini__read'])
    expect(h.host.sessions.get(sessionId)?.titles).toContainEqual(expect.objectContaining({ title: '任务列表页' }))
    const rows = await h.pages.instances.listByApp('mini')
    expect(rows.some((row) => row.sessionId === sessionId && row.state === 'live')).toBe(true)
  })

  it('取消暂存：预挂的工具面整组摘掉，首条消息按普通会话走（不提升）', async () => {
    const h = await boot()
    registerMiniApp(h)
    const sessionId = 'session-gui-2' as SessionId
    await h.ctx.agents.create({
      sessionId,
      agentOptions: { provider: 'test', model: 'test-model' },
      meta: { cwd: h.host.defaultWorkspacePath, agentPreset: 'standard' },
    })
    await h.ctx.appHost.stage('mini', sessionId)
    const scope = h.host.scopes.get(sessionId)
    if (scope === undefined) throw new Error('expected the agent scope')
    expect([...scope.registry.keys()]).toEqual(['mini__read'])
    await h.ctx.appHost.unstage(sessionId)
    // 工具与屏蔽一起撤销（restrict 的注销器随挂载整组释放）
    // / tools and the deny are undone together (the restrict disposer goes with the mounted set)
    expect(scope.registry.size).toBe(0)
    expect(scope.denials).toEqual([])
    const agent = h.host.agentOf(sessionId)
    if (agent === undefined) throw new Error('expected the stable agent object')
    const decision = await runPreStep(h.ctx, agent)
    expect(JSON.stringify(decision)).not.toContain('PAGE mini/')
    expect(await h.pages.instances.listByApp('mini')).toHaveLength(0)
    expect(await h.ctx.appHost.sessionApp(sessionId)).toBeNull()
  })

  it('agent 销毁带走预挂面与暂存意图：重建后的首条消息不会用旧工具面跑第一步', async () => {
    const h = await boot()
    registerMiniApp(h)
    const sessionId = 'session-gui-3' as SessionId
    await h.ctx.agents.create({
      sessionId,
      agentOptions: { provider: 'test', model: 'test-model' },
      meta: { cwd: h.host.defaultWorkspacePath, agentPreset: 'standard' },
    })
    await h.ctx.appHost.stage('mini', sessionId)
    h.host.stopAgent(sessionId)
    // 暂存意图随 agent 一起消失：工具栏退回下拉，不会显示一个已经挂不上的面
    // / the intent dies with the agent: the toolbar falls back to the dropdown
    expect(await h.ctx.appHost.sessionApp(sessionId)).toBeNull()
    // 重建 agent 后首条消息按普通会话走：没有 PAGE 块、没有页面实例
    // / after recreation the first message runs as an ordinary session: no PAGE block, no instance
    await h.ctx.agents.create({
      sessionId,
      agentOptions: { provider: 'test', model: 'test-model' },
      meta: { cwd: h.host.defaultWorkspacePath, agentPreset: 'standard' },
    })
    const scope = h.host.scopes.get(sessionId)
    if (scope === undefined) throw new Error('expected the recreated agent scope')
    const agent = h.host.agentOf(sessionId)
    if (agent === undefined) throw new Error('expected the recreated agent object')
    const decision = await runPreStep(h.ctx, agent)
    expect(JSON.stringify(decision)).not.toContain('PAGE mini/')
    expect(await h.pages.instances.listByApp('mini')).toHaveLength(0)
  })

  it('已是页面会话 → 拒绝暂存；不存在的会话 → session/not-found（不泄漏工具）', async () => {
    const h = await boot()
    registerMiniApp(h)
    const opened = await h.pages.openUrl('/apps/mini/list' as PageInstanceKey)
    await expect(h.ctx.appHost.stage('mini', opened.sessionId))
      .rejects.toMatchObject({ code: 'session/has-app' })
    await expect(h.ctx.appHost.stage('mini', 'ghost-session'))
      .rejects.toMatchObject({ code: 'session/not-found' })
  })

  it('装配 disposer 撤销全部注入：dispose 后镜像失效（注册只告警不镜像）', async () => {
    const ctx = new Context()
    ;(ctx.provide as unknown as (n: string, v: unknown) => void)('sessions', { get: () => undefined, create: () => ({}) })
    ;(ctx.provide as unknown as (n: string, v: unknown) => void)('agents', { get: () => undefined })
    ;(ctx.provide as unknown as (n: string, v: unknown) => void)('skills', { register: () => () => undefined })
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
      apps.pages('solo' as AppId).register(
        () => createElement('p', { children: 'main' }),
        { url: '/apps/solo/main', description: 'd' },
      )
      expect(warnings.some((m) => m.includes('no page mirror wired'))).toBe(true)
      expect(ctx.pageRegistry.resolve('/apps/solo/main')).toBeNull() // 未镜像
    } finally {
      ;(ctx.logger as { warn: (m: string) => void }).warn = original
      await jsonFiber.dispose().catch(() => undefined)
    }
  })

  it('§3.9 完备性警告不被本轮 viewer 放宽削弱：writes:true + 零工具仍由装配打出警告，viewer 保持沉默', async () => {
    // viewer 档落地的回归钉：只读详情页如实注册（不声明 writes）后，
    // "声明要写却没挂工具"的警告通道必须原样工作——防的是另一种错。
    // / regression pin for the viewer tier: with read-only drilldowns registering
    // honestly (no writes declaration), the declares-writes-but-no-tools warning
    // channel must keep working unchanged — it guards a different mistake.
    const h = await boot({ enabled: false })
    const apps = h.ctx.apps
    apps.register({ id: 'lazy' as AppId, name: 'lazy', description: 'd', entry: 'main' as PageKey }, h.ctx)
    const pages = apps.pages('lazy' as AppId, h.ctx)
    pages.register(
      () => createElement('p', { children: 'main' }),
      { url: '/apps/lazy/main', description: 'd' },
    )
    pages.register(
      // viewer：带参、只读、零工具——本轮放宽的受益者，警告对它必须沉默
      // / the viewer: parameterized, read-only, no tools — this round's beneficiary, the warning must stay silent for it
      () => createElement('p', { children: 'ws' }),
      { url: '/apps/lazy/ws/:id', description: 'd' },
    )
    pages.register(
      // action：writes: true + 零工具——警告必须照常打出 / the action page: writes: true + no tools — the warning must still fire
      () => createElement('p', { children: 'publish' }),
      { url: '/apps/lazy/publish', description: 'd', writes: true, instructions: '确认后发布' },
    )
    const warnings: string[] = []
    const original = h.ctx.logger.warn
    ;(h.ctx.logger as { warn: (m: string) => void }).warn = (m: string) => { warnings.push(m) }
    try {
      wireAppHost(h.ctx)
      const coverage = warnings.filter((m) => m.includes('declares writes: true but mounts no tools'))
      expect(coverage).toHaveLength(1)
      expect(coverage[0]).toContain('lazy/publish') // 警告点名的是 pageKey / the warning names the pageKey
      expect(coverage[0]).not.toContain('lazy/ws')
    } finally {
      ;(h.ctx.logger as { warn: (m: string) => void }).warn = original
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
      h.ctx.apps.pages('mini' as AppId, h.ctx).register(
        () => createElement('p', { children: 'solo' }),
        { url: '/apps/mini/solo', description: 'd' },
      )
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
    // 夹具按 §3.10 合规：详情页是真正的 :param 页（旧夹具是字面量
    // /apps/twin/task/1 的"详情形态"页，本轮已清掉）。
    // The fixture is §3.10-compliant: the detail page is a real :param page (the
    // old fixture was a literal /apps/twin/task/1 "detail-shaped" page, removed
    // this round).
    const apps = h.ctx.apps
    apps.register({ id: 'twin' as AppId, name: 'twin', description: '同名页面应用', entry: 'list' as PageKey }, h.ctx)
    apps.tools('twin' as AppId, h.ctx).define(defineTool({
      name: 'read', description: '读取', parameters: {},
      output: { schema: { type: 'object', additionalProperties: true } as const, render: () => [] },
      execute: async () => ({}),
    }))
    const twinPages = apps.pages('twin' as AppId, h.ctx)
    twinPages.register(
      () => createElement('p', { children: 'twin list' }),
      { url: '/apps/twin/list', description: '同名页列表', instructions: 'twin 首页。' },
    )
    twinPages.register(
      () => createElement('p', { children: 'twin task' }),
      { url: '/apps/twin/task/:taskId', description: '同名页', tools: ['read'], writes: true, instructions: '只处理这一条任务。' },
    )
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
    expect([...scopeA.registry.keys()]).toEqual(['mini__read', 'mini__write'])
    expect([...scopeB.registry.keys()]).toEqual(['mini__read', 'mini__write'])
    // 页面引导工具在页面作用域内被屏蔽（递归自开防护 + 作用域互斥）
    expect(scopeA.denials).toEqual(['app_open', 'app_list', 'app_pages'])
    // 作用域实例不同：A 的登记与 B 的登记是两个真实的、分开的表
    expect(scopeA.ctx).not.toBe(scopeB.ctx)
    // 销毁 A 的 agent（作用域随 fiber 注销）：A 工具消失，B 原样
    h.host.stopAgent(a.sessionId)
    expect(scopeA.registry.size).toBe(0)
    expect([...scopeB.registry.keys()]).toEqual(['mini__read', 'mini__write'])
  })

  it('打开即激活：openUrl 返回时 agent 已在场，页面工具已挂、PAGE 块已 followup、标题已落盘', async () => {
    const h = await boot()
    registerMiniApp(h)
    const focusEvents: Array<{ sessionId: string }> = []
    h.ctx.on('app-host/focus', (payload) => { focusEvents.push(payload) })
    const opened = await h.pages.openUrl('/apps/mini/task/1' as PageInstanceKey)
    const scope = h.host.scopes.get(opened.sessionId)
    if (scope === undefined) throw new Error('expected the page agent to activate at open')
    expect([...scope.registry.keys()]).toEqual(['mini__read', 'mini__write']) // 工具只对该 agent 可见
    expect(scope.followups.some((m) => m.startsWith('PAGE mini/task'))).toBe(true) // PAGE 块（pageKey 名）经 followup 进入会话
    // instanceTitle 以 user source 的 session/title 落盘：侧栏按它显示
    const titles = h.sessions.get(opened.sessionId)?.titles ?? []
    expect(titles).toEqual([{ title: '任务页', messageSeqs: [], source: { kind: 'user' } }])
    // focus 端口真实实现：openUrl 结束时发了切界面事件
    expect(focusEvents).toEqual([{ sessionId: opened.sessionId }])
  })

  it('ctx.page.on 挂在各自 agent 作用域：两个页面会话互不串事件（scopeTarget 过滤）', async () => {
    const h = await boot()
    const deliveries: string[] = []
    registerMiniApp(h, deliveries)
    const a = await h.pages.openUrl('/apps/mini/events/1' as PageInstanceKey)
    const b = await h.pages.openUrl('/apps/mini/events/2' as PageInstanceKey)
    const agentA = h.host.agentOf(a.sessionId)
    const agentB = h.host.agentOf(b.sessionId)
    if (agentA === undefined || agentB === undefined) throw new Error('expected both stable agents')
    agentEvents(h.ctx, agentA).emit('agent/status', { status: 'idle' })
    // 只有 A 会话的监听器收到；订阅若落在无标签 ctx，这里会是 2
    // / only A's listener fires; an untagged ctx subscription would make this 2
    expect(deliveries).toHaveLength(1)
    agentEvents(h.ctx, agentB).emit('agent/status', { status: 'idle' })
    expect(deliveries).toHaveLength(2)
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
    expect([...scopeA.registry.keys()]).toEqual(['mini__read', 'mini__write'])
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
    // entry 是无参一级页（§3.10.5 规则 1/4）；带参的看板页是二级页
    // / the entry is a parameterless home page (rules 1/4); the parameterized board page is a detail page
    apps.register({ id: 'board' as AppId, name: 'board', description: '看板应用', entry: 'home' as PageKey }, h.ctx)
    apps.tools('board' as AppId, h.ctx).define(defineTool({
      name: 'pin', description: '置顶一张卡片', parameters: {},
      output: { schema: { type: 'object', additionalProperties: true } as const, render: () => [] },
      execute: async () => ({ ok: true }),
    }))
    const boardPages = apps.pages('board' as AppId, h.ctx)
    boardPages.register(
      () => createElement('p', { children: '看板首页' }),
      { name: 'home', url: '/apps/board/board', description: '看板首页', instructions: '看板首页。' },
    )
    const boardRegistration = boardPage(store)
    boardPages.register(boardRegistration)
    wireAppHost(h.ctx)
    const opened = await h.pages.openUrl('/apps/board/board/1' as PageInstanceKey)
    const scope = h.host.scopes.get(opened.sessionId)
    if (scope === undefined) throw new Error('expected the page agent to activate at open')
    // store 变化 → 下一轮 pre-step 的决策消息里真的出现新数据
    // Store change → the next pre-step decision really carries the new data
    store.mutate([{ id: 'i-1', title: '基线卡' }, { id: 'i-2', title: '装配链新卡' }])
    const agent = h.host.agentOf(opened.sessionId)
    if (agent === undefined) throw new Error('expected the page agent object')
    const decision = await runPreStep(h.ctx, agent)
    // PreStepDecision 是可判别联合：reject 在测试里就是失败
    // PreStepDecision is a discriminated union; a reject decision is a test failure here
    if (decision.kind !== 'enter') throw new Error('expected the pre-step to admit messages')
    const injected = decision.messages.at(-1)
    const text = injected?.content.map((block) => (block.type === 'text' ? block.text : '')).join('') ?? ''
    expect(text.startsWith('PAGE-PATCH board/board /apps/board/board/1 v')).toBe(true)
    expect(text).toContain('装配链新卡')
  })
})
