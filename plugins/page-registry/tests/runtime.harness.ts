/**
 * 页面运行时测试夹具：会话端口假件、任务详情页夹具与装配好的注册表服务。
 * 供 runtime-open / runtime-delivery-pump 两个 spec 复用（单一事实源）。
 * The page-runtime test fixtures: the session-port fake, the task-detail page
 * fixture and the assembled registry service — the single source shared by the
 * runtime-open and runtime-delivery-pump specs.
 *
 * @module @veren/page-registry/tests/runtime.harness
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { Context } from '@deepseek-ai/cordis'
import { KvPageInstanceIndex, defineComponentPage } from '@veren/prompt-page'
import { createElement } from '@veren/prompt-core'
import PageRegistryPlugin, { PageRegistryService } from '../src/index.ts'
import { memKv } from './kv.harness.ts'
import type { PageRuntimePorts, PageSessionPort, PageToolEntry } from '../src/runtime.ts'
import type { AppRecord } from '@veren/app-registry'
import type { TaskRecord } from '@veren/task-center'
import type { Agent } from '@deepseek-ai/dsh-agent'
// 类型-only：拉取 ctx.skills 的 declaration merging（组件体直登单会话 skill 的服务面）
// type-only: declares ctx.skills — the face the body registers a single-session skill through
import type {} from '@deepseek-ai/dsh-skill'

// PageRegistryPlugin 默认导出仍被装配测试消费（import 面保持）
void PageRegistryPlugin

/**
 * 会话端口假件：记录创建/退役/销毁/消息，可注入失败。每个会话带一只假 agent——
 * 组件体经 agent.ctx.tools.register 的登记落进该会话的工具面，toolFace 快照的
 * 前后差集即页面工具（与真实 ToolRuntime 的作用域分层同构）。
 * The session port fake: records creates/retires/destroys/messages, injectable
 * failures. Each session carries a fake agent — the body's registrations via
 * agent.ctx.tools.register land in that session's tool face, and the
 * before/after toolFace delta IS the page's tools (isomorphic to the real
 * ToolRuntime's scope layering).
 */
export function fakeSessions() {
  const created: string[] = []
  const titles = new Map<string, string>()
  const messages = new Map<string, string[]>()
  const retired: string[] = []
  const focused: string[] = []
  const destroyed: string[] = []
  /** 会话 → 组件体登记的工具面（agent 作用域层）/ session → the body-registered tool face (the agent scope layer) */
  const faces = new Map<string, PageToolEntry[]>()
  /** 会话 → 假 agent（agentOf 的返回）/ session → the fake agent (agentOf's return) */
  const agents = new Map<string, Agent>()
  /** 会话 → 组件体直登的单会话 skill 名 / session → the body-registered skill names */
  const skills = new Map<string, string[]>()
  /** 会话 → 组件体经 agent.followup 推送的消息文本 / session → the texts the body pushed via agent.followup */
  const followups = new Map<string, string[]>()
  let failCreate: Error | undefined
  const port: PageSessionPort = {
    exists: (id) => created.includes(id) && !destroyed.includes(id),
    mintId: () => `s-${created.length + 1}`,
    async create(id, title) {
      if (failCreate) throw failCreate
      created.push(id)
      titles.set(id, title)
      messages.set(id, [])
      faces.set(id, [])
      const face = faces.get(id)!
      agents.set(id, {
        ctx: {
          tools: {
            register: (definition: { name: string; description?: string }) => {
              face.push({ name: definition.name, description: definition.description ?? '' })
              return () => undefined
            },
          },
          effect: (run: () => unknown) => { void run(); return async () => undefined },
          on: () => () => undefined,
          // 单会话 skill 组件体直登的断言面 / the assertion face of body-registered skills
          skills: {
            register: (skill: { name: string }) => {
              skills.set(id, [...(skills.get(id) ?? []), skill.name])
              return () => undefined
            },
          },
        },
        session: { id },
        // 组件体首屏读的送达面：followup 文本记录在此（宿主不经手取数）
        // / the delivery face of the body's first-screen read: followup texts record here
        followup: (message: { content: ReadonlyArray<{ type: string; text?: string }> }) => {
          followups.set(id, [...(followups.get(id) ?? []), ...message.content.map((block) => block.text ?? '')])
        },
      } as unknown as Agent)
    },
    agentOf: (id) => agents.get(id),
    // 快照必须是拷贝：真实 ToolRuntime.schemas() 每次新建合并表；活引用会让
    // before/after 成为同一数组、差集恒空（本轮调试抓到的假阳性根源）。
    // The snapshot must be a copy: the real ToolRuntime.schemas() builds a fresh
    // merged table per call; a live reference makes before/after the same array
    // and the delta permanently empty (the false positive this round's debug caught).
    toolFace: (id) => [...(faces.get(id) ?? [])],
    async retire(id) {
      faces.delete(id)
      retired.push(id)
    },
    async appendUserMessage(id, text, source) { messages.get(id)?.push(`${source}::${text}`) },
    async focus(id) { focused.push(id) },
    async destroy(id) {
      faces.delete(id)
      destroyed.push(id)
    },
  }
  return {
    port, created, titles, messages, retired, focused, destroyed, skills, faces, agents, followups,
    toolFace: (id: string) => [...(faces.get(id) ?? [])],
    fail: (e?: Error) => { failCreate = e },
  }
}

/** 任务详情页夹具：组件体直登读工具与单会话 skill / the task-detail fixture: the body registers its read tool and a single-session skill */
export function taskPage() {
  const registration = defineComponentPage(
    (props: { id?: string }, agent) => {
      // 工具只在页面存在：详情页的读工具由组件体直登（全名；设计律）
      // / a tool exists only inside a page: the detail page registers its read tool in the body (full name; design law)
      agent.ctx.tools.register(defineTool({
        name: 'demo__read', description: '读材料', parameters: {},
        output: { schema: { type: 'object', additionalProperties: true } as const, render: () => [] },
        execute: async () => ({ ok: true }),
      }))
      // 单会话 skill 与工具同机制：组件体直登，随 agent fiber 生灭
      // / a single-session skill rides the same mechanism as tools: the body registers it, it lives and dies with the agent fiber
      agent.ctx.skills.register({ name: 'demo-skill', description: '任务页技能', content: '# demo\n只在任务页。', source: 'runtime' })
      return createElement('p', { children: `任务 #${props.id ?? '?'}` })
    },
    {
      url: '/apps/demo/task/:id',
      description: '任务详情页',
      instructions: '先读材料，再作答。',
      instanceTitle: (params) => `任务 #${params.id ?? '?'}`,
    },
  )
  return registration
}

/** 组装一个带应用/工具/任务假件的注册表服务 / assemble a registry service with app/tool/task fakes */
export function makeService(options: {
  appState?: 'active' | 'disabled' | 'broken'
  withApps?: boolean
  /** 应用级说明假件（PAGE 块"应用说明"行的断言面）/ the app-instructions fake (the assertion face of the PAGE block's app note) */
  appInstructions?: string
  tasks?: { take: (id: string, claim: unknown) => Promise<unknown> }
  /** app 假件的兄弟页投影（map 推导的事实源）/ the app fake's sibling projection (the fact source for map derivation) */
  siblings?: ReadonlyArray<{ name: string; url: string; description: string }>
} = {}) {
  const ctx = new Context()
  const service = new PageRegistryService(ctx)
  const task = taskPage()
  const dispose = service.registerAppPage('demo', task.page, task.live)
  const kv = memKv()
  const sessions = fakeSessions()
  // 端口全部是纯参数（G13）：app 假件是完整 AppRecord / the app fake is a full AppRecord
  const app: AppRecord = {
    definition: {
      id: 'demo' as never, name: 'Demo', description: 'demo app', entry: 'task' as never,
      ...(options.appInstructions === undefined ? {} : { instructions: options.appInstructions }),
    },
    owner: 'test',
    version: '1.0.0',
    toolPrefix: 'demo',
    state: options.appState ?? 'active',
    pages: new Map([
      ['task', { url: '/apps/demo/task/:id', description: '任务详情页', component: true }],
      ...(options.siblings ?? []).map((s): [string, { url: string; description: string; component: boolean }] => [s.name, { url: s.url, description: s.description, component: true }]),
    ]),
  }
  const ports = {
    sessions: sessions.port,
    apps: options.withApps === false ? { get: () => undefined } : { get: () => app },
    ...(options.tasks === undefined ? {} : { tasks: { take: (id: never, claim: never) => options.tasks!.take(String(id), claim) as Promise<TaskRecord> } }),
  } satisfies PageRuntimePorts
  service.bindPorts(ports, new KvPageInstanceIndex(kv, { sessionExists: (id) => sessions.port.exists(id) }))
  return { service, kv, sessions, ports, dispose }
}
