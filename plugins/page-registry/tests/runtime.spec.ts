import { describe, expect, it, vi } from 'vitest'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { Context } from '@deepseek-ai/cordis'
import { KvPageInstanceIndex, PageError, defineComponentPage, deprecatedRowKey } from '@veren/prompt-page'
import { createElement } from '@veren/prompt-core'
import type { InstanceKvPort } from '@veren/prompt-page'
import type { PageInstanceRecord } from '@veren/prompt-page'
import PageRegistryPlugin, { PageRegistryService } from '../src/index.ts'
import type { PageRuntimePorts, PageSessionPort, PageToolEntry } from '../src/runtime.ts'
import type { AppRecord } from '@veren/app-registry'
import type { TaskRecord } from '@veren/task-center'
import type { Agent } from '@deepseek-ai/dsh-agent'
// 类型-only：拉取 ctx.skills 的 declaration merging（组件体直登单会话 skill 的服务面）
// type-only: declares ctx.skills — the face the body registers a single-session skill through
import type {} from '@deepseek-ai/dsh-skill'

/** 内存 KV（与 app-pages 域表同形），可跨"重启"复用 */
function memKv(): InstanceKvPort & { readonly map: Map<string, PageInstanceRecord> } {
  const map = new Map<string, PageInstanceRecord>()
  return {
    map,
    get: (key) => map.get(key),
    put: async (key, value) => { map.set(key, value) },
    del: async (key) => map.delete(key),
    all: () => [...map.values()],
  }
}

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
function fakeSessions() {
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

function taskPage() {
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

/** 组装一个带应用/工具/任务假件的注册表服务 */
function makeService(options: {
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

describe('页面运行时：打开 URL 一律新建，旧会话废弃（§3.5.3、§9.1）', () => {
  it('①同一 URL 连开两次 → 两条不同会话；索引指向后一条，前一条状态为废弃', async () => {
    const { service, kv, sessions } = makeService()
    const first = await service.openUrl('/apps/demo/task/1')
    const second = await service.openUrl('/apps/demo/task/1')
    expect(second.sessionId).not.toBe(first.sessionId)
    expect(sessions.created).toEqual([first.sessionId, second.sessionId])
    // 索引（URL 键）指向最新的那条活会话
    expect(kv.map.get('/apps/demo/task/1')?.state).toBe('live')
    expect(kv.map.get('/apps/demo/task/1')?.sessionId).toBe(second.sessionId)
    // 前一条挪进废弃历史：状态 deprecated、可按 sessionId 找回
    const old = kv.map.get(deprecatedRowKey(first.sessionId))
    expect(old?.state).toBe('deprecated')
    expect(old?.sessionId).toBe(first.sessionId)
    expect(old?.deprecatedAt).toBeTypeOf('string')
  })

  it('②旧会话的 agent 已退役（页面登记随 fiber 拆除）；新会话不受影响', async () => {
    const { service, sessions } = makeService()
    const first = await service.openUrl('/apps/demo/task/1')
    expect(sessions.toolFace(first.sessionId).map((tool) => tool.name)).toEqual(['demo__read'])
    const second = await service.openUrl('/apps/demo/task/1')
    // 旧会话：agent 退役（工具面清空）/ the old session: agent retired (face emptied)
    expect(sessions.retired).toEqual([first.sessionId])
    expect(sessions.toolFace(first.sessionId)).toEqual([])
    // 新会话：自己的一套，完好
    expect(sessions.toolFace(second.sessionId).map((tool) => tool.name)).toEqual(['demo__read'])
    // 新会话的 PAGE 块照写；旧会话不再追加任何块
    expect((sessions.messages.get(second.sessionId) ?? []).some((m) => m.startsWith('app/page::'))).toBe(true)
    expect(sessions.messages.get(first.sessionId)).toHaveLength(1)
  })

  it('/task/1 与 /task/2 互不干扰；重开 /task/1 只废弃 /task/1 的旧会话', async () => {
    const { service, kv, sessions } = makeService()
    const a = await service.openUrl('/apps/demo/task/1')
    const b = await service.openUrl('/apps/demo/task/2')
    expect(a.sessionId).not.toBe(b.sessionId)
    const a2 = await service.openUrl('/apps/demo/task/1')
    expect(a2.sessionId).not.toBe(a.sessionId)
    // 只有 /task/1 的旧会话被废弃；/task/2 的会话原样保留
    expect(kv.map.get(deprecatedRowKey(a.sessionId))?.state).toBe('deprecated')
    expect(kv.map.get('/apps/demo/task/2')?.sessionId).toBe(b.sessionId)
    expect(sessions.retired).toEqual([a.sessionId])
  })

  it('会话标题：instanceTitle(params) 写进会话标题与索引（§3.6.1）', async () => {
    const { service, kv, sessions } = makeService()
    const opened = await service.openUrl('/apps/demo/task/1')
    expect(sessions.titles.get(opened.sessionId)).toBe('任务 #1')
    expect(kv.map.get('/apps/demo/task/1')?.instanceTitle).toBe('任务 #1')
  })

  it('PAGE 块随新会话写一次，呈 §3.3 骨架：pageKey + 规范 URL / tools（登记差集带用途）/ 说明 / Markdown 正文（无 params/data JSON 行）', async () => {
    const { service, sessions } = makeService()
    const opened = await service.openUrl('/apps/demo/task/1')
    const blocks = sessions.messages.get(opened.sessionId) ?? []
    expect(blocks).toHaveLength(1)
    const block = blocks[0] ?? ''
    expect(block.startsWith('app/page::PAGE demo/task /apps/demo/task/1')).toBe(true)
    expect(block).not.toContain('params:')
    expect(block).not.toContain('data:')
    // tools 行来自登记差集（组件体直登的全名），用途短语取 description 首句
    // / the tools line comes from the registration delta (the body's full names), usage phrase = description's first sentence
    expect(block).toContain('tools: demo__read（读材料）')
    expect(block).toContain('先读材料，再作答。')
    expect(block).toContain('任务 #1')
    // 应用未声明说明 → 不画"应用说明"行（不制造空行承诺）
    // / no app instructions declared → no app-note line (no empty promise)
    expect(block).not.toContain('应用说明：')
  })

  it('应用说明进 PAGE 块且排在页面说明之前：先读"应用是谁"，再读"这页怎么用"', async () => {
    const { service, sessions } = makeService({ appInstructions: 'demo 应用负责示范：只做展示，不做真实写入。' })
    const opened = await service.openUrl('/apps/demo/task/1')
    const block = (sessions.messages.get(opened.sessionId) ?? [])[0] ?? ''
    expect(block).toContain('应用说明：demo 应用负责示范：只做展示，不做真实写入。')
    expect(block).toContain('说明：先读材料，再作答。')
    // 顺序锁定：应用说明行在页面说明行之前 / the order is locked: the app note precedes the page note
    expect(block.indexOf('应用说明：')).toBeLessThan(block.indexOf('说明：'))
  })

  it('单会话 skill 随组件体直登进 agent 作用域：本会话可见，重开（废弃=退役 agent）时随新会话重挂', async () => {
    const { service, sessions } = makeService()
    const first = await service.openUrl('/apps/demo/task/1')
    expect(sessions.skills.get(first.sessionId)).toEqual(['demo-skill'])
    const second = await service.openUrl('/apps/demo/task/1')
    expect(sessions.skills.get(second.sessionId)).toEqual(['demo-skill'])
  })

  it('能力地图由注册表推导进 PAGE 块：兄弟页"模板 → description"逐条成行，模型可照抄（§3.5 定案）', async () => {
    // map 不再手写：app 假件的 pages 投影就是事实源（排除自身、按注册序）
    const { service, sessions } = makeService({
      siblings: [
        { name: 'publish', url: '/apps/demo/publish', description: '要发布新任务时打开发布页' },
      ],
    })
    const opened = await service.openUrl('/apps/demo/task/1')
    const block = (sessions.messages.get(opened.sessionId) ?? [])[0] ?? ''
    expect(block).toContain('map:（能力地图')
    expect(block).toContain('- /apps/demo/publish → 要发布新任务时打开发布页')
    expect(block).not.toContain('- /apps/demo/task/:taskId')
  })

  it('单页应用不画 map 行（无兄弟页 → 推导为空，不给模型"隐藏出口"的想象空间）', async () => {
    const { service, sessions } = makeService()
    const opened = await service.openUrl('/apps/demo/task/1')
    const block = (sessions.messages.get(opened.sessionId) ?? [])[0] ?? ''
    expect(block).not.toContain('map:')
  })

  it('首屏读取是组件体自己的生命周期：effect 发起异步读，事实经 agent.followup 进上下文（宿主不经手取数）', async () => {
    const { service, sessions } = makeService()
    const registration = defineComponentPage(
      (_props, agent) => {
        agent.ctx.effect(async () => {
          const brief = await Promise.resolve({ id: '7', lines: ['a', 'b'] })
          agent.followup({ content: [{ type: 'text', text: `${brief.id} ${brief.lines.join(' ')}` }] } as never)
          return async () => undefined
        }, 'brief:first-screen')
        return createElement('p', { children: '简报稍后以消息送达' })
      },
      {
        url: '/apps/demo/brief/:briefId', description: '简报页',
        instructions: '只读这份简报。',
      },
    )
    const dispose = service.registerAppPage('demo', registration.page, registration.live)
    try {
      const opened = await service.openUrl('/apps/demo/brief/7')
      // PAGE 块只有静态正文：宿主不等首屏、不经手任何数据
      // / the PAGE block carries only the static body: the host waits for no
      // first screen and touches no data
      const block = (sessions.messages.get(opened.sessionId) ?? [])[0] ?? ''
      expect(block).toContain('简报稍后以消息送达')
      // 首屏事实经 followup 进上下文 / the first-screen facts ride followup
      expect(sessions.followups.get(opened.sessionId)).toEqual(['7 a b'])
    } finally { dispose() }
  })

  it('宿主不再携带 presetOf：预设等归属事实由组件体从会话头自取（与工具取调用者同源）', async () => {
    // PageLoadEnv/presetOf 随 load 一起退役；组件体需要归属时读
    // agent.session.header.agentPreset——与页面工具同一口径。
    // / PageLoadEnv/presetOf died with load; a body needing the owner reads
    // agent.session.header.agentPreset — the same face the page tools use.
    const { service, sessions } = makeService()
    const registration = defineComponentPage(
      (_props, agent) => {
        const preset = (agent.session as { header?: { agentPreset?: string } } | undefined)?.header?.agentPreset ?? null
        agent.ctx.effect(async () => {
          agent.followup({ content: [{ type: 'text', text: `preset=${preset ?? 'null'}` }] } as never)
          return async () => undefined
        }, 'brief:owner')
        return createElement('p', { children: '归属随后送达' })
      },
      { url: '/apps/demo/brief/:briefId', description: '简报页', instructions: '只读这份简报。' },
    )
    const dispose = service.registerAppPage('demo', registration.page, registration.live)
    try {
      const opened = await service.openUrl('/apps/demo/brief/7')
      expect(sessions.followups.get(opened.sessionId)).toEqual(['preset=null'])
    } finally { dispose() }
  })

  it('agent 传递接缝：live.mount 收到的就是端口 agentOf 给出的那只 agent', async () => {
    const { service, ports, sessions } = makeService()
    const seen: Array<unknown> = []
    const registration = defineComponentPage(
      () => createElement('p', { children: '作用域页' }),
      { url: '/apps/demo/scoped', description: '作用域页' },
    )
    service.registerAppPage('demo', registration.page, {
      mount: (params, agent) => {
        seen.push(agent)
        return registration.live.mount(params, agent)
      },
    })
    await service.openUrl('/apps/demo/scoped')
    expect(seen).toEqual([sessions.agents.get(sessions.created[0]!)])
    void ports
  })

  it('agent 缺席（装配错误）：一次性渲染 fail loud，半成品销毁', async () => {
    const { service, kv, sessions } = makeService()
    // 篡改 agentOf 返回 undefined：等价于"建了会话但 agent 没起来"的装配事故
    // / tamper agentOf to undefined: the assembly accident "session created, agent missing"
    service.bindPorts({
      ...({ sessions: { ...sessions.port, agentOf: () => undefined }, apps: { get: () => ({ definition: { id: 'demo' as never, name: 'Demo', description: 'd', entry: 'task' as never }, owner: 'test', version: '1.0.0', toolPrefix: 'demo', state: 'active' }) } }) as PageRuntimePorts,
    }, new KvPageInstanceIndex(kv, { sessionExists: (id) => sessions.port.exists(id) }))
    await expect(service.openUrl('/apps/demo/task/1'))
      .rejects.toMatchObject({ code: 'page/host-unavailable' })
    expect(sessions.destroyed).toHaveLength(1)
    expect(kv.map.size).toBe(0)
  })
})

describe('缺口 1/4 收尾：通知投递泵、reserved 清扫', () => {
  /** 带投递面的装配 / assembly with a delivery face */
  function makeWithDelivery(notices: Array<{ deliveryId: string; text: string }>) {
    const harness = makeService()
    const marked: Array<{ id: string; error?: string }> = []
    // 绑定后的端口集（含投递面）原样回传，后续整体重传时不丢面
    // the bound port set (with the delivery face) is returned so later
    // wholesale rebinds never drop a face
    const ports = { ...harness.ports, deliveries: {
      pending: async () => notices,
      mark: async (id: string, error?: string) => { marked.push({ id, error }) },
    } }
    harness.service.bindPorts(ports)
    return { ...harness, ports, marked }
  }

  it('新会话启动即注入收件箱通知，并回报 delivered（§5.2 inbox）', async () => {
    const { service, sessions, marked } = makeWithDelivery([
      { deliveryId: 'd-1', text: '[task-center] 任务 A' },
      { deliveryId: 'd-2', text: '[task-center] 任务 B' },
    ])
    const opened = await service.openUrl('/apps/demo/task/1')
    const messages = sessions.messages.get(opened.sessionId) ?? []
    expect(messages.filter((m) => m.includes('[task-center]'))).toHaveLength(2)
    expect(marked).toEqual([{ id: 'd-1' }, { id: 'd-2' }])
  })

  it('注入失败保持 pending 并带原因，不阻塞页面打开（§4.5 降级）', async () => {
    const { service, sessions, ports, marked } = makeWithDelivery([{ deliveryId: 'd-1', text: 'x' }])
    // 会话端口假件没有 appendUserMessage 失败注入口：直接把 sessions 换成会抛的
    // （端口整体重传，纯参数）/ rebind wholesale with a failing session port
    service.bindPorts({
      ...ports,
      sessions: {
        ...sessions.port,
        appendUserMessage: async (_id, _text, source) => {
          // 只让通知注入失败，PAGE 块照常写入 / fail only the notice append
          if (source === 'task-center/notice') throw new Error('agent gone')
        },
      },
    })
    const opened = await service.openUrl('/apps/demo/task/1')
    expect(marked).toEqual([{ id: 'd-1', error: 'agent gone' }])
  })

  it('sweepReserved：会话不在的 reserved 行删除；live 行不动；无探测不动', async () => {
    const { service, sessions, kv } = makeService()
    await service.openUrl('/apps/demo/task/1')
    // 手工塞一条 reserved 幽灵行 / plant a ghost reserved row
    kv.map.set('/apps/demo/task/ghost', {
      url: '/apps/demo/task/ghost' as never, state: 'reserved', appId: 'demo',
      page: 'demo/task', sessionId: 's-missing', instanceTitle: 'x',
      params: {}, appVersion: '1', createdAt: 't', lastOpenedAt: 't',
    })
    const dropped = await service.instances.sweepReserved()
    expect(dropped).toEqual(['/apps/demo/task/ghost'])
    expect(kv.map.has('/apps/demo/task/1')).toBe(true)
    void sessions
  })
})

// PageRegistryPlugin 默认导出仍被装配测试消费（import 面保持）
void PageRegistryPlugin
