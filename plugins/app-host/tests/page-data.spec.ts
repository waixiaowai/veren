/**
 * PAGE-DATA 同步（§3.10.2/§3.10.3）的行为验收："这件事发生了"式断言——
 * store 变化后，下一轮模型请求的内容里真的出现了新数据。
 * Behavioral acceptance for the PAGE-DATA sync (§3.10.2/§3.10.3), asserted as
 * "this thing happened": after a store mutation, the next model-facing request
 * content really contains the new data.
 *
 * 真实程度（如实）：真实 cordis Context、真实 dsh-scope 作用域（作用域键 =
 * agent 对象，与 agentCarrier 同构）、真实 prompt-page 挂载管线（store →
 * bindStore → MessageHost，全同步）、生产枢纽 createPageDataSync 本体。假件
 * 只有 Agent 脸（只实现被测路径触到的成员）与最内层 next。
 * Fidelity: a real cordis Context, real dsh-scope scopes (scope key = the agent
 * object, isomorphic to agentCarrier), the real prompt-page mount pipeline
 * (store → bindStore → MessageHost, fully synchronous), and the production hub
 * itself. Only the Agent face (members the tested path touches) and the
 * innermost `next` are faked.
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { agentEvents } from '@deepseek-ai/dsh-agent'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { createScope } from '@deepseek-ai/dsh-scope'
import { Data, Keyed, definePage, mountPage } from '@veren/prompt-page'
import type { Entity, PageDefinition, PageParams, PageSession } from '@veren/prompt-page'
import { createPageDataSync, DEFAULT_PAGE_DATA_CAPS } from '../src/page-sync.ts'
import type { PageDataCaps, PageDataSyncHub } from '../src/page-sync.ts'

/** 假 Agent：只带被测路径触到的成员 / the fake Agent: only the members the tested path touches */
interface FakeAgent {
  readonly id: string
  ctx: Context
  readonly session: { readonly id: string }
}

/** 建假 Agent 并给它真实的作用域上下文（作用域键 = agent 对象，与运行时一致）
 * / Build a fake Agent with a real scoped context (scope key = the agent object, matching the runtime) */
function makeAgent(root: Context, id: string): FakeAgent {
  const agent: FakeAgent = { id, ctx: root, session: { id } }
  agent.ctx = createScope(root, agent).ctx
  return agent
}

/** 面板页面树：一个 keyed 集合块 / the board page tree: one keyed collection block */
interface Item extends Entity { readonly title: string }

function boardPage(): PageDefinition<Item[]> {
  return definePage<Item[]>({
    name: 'board',
    url: '/apps/demo/board/:id',
    description: '面板页',
    tree: (_params: PageParams, state: Item[]) => [...Keyed({ path: 'items', items: state })],
  })
}

/** 权威 store：可变、可订阅、引用稳定 / the authoritative store: mutable, subscribable, stable references */
function makeStore(initial: Item[]): {
  getState(): Item[]
  subscribe(listener: () => void): () => void
  mutate(next: Item[]): void
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

/** 建一个已绑定实时视图的会话：视图 + agent + 注销器 / one session with a bound live view: view + agent + detachers */
function mountSession(hub: PageDataSyncHub, ctx: Context, sessionId: string, items: Item[]) {
  const store = makeStore(items)
  const page = boardPage()
  const view: PageSession<never> = mountPage({ page, store, params: { id: '1' } })
  hub.port.bind(sessionId, view, { pageKey: 'demo/board', url: '/apps/demo/board/1' })
  const agent = makeAgent(ctx, sessionId)
  const detach = hub.attach(sessionId, agent)
  return { store, view, agent, detach }
}

/** 跑一轮 pre-step：最内层 next 返回已认领消息（agent-loop 的默认语义）
 * / Run one pre-step: the innermost next returns the claimed messages (agent-loop's default) */
async function runPreStep(ctx: Context, agent: FakeAgent, claimed: UserMessage[]): Promise<PreStepDecision> {
  // 唯一的类型断言：假 Agent 只实现被测路径触到的成员（同结算测试的先例）
  // The single type assertion: the fake implements only the members the tested path touches
  return await agentEvents(ctx, agent as unknown as Agent).waterfall('agent/pre-step', {
    messages: claimed,
    turn: 0,
    step: 0,
    signal: new AbortController().signal,
  }, async (): Promise<PreStepDecision> => ({ kind: 'enter', messages: claimed }))
}

/** 一条用户消息的便捷构造 / a user-message convenience constructor */
function user(text: string): UserMessage {
  return createUserMessage({ content: [{ type: 'text', text }] })
}

/** 消息里的文本 / the text inside one message */
function textOf(message: UserMessage): string {
  return message.content.map((block) => (block.type === 'text' ? block.text : '')).join('')
}

/** 取最后一个 PAGE-DATA 块的 data 载荷 / the data payload of the last PAGE-DATA block */
function pageDataPayload(decision: PreStepDecision): { header: string; data: Record<string, unknown> } | undefined {
  for (let index = decision.messages.length - 1; index >= 0; index -= 1) {
    const text = textOf(decision.messages[index]!)
    if (!text.startsWith('PAGE-DATA ')) continue
    const [header, dataLine] = text.split('\n')
    return { header: header ?? '', data: JSON.parse((dataLine ?? '').slice('data: '.length)) as Record<string, unknown> }
  }
  return undefined
}

/** 读 data 载荷里的 collections（JSON.parse 的返回值按已知 wire 形状收窄；与 src 的 PageDataPayload 对应）
 * / read the payload's collections (narrowing JSON.parse's return to the known wire shape; mirrors PageDataPayload in src) */
function collectionsOf(payload: { data: Record<string, unknown> } | undefined): Record<string, { total: number; items: unknown[] }> {
  return (payload?.data.collections ?? {}) as Record<string, { total: number; items: unknown[] }>
}

describe('PAGE-DATA 同步（§3.10.2）：store 变化 → 下一轮模型请求里真的出现新数据', () => {
  it('①首轮注入基线快照；store 变更后下一轮注入新数据；无变化零注入', async () => {
    const ctx = new Context()
    const hub = createPageDataSync({ caps: DEFAULT_PAGE_DATA_CAPS })
    const { store, agent } = mountSession(hub, ctx, 's-1', [{ id: 'i-1', title: '基线任务' }])

    // 第一轮：游标从 0 起步，先注入全量基线（模型对页面状态从不盲飞）
    // Turn one: the cursor starts at 0, so the full baseline goes first
    const first = await runPreStep(ctx, agent, [user('第一轮')])
    const baseline = pageDataPayload(first)
    expect(baseline?.header).toContain('PAGE-DATA demo/board /apps/demo/board/1 v')
    expect(JSON.stringify(baseline?.data)).toContain('基线任务')

    // THE 行为：store 一变，下一轮模型请求的内容里真的出现新数据
    // THE behavior: one store mutation, and the next model-facing request really has the new data
    store.mutate([{ id: 'i-1', title: '基线任务' }, { id: 'i-2', title: '新任务α' }])
    const second = await runPreStep(ctx, agent, [user('第二轮')])
    const after = pageDataPayload(second)
    expect(after?.header).toContain('v')
    expect(JSON.stringify(after?.data)).toContain('新任务α')
    // 已注入的版本推进：下一轮（无变化）零注入——上下文不被重复灌水
    // The injected version advanced: no change → no injection next turn
    const third = await runPreStep(ctx, agent, [user('第三轮')])
    expect(pageDataPayload(third)).toBeUndefined()
    expect(third.messages).toHaveLength(1)
  })

  it('②顺序钉死：page_send 的已认领消息在前，PAGE-DATA 追加在后', async () => {
    const ctx = new Context()
    const hub = createPageDataSync({ caps: DEFAULT_PAGE_DATA_CAPS })
    const { store, agent } = mountSession(hub, ctx, 's-1', [{ id: 'i-1', title: '任务' }])
    store.mutate([{ id: 'i-1', title: '任务' }, { id: 'i-2', title: '变更' }])
    // followup（page_send 语义）先入队，成为下一轮的已认领消息
    // The followup (page_send semantics) enqueues first and becomes the claimed message
    const decision = await runPreStep(ctx, agent, [user('page/send 投递文本')])
    expect(textOf(decision.messages[0]!)).toBe('page/send 投递文本')
    expect(textOf(decision.messages[1]!).startsWith('PAGE-DATA ')).toBe(true)
  })

  it('③多会话隔离：只有本会话的 agent 收到本会话页面的注入', async () => {
    const ctx = new Context()
    const hub = createPageDataSync({ caps: DEFAULT_PAGE_DATA_CAPS })
    const a = mountSession(hub, ctx, 's-a', [{ id: 'i-1', title: 'α页任务' }])
    const b = mountSession(hub, ctx, 's-b', [{ id: 'j-1', title: 'β页任务' }])
    // B 先跑完自己的首轮（基线已注入、游标就位），隔离断言才公平
    // B first consumes its own baseline turn, so the isolation assertion is fair
    await runPreStep(ctx, b.agent, [user('B 首轮')])
    // 只动 A 的 store：A 的下一轮有 α 数据；B 的下一轮一片干净
    // Only A's store moves: A's next turn carries α data; B's next turn stays clean
    a.store.mutate([{ id: 'i-1', title: 'α页任务' }, { id: 'i-2', title: 'α的新变化' }])
    const decisionA = await runPreStep(ctx, a.agent, [user('A 轮')])
    expect(JSON.stringify(pageDataPayload(decisionA)?.data)).toContain('α的新变化')
    const decisionB = await runPreStep(ctx, b.agent, [user('B 轮')])
    expect(pageDataPayload(decisionB)).toBeUndefined()
    expect(decisionB.messages).toHaveLength(1)
  })

  it('④废弃（unbind）后：视图退订（版本不再前进），agent 再跑 pre-step 零注入', async () => {
    const ctx = new Context()
    const hub = createPageDataSync({ caps: DEFAULT_PAGE_DATA_CAPS })
    const { store, view, agent } = mountSession(hub, ctx, 's-1', [{ id: 'i-1', title: '任务' }])
    const versionBefore = view.host.currentVersion
    hub.port.unbind('s-1') // page-registry 废弃路径调用的入口 / the deprecation path's entry call
    expect(hub.size()).toBe(0)
    store.mutate([{ id: 'i-1', title: '任务' }, { id: 'i-2', title: '废弃后的变化' }])
    // 订阅已退订：store 变化不再推动这个视图 / The subscription is gone: store changes no longer move this view
    expect(view.host.currentVersion).toBe(versionBefore)
    const decision = await runPreStep(ctx, agent, [user('废弃后的轮次')])
    expect(pageDataPayload(decision)).toBeUndefined()
  })

  it('⑤条数上限：maxItems 2、store 6 条 → 只列 2 条、total 保留 6、标注 truncated', async () => {
    const ctx = new Context()
    const caps: PageDataCaps = { maxItems: 2, maxBytes: 4096 }
    const hub = createPageDataSync({ caps })
    const { store, agent } = mountSession(hub, ctx, 's-1',
      [1, 2, 3, 4, 5].map((n) => ({ id: `i-${n}`, title: `任务${n}` })))
    store.mutate([1, 2, 3, 4, 5, 6].map((n) => ({ id: `i-${n}`, title: `任务${n}` })))
    const decision = await runPreStep(ctx, agent, [user('截断轮')])
    const collection = collectionsOf(pageDataPayload(decision)).items
    expect(collection.items).toHaveLength(2)
    expect(collection.total).toBe(6)
    expect(pageDataPayload(decision)?.data.truncated).toBe(true)
  })

  it('⑥字节上限：预算 120 → 整区截断标注 truncated，data 序列化严格不超预算', async () => {
    const ctx = new Context()
    const hub = createPageDataSync({ caps: { maxItems: 50, maxBytes: 120 } })
    const { store, agent } = mountSession(hub, ctx, 's-1',
      Array.from({ length: 12 }, (_, n) => ({ id: `i-${n}`, title: `很长的任务标题${n}——————` })))
    store.mutate(Array.from({ length: 12 }, (_, n) => ({ id: `i-${n}`, title: `更长的任务标题${n}——————` })))
    const decision = await runPreStep(ctx, agent, [user('字节轮')])
    const payload = pageDataPayload(decision)
    expect(JSON.stringify(payload?.data).length).toBeLessThanOrEqual(120)
    expect(payload?.data.truncated).toBe(true)
  })

  it('⑦超大单值：默认上限下 3000 字符字段被换成省略标记，同块其余数据照常保留', async () => {
    const ctx = new Context()
    const hub = createPageDataSync({ caps: DEFAULT_PAGE_DATA_CAPS })
    const store = makeStore([{ id: 'i-1', title: '任务' }])
    const page = definePage<Item[]>({
      name: 'board', url: '/apps/demo/board/:id', description: 'd',
      tree: (_params, state) => [
        ...Keyed({ path: 'items', items: state }),
        ...Data({ path: 'note', value: 'x'.repeat(3000) }),
      ],
    })
    const view: PageSession<never> = mountPage({ page, store, params: { id: '1' } })
    hub.port.bind('s-1', view, { pageKey: 'demo/board', url: '/apps/demo/board/1' })
    const agent = makeAgent(ctx, 's-1')
    hub.attach('s-1', agent)
    store.mutate([{ id: 'i-1', title: '任务' }, { id: 'i-2', title: '新任务' }])
    const decision = await runPreStep(ctx, agent, [user('大值轮')])
    const payload = pageDataPayload(decision)
    const fields = (payload?.data.fields ?? {}) as Record<string, unknown>
    // 超大单值换成省略标记，且标注 truncated；集合区照常保留
    // The oversized single value becomes an omission marker and is flagged; the collection survives
    expect(String(fields.note)).toContain('omitted')
    expect(payload?.data.truncated).toBe(true)
    expect(collectionsOf(payload).items.items).toHaveLength(2)
    expect(JSON.stringify(payload?.data).length).toBeLessThan(1000)
  })
})
