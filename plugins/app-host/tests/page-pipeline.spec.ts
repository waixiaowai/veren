/**
 * 页面管线端到端（真实 agent-loop 输入面）：注册页面 → 打开 URL → 首条消息 →
 * step 1 工具面 + PAGE 块正文，全链走生产代码。
 * The page pipeline end to end (the real agent-loop's input faces): register a
 * page → open the url → the first message → the step-1 tool face + the PAGE
 * block body, all through production code.
 *
 * 真实程度（如实）：真实 cordis 装配 + 真实 storage 栈（临时目录）+ 真实
 * page-registry 运行时（openPageUrl/createPageSession/mountPreviewTools 全链）
 * + 真实组件页渲染回路（store 首帧与 load 下发都经真实 Markdown 正文）。
 * step 1 的"请求"按 agent-loop 的两条输入面断言：请求头 = 该会话工具表里挂的
 * 工具面（loop 据此序列化请求头）；正文 = pre-step 决策的消息列表（loop 原样
 * 发送）。不跑真 LLM：请求的后续编码归 agent-loop 自己的单测，这里钉的是宿主
 * 交出去的输入面（assembly.spec 只到装配层，从不看正文——本文件补的正是那段）。
 * Fidelity: a real cordis assembly + a real storage stack (temp dirs) + the real
 * page-registry runtime (openPageUrl/createPageSession/mountPreviewTools in
 * full) + the real component-page render loop (both the store first frame and
 * the load push produce real Markdown bodies). The step-1 "request" is asserted
 * on the two input faces the agent loop consumes: the header = the tool face
 * mounted in the session's tool table (the loop serializes the header from it);
 * the body = the pre-step decision's message list (the loop sends it verbatim).
 * No real LLM: the downstream encoding of a request belongs to agent-loop's own
 * unit tests; this file pins the input faces the host hands over (assembly.spec
 * stops at the assembly layer and never looks at bodies — that is the gap here).
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
// / same shape as production: one createScope per agent (own fiber + scope tag)
import { createScope } from '@deepseek-ai/dsh-scope'
import * as Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { defineComponentPage, useSnapshot } from '@veren/prompt-page'
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
  /** followup 进活 agent 的块文本（openUrl 路径的 PAGE 块落点）/ block texts pushed via followup (the openUrl path's PAGE block) */
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

/** 在该会话的 agent 作用域上跑一轮 pre-step（最内层 next 返回已认领消息）
 * / run one pre-step in that session's agent scope (innermost next returns the claimed messages) */
async function runPreStep(ctx: Context, agent: Agent): Promise<PreStepDecision> {
  const claimed: UserMessage[] = [createUserMessage({ content: [{ type: 'text', text: '继续' }], source: { kind: 'user' } })]
  return await agentEvents(ctx, agent).waterfall('agent/pre-step', {
    messages: claimed,
    turn: 0,
    step: 0,
    signal: new AbortController().signal,
  }, async (): Promise<PreStepDecision> => ({ kind: 'enter', messages: claimed }))
}

/** 消息里的文本 / the text inside one message */
function textOf(message: UserMessage | undefined): string {
  return message?.content.map((block) => (block.type === 'text' ? block.text : '')).join('') ?? ''
}

// ---- 装配 + 一个"管线"应用（store 页 + load 页） ----
// ---- The assembly + one "pipeline" app (a store page + a load page) ----

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

/** 权威 store 假件：可变、可订阅、引用稳定 / the authoritative store fake */
function makeStore(initial: Card[]): {
  getState(): Card[]
  subscribe(listener: () => void): () => void
} {
  let items = initial
  const listeners = new Set<() => void>()
  return {
    getState: () => items,
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}

/**
 * 注册管线应用：store 首页（正文读 useSnapshot——正是 setSnapshot(null) 会清空的
 * 通道）+ load 详情页（正文来自 load 产出）。
 * Register the pipeline app: a store home page (its body reads useSnapshot —
 * exactly the channel setSnapshot(null) used to wipe) + a load detail page
 * (its body comes from the load result).
 */
function registerPipelineApp(h: Boot): { url: PageInstanceKey } {
  const { ctx } = h
  const store = makeStore([{ id: 'i-1', title: '首屏基线' }])
  const apps = ctx.apps
  apps.register({ id: 'pipeline' as AppId, name: 'pipeline', description: '页面管线验证应用', entry: 'list' as PageKey }, ctx)
  apps.tools('pipeline' as AppId, ctx).define(defineTool({
    name: 'pin', description: '置顶一张卡片。', parameters: {},
    output: { schema: { type: 'object', additionalProperties: true } as const, render: () => [] },
    execute: async () => ({ ok: true }),
  }))
  const pages = apps.pages('pipeline' as AppId, ctx)
  // store 页：组件经 useSnapshot() 读权威 store（有 load 声明的页面才会被运行时
  // 下发快照——本页没有 load，setSnapshot 必须不下发，首帧才守得住）。
  // / the store page: the component reads the store through useSnapshot(). Only
  // pages declaring load get a runtime snapshot push — this page declares none,
  // so the guard is what keeps the first frame alive.
  pages.register(defineComponentPage(
    () => {
      const cards = useSnapshot<Card[]>()
      return createElement('ul', { children: (cards ?? []).map((c) => createElement('li', { key: c.id, children: `${c.id} ${c.title}` })) })
    },
    { name: 'list', url: '/apps/pipeline/list', description: '看板列表页', tools: ['pin'], store },
  ))
  // load 页：load 产出经运行时 setSnapshot 下发 → useSnapshot → 正文。
  // / the load page: the load result is pushed by the runtime → useSnapshot → the body.
  pages.register(defineComponentPage(
    () => {
      const doc = useSnapshot<{ doc: string; owner: string }>()
      if (doc === undefined) return createElement('p', { children: '首屏数据未就绪' })
      return createElement('p', { children: `文档 ${doc.doc}（归属 ${doc.owner}）` })
    },
    {
      name: 'doc', url: '/apps/pipeline/doc/:id', description: '文档详情页',
      instructions: '只处理 params.id 指定的这一篇文档。',
      load: async (params) => ({ doc: `七号-${params.id}`, owner: '天权' }),
    },
  ))
  return { url: '/apps/pipeline/list' as PageInstanceKey }
}

describe('页面管线端到端：注册 → 打开 URL → 首条消息 → step 1 工具面 + PAGE 块正文', () => {
  it('store 页全链：openUrl 激活 agent，PAGE 块正文含 store 首条数据（不被 setSnapshot(null) 清空）', async () => {
    const h = await boot()
    registerPipelineApp(h)
    const opened = await h.pages.openUrl('/apps/pipeline/list' as PageInstanceKey)
    // step 1 请求头：打开即激活的工具面 = 最终形态，引导工具被屏蔽
    // / the step-1 header: the tool face activated at open is final; bootstrap tools are denied
    const scope = h.host.scopes.get(opened.sessionId)
    if (scope === undefined) throw new Error('expected the page agent to activate at open')
    expect([...scope.registry.keys()]).toEqual(['pipeline__pin'])
    expect(scope.denials).toEqual(['app_open', 'app_list', 'app_pages'])
    // PAGE 块正文（经 followup 进入会话上下文）：头行 + tools 行 + store 首帧数据
    // / the PAGE block body (into the context via followup): locator + tools + the store first frame
    const block = scope.followups.find((m) => m.startsWith('PAGE pipeline/list'))
    if (block === undefined) throw new Error('expected the PAGE block followup')
    expect(block).toContain('tools: pipeline__pin')
    // THE 守卫：store 首条数据必须在正文里——修复前 pushFirstScreen 无条件
    // setSnapshot(null) 把首帧清空，正文丢失（模型读不到数据）。
    // / THE guard: the store's first data must be in the body — before the fix
    // an unconditional setSnapshot(null) wiped the first frame and lost the body.
    expect(block).toContain('- i-1 首屏基线')
    // 首条消息跑一轮 pre-step：决策照常放行（正文在会话日志里，不重复注入）
    // / one pre-step on the first message: the decision passes normally
    const agent = h.host.agentOf(opened.sessionId)
    if (agent === undefined) throw new Error('expected the page agent object')
    const decision = await runPreStep(h.ctx, agent)
    expect(decision.kind).toBe('enter')
  })

  it('load 页全链：load 产出经 setSnapshot 下发，PAGE 块正文含 load 数据', async () => {
    const h = await boot()
    registerPipelineApp(h)
    const opened = await h.pages.openUrl('/apps/pipeline/doc/7' as PageInstanceKey)
    const scope = h.host.scopes.get(opened.sessionId)
    if (scope === undefined) throw new Error('expected the page agent to activate at open')
    const block = scope.followups.find((m) => m.startsWith('PAGE pipeline/doc'))
    if (block === undefined) throw new Error('expected the PAGE block followup')
    // load 声明页才下发快照：load 的返回真的渲染进了正文
    // / only load-declaring pages get a push: the load result really rendered into the body
    expect(block).toContain('文档 七号-7（归属 天权）')
    // load 页无目录工具：tools 行如实表达"无"，而不是静默缺席
    // / the load page has no catalog tools: the tools line says so honestly
    expect(block).toContain('tools: （无）')
  })

  it('暂存→提升全链：预挂面即 step 1 请求头，首条消息提升后 PAGE 块两段（map + 正文）都有数据', async () => {
    const h = await boot()
    registerPipelineApp(h)
    const sessionId = 'session-gui-1' as SessionId
    await h.ctx.agents.create({
      sessionId,
      agentOptions: { provider: 'test', model: 'test-model' },
      meta: { cwd: h.host.defaultWorkspacePath, agentPreset: 'standard' },
    })
    // 暂存（mountPreviewTools）：不建实例，但预挂面已经 = 最终工具面
    // / staging (mountPreviewTools): no instance, yet the pre-mounted face is already the final one
    await h.ctx.appHost.stage('pipeline', sessionId)
    expect(await h.pages.instances.listByApp('pipeline')).toHaveLength(0)
    const scope = h.host.scopes.get(sessionId)
    if (scope === undefined) throw new Error('expected the agent scope')
    expect([...scope.registry.keys()]).toEqual(['pipeline__pin'])
    const previewFace = [...scope.registry.values()].map((tool) => JSON.stringify(tool))
    // 首条消息的 pre-step：提升，PAGE 块作为本轮决策消息进入（openUrl 路径落日志，
    // 提升路径进决策——这是它独有的正文观测点）。
    // / the first message's pre-step: promotion, and the PAGE block enters this
    // round's decision (the openUrl path logs it; the promotion path is the only
    // place the body is observable in a decision).
    const agent = h.host.agentOf(sessionId)
    if (agent === undefined) throw new Error('expected the stable agent object')
    const decision = await runPreStep(h.ctx, agent)
    if (decision.kind !== 'enter') throw new Error('expected the pre-step to admit messages')
    expect(textOf(decision.messages[0])).toBe('继续')
    const block = textOf(decision.messages.at(-1))
    expect(block.startsWith('PAGE pipeline/list')).toBe(true)
    // 两段都有数据：map 段（能力地图行）与正文段（store 首帧）一段不缺
    // / both sections carry data: the map section and the body section (the store first frame)
    expect(block).toContain('- /apps/pipeline/doc/:id → 文档详情页')
    expect(block).toContain('- i-1 首屏基线')
    // 正式提升重挂同一套定义：逐字相同（第二步不会"工具已更新"）
    // / the promotion re-mounts the same definitions, byte-identical
    expect([...scope.registry.keys()]).toEqual(['pipeline__pin'])
    expect([...scope.registry.values()].map((tool) => JSON.stringify(tool))).toEqual(previewFace)
    // 实例落进索引且 live / the instance lands in the index as live
    const rows = await h.pages.instances.listByApp('pipeline')
    expect(rows.some((row) => row.sessionId === sessionId && row.state === 'live')).toBe(true)
  })
})
