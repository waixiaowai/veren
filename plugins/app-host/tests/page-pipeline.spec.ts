/**
 * 页面管线端到端（真实 agent-loop 输入面）：注册页面 → 打开 URL → PAGE 块
 * （头行 + 正文）全链走生产代码。
 * The page pipeline end to end (the real agent-loop's input faces): register a
 * page → open the url → the PAGE block (header + body), all through production
 * code.
 *
 * 真实程度（如实）：真实 cordis 装配 + 真实 storage 栈（临时目录）+ 真实
 * page-registry 运行时（openPageUrl/createPageSession 全链）+ 真实组件页的一次
 * 性渲染（load 快照与 store 直读都经真实 Markdown 正文）。PAGE 块按 agent-loop
 * 的输入面断言：请求头 = 该会话工具表里登记的工具面（loop 据此序列化请求头）；
 * 正文 = followup 进会话的 PAGE 块。不跑真 LLM：请求的后续编码归 agent-loop
 * 自己的单测，这里钉的是宿主交出去的输入面。
 * Fidelity: a real cordis assembly + a real storage stack (temp dirs) + the real
 * page-registry runtime (openPageUrl/createPageSession in full) + the real
 * component page's one-shot render (both the load snapshot and the store read
 * produce real Markdown bodies). The PAGE block is asserted on the input faces
 * the agent loop consumes: the header = the tool face registered in the
 * session's tool table (the loop serializes the header from it); the body = the
 * PAGE block pushed into the session via followup. No real LLM: the downstream
 * encoding of a request belongs to agent-loop's own unit tests; this file pins
 * the input faces the host hands over.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
// 与生产同型：每个 agent 一个 createScope（独立 fiber + scope tag），事件过滤才真实
// / same shape as production: one createScope per agent (own fiber + scope tag)
import { createScope } from '@deepseek-ai/dsh-scope'
import * as Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { defineComponentPage } from '@veren/prompt-page'
import { createElement } from '@veren/prompt-core'
import type { Entity } from '@veren/prompt-core'
import AppRegistryPlugin from '@veren/app-registry'
import type { AppId, PageKey } from '@veren/app-registry'
import PageRegistryPlugin from '@veren/page-registry'
import type { PageRegistryService } from '@veren/page-registry'
import TaskCenterPlugin from '@veren/task-center'
import type { PageInstanceKey } from '@veren/prompt-page'
import { apply, Config, inject, name } from '../src/index.ts'

// ---- 每会话一个真实 cordis 子上下文的 agent 作用域替身（与 assembly.spec 同型） ----
// ---- Per-session agent scopes: real cordis child contexts (same shape as assembly.spec) ----

/** 一个 agent 作用域：cordis 子上下文 + 它自己的工具表 / one agent scope: a child context with its own tool table */
interface AgentScope {
  readonly ctx: Context
  readonly registry: Map<string, unknown>
  /** followup 进活 agent 的块文本（PAGE 块落点）/ block texts pushed via followup (the PAGE block's landing) */
  readonly followups: string[]
  readonly denials: string[]
  disposeAll(): void
}

/**
 * 建一个与生产同型的 agent 作用域：tag 必须是同一个 agent 对象，事件过滤才成立。
 * Build a production-shaped agent scope: the tag must be the same agent object
 * so event filtering holds.
 */
function makeAgentScope(parent: Context, agent: Agent): AgentScope {
  const registry = new Map<string, unknown>()
  const followups: string[] = []
  const denials: string[] = []
  const scope = createScope(parent, agent)
  // 与真实 AgentRegistry 同型：isolate('tools') 出独立工具表，避免与根 ctx 撞名
  // / same shape as the real AgentRegistry: isolate('tools') for a private table
  const ctx = scope.ctx.isolate('tools')
  ;(ctx.provide as unknown as (n: string, v: unknown) => void)('tools', {
    register: (tool: { name: string }) => {
      registry.set(tool.name, tool)
      return () => { registry.delete(tool.name) }
    },
    // 一次性渲染的工具差集读这里：schemas 每次从登记表拷贝快照
    // / the one-shot render's tool delta reads here: schemas copies a snapshot per call
    schemas: () => [...registry.values()].map((tool) => ({ name: (tool as { name: string }).name, description: (tool as { description?: string }).description ?? '' })),
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
      void scope.dispose()
      registry.clear()
      followups.length = 0
      denials.length = 0
    },
  }
}

/** 替身会话记录：页面运行时只读 header.agentPreset 与 append / stub session record */
interface StubSession {
  id: string
  header: { agentPreset: string }
  alive: boolean
  titles: Array<{ title: string; source: { kind: string } }>
  append(type: string, data: { title: string; source: { kind: string } }): void
}

/** 最小 agents/sessions 结构面：live agent 表 + agent/created、agent/disposed 事件 */
function makeHostSessions(ctx: Context) {
  const hostTools = new Map<string, unknown>()
  ;(ctx.provide as unknown as (n: string, v: unknown) => void)('tools', {
    register: (tool: { name: string }) => {
      hostTools.set(tool.name, tool)
      return () => { hostTools.delete(tool.name) }
    },
  })
  // 装配的 inject 声明 'skills'（页面级 skills 服务面）：本文件不测 skills，给替身
  // / the assembly injects 'skills' (the page-scope skill service face): a stub here
  ;(ctx.provide as unknown as (n: string, v: unknown) => void)('skills', {
    register: () => () => undefined,
  })
  const sessions = new Map<string, StubSession>()
  const scopes = new Map<string, AgentScope>()
  const newSession = (id: string): StubSession => {
    const record: StubSession = {
      id, header: { agentPreset: 'standard' }, alive: true, titles: [],
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
  const agentObjects = new Map<string, Agent>()
  const emit = ctx.emit as unknown as (event: string, payload: unknown) => void
  ;(ctx.provide as unknown as (n: string, v: unknown) => void)('agentDefaultModel', {
    currentSelection: () => ({ provider: 'test', model: 'test-model' }),
  })
  const defaultWorkspacePath = 'C:\\fake-default-workspace'
  const makeWorkspace = (id: string, path: string) => ({
    id, path, sessionIds: [] as string[],
    attachSession: async () => undefined,
  })
  ;(ctx.provide as unknown as (n: string, v: unknown) => void)('workspaceRegistry', {
    list: () => [makeWorkspace('ws-default', defaultWorkspacePath)],
    initializeDefault: async () => makeWorkspace('ws-default', defaultWorkspacePath),
  })
  ;(ctx.provide as unknown as (n: string, v: unknown) => void)('agents', {
    get: (id: string) => (sessions.get(id)?.alive === true ? agentObjects.get(id) : undefined),
    create: async (options: { sessionId: string; meta?: { cwd?: string } }) => {
      const id = options.sessionId
      const session = newSession(id)
      sessions.set(id, session)
      // 同一个对象既是 agent 又是 createScope 的 tag：事件过滤与作用域对齐
      // / one object is both the agent and the createScope tag
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
    defaultWorkspacePath,
    /** 该会话的稳定 agent 对象（也是作用域 tag）/ the session's stable agent object */
    agentOf(id: string): Agent | undefined { return agentObjects.get(id) },
  }
}

// ---- 装配 + 一个"管线"应用（load 列表页 + load 详情页） ----
// ---- The assembly + one "pipeline" app (a load list page + a load detail page) ----

const roots: string[] = []
const made: Array<() => Promise<void>> = []

afterEach(async () => {
  for (const dispose of made.reverse()) await dispose()
  made.length = 0
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'page-pipeline-'))
  roots.push(root)
  return root
}

interface Boot {
  ctx: Context
  host: ReturnType<typeof makeHostSessions>
  pages: PageRegistryService
  dispose(): Promise<void>
}

async function boot(): Promise<Boot> {
  const ctx = new Context()
  const host = makeHostSessions(ctx)
  const storageFiber = await ctx.plugin(Storage.default)
  const jsonFiber = await ctx.plugin(StorageJson, { root: tempRoot() })
  const domainFiber = await ctx.plugin(StorageDomain, { backend: 'json' })
  await ctx.plugin(AppRegistryPlugin)
  await ctx.plugin(PageRegistryPlugin)
  await ctx.plugin(TaskCenterPlugin)
  const fh = await ctx.plugin({ name, inject, apply, Config }, { enabled: true })
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
  return { ctx, host, pages, dispose }
}

/** 看板条目 / one board card */
interface Card extends Entity { readonly title: string }

/** 权威 store 假件：可变、引用稳定 / the authoritative store fake */
function makeStore(initial: Card[]): { getState(): Card[] } {
  let items = initial
  return { getState: () => items }
}

/**
 * 注册管线应用：列表页（load 读权威 store 的当前状态——一次性渲染的唯一数据
 * 通道）+ 详情页（正文来自 load 产出）。
 * Register the pipeline app: a list page (load reads the authoritative store's
 * current state — the one-shot render's only data channel) + a detail page
 * (its body comes from the load result).
 */
function registerPipelineApp(h: Boot): { url: PageInstanceKey } {
  const { ctx } = h
  const store = makeStore([{ id: 'i-1', title: '首屏基线' }])
  const apps = ctx.apps
  apps.register({ id: 'pipeline' as AppId, name: 'pipeline', description: '页面管线验证应用', entry: 'list' as PageKey }, ctx)
  const pages = apps.pages('pipeline' as AppId, ctx)
  // 列表页：load 读权威 store 的当前状态，组件经 useSnapshot() 渲染首屏——
  // 工具在体里直登（全名，跑一次，安全）。
  // / the list page: load reads the store's current state, the component renders
  // the first screen via useSnapshot() — the tool registers in the body (full
  // name, run once, safe).
  pages.register(defineComponentPage(
    (_props, agent) => {
      agent.ctx.tools.register(defineTool({
        name: 'pipeline__pin', description: '置顶一张卡片。', parameters: {},
        output: { schema: { type: 'object', additionalProperties: true } as const, render: () => [] },
        execute: async () => ({ ok: true }),
      }))
      const cards = store.getState()
      return createElement('ul', { children: cards.map((c) => createElement('li', { key: c.id, children: `${c.id} ${c.title}` })) })
    },
    {
      name: 'list', url: '/apps/pipeline/list', description: '看板列表页',
    },
  ))
  // 详情页：正文按 params 直读（同步可得的派生值在体内现算）。
  // / the detail page: the body reads by params directly (a synchronously
  // derivable value computes in place).
  pages.register(defineComponentPage(
    (props: { id?: string }) => {
      const doc = { doc: `七号-${props.id ?? ''}`, owner: '天权' }
      return createElement('p', { children: `文档 ${doc.doc}（归属 ${doc.owner}）` })
    },
    {
      name: 'doc', url: '/apps/pipeline/doc/:id', description: '文档详情页',
      instructions: '只处理 params.id 指定的这一篇文档。',
    },
  ))
  return { url: '/apps/pipeline/list' as PageInstanceKey }
}

describe('页面管线端到端：注册 → 打开 URL → PAGE 块（头行 + 正文）全链', () => {
  it('store 首屏全链：openUrl 激活 agent，PAGE 块正文含 store 当前状态；工具差集与屏蔽就位', async () => {
    const h = await boot()
    registerPipelineApp(h)
    const opened = await h.pages.openUrl('/apps/pipeline/list' as PageInstanceKey)
    // 请求头：打开即激活的工具面 = 最终形态，引导工具被屏蔽
    // / the header: the tool face activated at open is final; bootstrap tools are denied
    const scope = h.host.scopes.get(opened.sessionId)
    if (scope === undefined) throw new Error('expected the page agent to activate at open')
    expect([...scope.registry.keys()]).toEqual(['pipeline__pin'])
    expect(scope.denials).toEqual(['app_open', 'app_list', 'app_pages'])
    // PAGE 块正文（经 followup 进入会话上下文）：头行 + tools 行 + store 当前状态
    // / the PAGE block body (into the context via followup): locator + tools + the store's current state
    const block = scope.followups.find((m) => m.startsWith('PAGE pipeline/list'))
    if (block === undefined) throw new Error('expected the PAGE block followup')
    expect(block).toContain('tools: pipeline__pin')
    expect(block).toContain('- i-1 首屏基线')
  })

  it('无工具详情页全链：正文按 params 直读成型为 PAGE 块正文；tools 行如实（无）', async () => {
    const h = await boot()
    registerPipelineApp(h)
    const opened = await h.pages.openUrl('/apps/pipeline/doc/7' as PageInstanceKey)
    const scope = h.host.scopes.get(opened.sessionId)
    if (scope === undefined) throw new Error('expected the page agent to activate at open')
    const block = scope.followups.find((m) => m.startsWith('PAGE pipeline/doc'))
    if (block === undefined) throw new Error('expected the PAGE block followup')
    // load 的返回真的渲染进了正文 / the load result really rendered into the body
    expect(block).toContain('文档 七号-7（归属 天权）')
    // 本页未登记工具：tools 行如实表达"无"，而不是静默缺席
    // / the page registered no tools: the tools line says so honestly
    expect(block).toContain('tools: （无）')
  })

  it('选择=打开全链：stage 即新建页面会话，PAGE 块两段（map + 正文）都有数据，实例即刻 live', async () => {
    const h = await boot()
    registerPipelineApp(h)
    // 选择动作：新页面会话当场建出（agent/created 触发一次性渲染），传入的
    // sessionId 只做 Remote 面兼容
    // / the pick: a fresh page session is created on the spot (agent/created
    // fires the one-shot render); the passed sessionId is Remote compatibility only
    const picked = await h.ctx.appHost.stage('pipeline', 'session-gui-1' as SessionId)
    expect(picked.sessionId).not.toBe('session-gui-1')
    const scope = h.host.scopes.get(picked.sessionId)
    if (scope === undefined) throw new Error('expected the picked page session scope')
    const block = scope.followups.find((m) => m.startsWith('PAGE pipeline/list'))
    if (block === undefined) throw new Error('expected the PAGE block followup')
    // 两段都有数据：map 段（能力地图行）与正文段（store 当前状态）一段不缺
    // / both sections carry data: the map section and the body section (the store's current state)
    expect(block).toContain('- /apps/pipeline/doc/:id → 文档详情页')
    expect(block).toContain('- i-1 首屏基线')
    // 实例落进索引且 live（页面实例与 agent 共存亡）/ the instance lands in the index as live (instance ⟷ agent co-lifetime)
    const rows = await h.pages.instances.listByApp('pipeline')
    expect(rows.some((row) => row.sessionId === picked.sessionId && row.state === 'live')).toBe(true)
  })
})
