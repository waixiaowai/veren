/**
 * page_send 投递运行时验收（§3.9）：有会话则 append、无则新建、级联硬上限、
 * 废弃竞态补投、页面工具完备性警告与 page_send 工具本体。夹具在 delivery.harness。
 * The page_send delivery-runtime acceptance (§3.9): append-to-live or
 * create-first, the cascade hard cap, deprecation-race re-delivery, the page
 * tool coverage warning, and the page_send tool body. Fixtures live in
 * delivery.harness.
 *
 * @module @veren/page-registry/tests/delivery
 */
import { describe, expect, it } from 'vitest'
import { defineAppPage, pageToolWarning } from '@veren/prompt-page'
import type { PageInstanceIndex } from '@veren/prompt-page'
import { createPageSendTool } from '../src/tools.ts'
import { HopLedger, MAX_DELIVERY_HOPS } from '../src/delivery.ts'
import { deliver, fakeSessions, makeService } from './delivery.harness.ts'

describe('page_send 投递运行时（§3.9：有会话则 append、无则新建）', () => {
  it('无会话 → 新建并绑定（created=true）；PAGE 块 + 消息都落新会话', async () => {
    const { service, kv, sessions } = makeService()
    const result = await deliver(service, '/apps/demo/task/1')
    expect(result.created).toBe(true)
    expect(result.redirected).toBe(false)
    expect(sessions.created).toHaveLength(1)
    expect(kv.map.get('/apps/demo/task/1')?.state).toBe('live')
    const blocks = sessions.messages.get(result.sessionId) ?? []
    expect(blocks.some((m) => m.startsWith('app/page::PAGE'))).toBe(true)
    expect(blocks.some((m) => m.startsWith('page/send::干这活'))).toBe(true)
  })

  it('投递不是导航：新建路径不发 GUI focus', async () => {
    const { service, sessions } = makeService()
    const result = await deliver(service, '/apps/demo/task/1')
    expect(sessions.focused).toEqual([]) // openUrl 会 focus；deliverUrl 绝不
    void result
  })

  it('回执武装先于唤醒（竞态回归）：append 的同一刻目标就开轮，回执仍然到达', async () => {
    const { service, sessions, ctx } = makeService()
    await service.openUrl('/apps/demo/task/1')
    const opened = (await service.instances.lookup('/apps/demo/task/1' as never))?.sessionId ?? ''
    // 发送方会话先在场（回执落它的日志）
    await sessions.port.create('caller-1', 'caller')
    // 竞态形状：page/send 落地的同一刻目标 turn/start（早于投递函数返回）
    // / the race shape: the target's turn/start fires the instant page/send
    // lands — earlier than the delivery call returns
    const originalAppend = sessions.port.appendUserMessage.bind(sessions.port)
    const port = sessions.port as { appendUserMessage: (id: string, text: string, source: string, options?: { wake?: boolean }) => Promise<void> }
    port.appendUserMessage = async (id, text, source, options) => {
      await originalAppend(id, text, source, options)
      if (source === 'page/send') {
        ;(ctx.events as { emit: (...args: unknown[]) => void }).emit('session/event', { id }, { type: 'turn/start', data: { turn: 1 } })
      }
    }
    const result = await deliver(service, '/apps/demo/task/1', 'caller-1')
    expect(result.receipt).toBe(true)
    // 回应回合完成 → 回执落发送方日志
    ;(ctx.events as { emit: (...args: unknown[]) => void }).emit('session/event', { id: opened },
      { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '干完了' }] } } })
    ;(ctx.events as { emit: (...args: unknown[]) => void }).emit('session/event', { id: opened },
      { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
    await new Promise((resolve) => { setImmediate(resolve) })
    const receipts = (sessions.messages.get('caller-1') ?? []).filter((m) => m.startsWith('page/receipt::PAGE-RECEIPT'))
    expect(receipts).toHaveLength(1)
    expect(receipts[0]).toContain('干完了')
  })

  it('有活会话 → 直接 append（created=false），不新建、不废弃', async () => {
    const { service, sessions } = makeService()
    const opened = await service.openUrl('/apps/demo/task/1')
    const result = await deliver(service, '/apps/demo/task/1')
    expect(result.created).toBe(false)
    expect(result.sessionId).toBe(opened.sessionId)
    expect(sessions.created).toHaveLength(1)
    expect((sessions.messages.get(opened.sessionId) ?? []).some((m) => m.startsWith('page/send::'))).toBe(true)
  })

  it('唤醒策略：wake 缺省进端口为 undefined（端口按唤醒处理）；wake=false 如实透传', async () => {
    const { service, sessions } = makeService()
    await deliver(service, '/apps/demo/task/1') // 缺省：唤醒
    await service.deliverUrl('/apps/demo/task/1', { message: '只记录，先不醒', wake: false })
    // PAGE 块（唤醒路径）与消息（唤醒路径）都走 undefined；补投消息带 false
    expect(sessions.wakeOptions).toEqual([undefined, undefined, false])
  })

  it('URL 规范化参与幂等：尾斜杠/乱序 query 命中同一会话', async () => {
    const { service, sessions } = makeService()
    const first = await deliver(service, '/apps/demo/task/1?b=2&a=1')
    const second = await deliver(service, '/apps/demo/task/1/?a=1&b=2')
    expect(second.created).toBe(false)
    expect(second.sessionId).toBe(first.sessionId)
    expect(sessions.created).toHaveLength(1)
  })
})

describe('级联闸门（§3.9 风险 1：构造上的硬上限）', () => {
  it('链深 ≤ MAX_DELIVERY_HOPS 放行；第 MAX+1 跳拒绝 page/hop-limit', async () => {
    const { service, sessions } = makeService()
    // 人（无 caller）投出第 1 跳；智能逐跳续链到上限
    let caller: string | undefined
    for (let hop = 1; hop <= MAX_DELIVERY_HOPS; hop++) {
      const result = await deliver(service, `/apps/demo/task/${hop}`, caller)
      expect(result.created).toBe(true)
      caller = result.sessionId
    }
    // 第 5 跳：链深 5 > 4，硬上限拒绝（错误码稳定、机器可读）
    await expect(deliver(service, '/apps/demo/task/5', caller))
      .rejects.toMatchObject({ code: 'page/hop-limit' })
    // 超限的投递不产生任何会话副作用：仍然只有上限内那 4 条
    expect(sessions.created).toHaveLength(MAX_DELIVERY_HOPS)
  })

  it('台账条目随会话消失惰性清理：会话不在 → 深度归 0', async () => {
    const ledger = new HopLedger()
    const { port } = fakeSessions()
    expect(ledger.depthOf(port, undefined)).toBe(0)
    await port.create('s-1', 't')
    ledger.record('s-1', 3)
    expect(ledger.depthOf(port, 's-1')).toBe(3)
    // 会话不在 → 条目清除、深度归 0
    expect(ledger.depthOf(port, 's-missing')).toBe(0)
  })
})

describe('废弃竞态（§3.9 风险 3：投递途中指针易主）', () => {
  it('投递后重查索引：消息补投给新活会话，redirected=true', async () => {
    const harness = makeService()
    const stale = await harness.service.openUrl('/apps/demo/task/1')
    // 包一层索引：第一次 lookup 返回投递开始时的旧行（s1），
    // 期间人重开同一 URL（s1 废弃、s2 上位），后续 lookup 走真实索引。
    const base = harness.service.instances
    const staleRow = harness.kv.map.get('/apps/demo/task/1')
    expect(staleRow?.sessionId).toBe(stale.sessionId)
    let first = true
    const racing: PageInstanceIndex = {
      // 逐方法委托（索引是类实例，不能 spread）——只换 lookup 的第一次行为
      // per-method delegation (the index is a class; spreading drops methods)
      lookup: async (url) => {
        if (first) {
          first = false
          await harness.service.openUrl('/apps/demo/task/1') // 人此刻重开：s1 废弃、s2 上位
          return staleRow // 投递方手里的过时快照
        }
        return base.lookup(url)
      },
      reserve: (url, sessionId, snapshot) => base.reserve(url, sessionId, snapshot),
      commit: (url, sessionId) => base.commit(url, sessionId),
      deprecate: (url, reason) => base.deprecate(url, reason),
      fail: (url, reason) => base.fail(url, reason),
      forget: (url) => base.forget(url),
      listByApp: (appId) => base.listByApp(appId),
      sweepReserved: () => base.sweepReserved(),
    }
    harness.service.bindPorts(harness.ports, racing)
    const result = await deliver(harness.service, '/apps/demo/task/1')
    // 规则：消息跟着 URL 走，不跟会话走——最终落在当前活会话上
    expect(result.redirected).toBe(true)
    expect(result.created).toBe(false)
    expect(result.sessionId).not.toBe(stale.sessionId)
    const current = harness.kv.map.get('/apps/demo/task/1')
    expect(current?.state).toBe('live')
    expect(result.sessionId).toBe(current?.sessionId)
    // 两次 append：一次落在已废弃的旧会话（既成事实），补投一次落在新活会话
    expect((harness.sessions.messages.get(stale.sessionId) ?? []).some((m) => m.startsWith('page/send::'))).toBe(true)
    expect((harness.sessions.messages.get(result.sessionId) ?? []).some((m) => m.startsWith('page/send::'))).toBe(true)
  })

  it('废弃会话不再被寻址：索引只指向 live 行', async () => {
    const { service } = makeService()
    const first = await service.openUrl('/apps/demo/task/1')
    await service.openUrl('/apps/demo/task/1') // first 废弃
    const result = await deliver(service, '/apps/demo/task/1')
    expect(result.sessionId).not.toBe(first.sessionId)
    expect(result.created).toBe(false)
  })
})

describe('页面工具完备性警告（§3.9，挂载期判据 / mount-time verdict）', () => {
  it('writes: true 且真实挂载面为零 → 一句话警告；挂载面非零或未声明 → undefined', () => {
    // 判据是真实挂载面数量（静态声明 + 组件体登记的并集，挂载方传入）：
    // 声明清单不再参与判断——注册期看不到 ctx.page.tool，只有挂载期能下结论。
    // / the verdict reads the really-mounted count (declared + body-recorded
    // union, passed by the mounter): the declaration list no longer counts —
    // registration never sees ctx.page.tool, only the mount may conclude.
    const silent = defineAppPage({ name: 'read-only', url: '/apps/demo/ro', description: '只读页' })
    expect(pageToolWarning(silent, 0)).toBeUndefined()
    const declared = defineAppPage({ name: 'writer', url: '/apps/demo/w', description: 'd', writes: true })
    // 声明了清单但真实面为零（比如组件体没登记）→ 照样警告 / declared but the real face is empty → still warns
    expect(pageToolWarning(declared, 0)).toContain('declares writes: true but mounts no tools')
    expect(pageToolWarning(declared, 2)).toBeUndefined()
    const broken = defineAppPage({ name: 'broken', url: '/apps/demo/b', description: 'd', writes: true })
    expect(pageToolWarning(broken, 0)).toContain('declares writes: true but mounts no tools')
  })
})

describe('page_send 工具本体（defineTool 产物）', () => {
  it('名字/参数/调用方注入链深台账', async () => {    const { service } = makeService()
    const tool = createPageSendTool(() => service)
    expect(tool.name).toBe('page_send')
    // ToolSchema.parameters 是 Record<string, unknown>（dsh-llm 侧的原始 JSON Schema），
    // 取 properties 需要显式收窄。
    // ToolSchema.parameters is a Record<string, unknown> (raw JSON Schema on the
    // dsh-llm side), so reading properties needs an explicit narrowing.
    expect(Object.keys((tool.parameters.properties ?? {}) as Record<string, unknown>)).toEqual(['url', 'message', 'wake'])
    expect(tool.parameters.required).toEqual(['url', 'message'])
    const opened = await service.openUrl('/apps/demo/task/1')
    // execute(args, exec)：exec.agent.session.id 进链深台账（假 exec 只取这条路径）
    const receipt = await tool.execute(
      { url: '/apps/demo/task/1', message: '接着干' },
      { agent: { session: { id: opened.sessionId } } } as never,
    )
    expect(receipt).toMatchObject({ sessionId: opened.sessionId, created: false, redirected: false })
  })
})
