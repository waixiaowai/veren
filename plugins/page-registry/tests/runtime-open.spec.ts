/**
 * 页面运行时验收（打开路径）：打开 URL 一律新建，旧会话废弃（§3.5.3、§9.1）；
 * PAGE 块骨架、能力地图、单会话 skill 与一次性渲染语义。
 * Page-runtime acceptance (the open path): opening a url always creates a
 * fresh session and deprecates the previous one (§3.5.3, §9.1); the PAGE block
 * skeleton, capability map, single-session skill, and one-shot render
 * semantics.
 *
 * @module @veren/page-registry/tests/runtime-open
 */
import { describe, expect, it } from 'vitest'
import { KvPageInstanceIndex, defineComponentPage, deprecatedRowKey } from '@veren/prompt-page'
import { createElement } from '@veren/prompt-core'
import { makeService } from './runtime.harness.ts'
import type { PageRuntimePorts } from '../src/runtime.ts'

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
