/**
 * PAGE-PATCH 同步（§3.10.2 组件页语义）的行为验收："这件事发生了"式断言——
 * store 变化后，下一轮模型请求里真的出现变化单元的 Markdown 行；无变化零注入。
 * Behavioral acceptance for PAGE-PATCH sync (§3.10.2's component-page semantics),
 * asserted as "this thing happened": after a store mutation, the next
 * model-facing request really carries the changed units' Markdown lines; no
 * change → no injection.
 *
 * 真实程度（如实）：真实 cordis Context、真实 dsh-scope 作用域（作用域键 =
 * agent 对象）、真实组件页挂载管线（defineComponentPage 的 live.mount）与生产
 * 枢纽 createPageDataSync 本体。假件只有 Agent 脸与最内层 next。
 * Fidelity: a real cordis Context, real dsh-scope scopes (scope key = the agent
 * object), the real component-page mount pipeline (defineComponentPage's
 * live.mount) and the production hub itself. Only the Agent face and the
 * innermost `next` are faked.
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { agentEvents } from '@deepseek-ai/dsh-agent'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { createScope } from '@deepseek-ai/dsh-scope'
import { createElement } from '@veren/prompt-core'
import { defineComponentPage } from '@veren/prompt-page'
import type { PageSession } from '@veren/prompt-page'
import { createPageDataSync } from '../src/page-sync.ts'
import type { PageDataSyncHub } from '../src/page-sync.ts'

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

/** 卡片 / one card */
interface Card { readonly id: string; readonly title: string }

/** 权威 store：可变、可订阅、引用稳定 / the authoritative store: mutable, subscribable, stable references */
function makeStore(initial: Card[]): {
  getState(): Card[]
  subscribe(listener: () => void): () => void
  mutate(next: Card[]): void
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

/** 组件页：卡片列表（keyed li，Markdown 出 `- id title` 行）/ the component page: a keyed card list (Markdown `- id title` lines) */
function boardView(store: { getState(): Card[]; subscribe(listener: () => void): () => void }): PageSession<never> {
  const registration = defineComponentPage(
    () => createElement('ul', { children: store.getState().map((c) => createElement('li', { key: c.id, children: `${c.id} ${c.title}` })) }),
    { url: '/apps/demo/board/:id', description: '面板页', store },
  )
  return registration.live.mount({ id: '1' }) as unknown as PageSession<never>
}

/** 建一个已绑定实时视图的会话：视图 + agent + 注销器 / one session with a bound live view: view + agent + detachers */
function mountSession(hub: PageDataSyncHub, ctx: Context, sessionId: string, items: Card[]) {
  const store = makeStore(items)
  const view = boardView(store)
  hub.port.bind(sessionId, view, { pageKey: 'demo/board', url: '/apps/demo/board/1' })
  const agent = makeAgent(ctx, sessionId)
  const detach = hub.attach(sessionId, agent as unknown as Agent)
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
  return createUserMessage({ content: [{ type: 'text', text }], source: { kind: 'user' } })
}

/** 取决策里被认领的消息：PreStepDecision 是可判别联合，reject 在测试里就是失败
 * / the messages a decision admits: PreStepDecision is a discriminated union, and a
 * reject decision is a test failure here */
function messagesOf(decision: PreStepDecision): readonly UserMessage[] {
  if (decision.kind !== 'enter') throw new Error('expected the pre-step to admit messages, got a reject decision')
  return decision.messages
}

/** 消息里的文本 / the text inside one message */
function textOf(message: UserMessage): string {
  return message.content.map((block) => (block.type === 'text' ? block.text : '')).join('')
}

/** 取最后一个 PAGE-PATCH 块文本 / the last PAGE-PATCH block's text */
function pagePatchText(decision: PreStepDecision): string | undefined {
  const messages = messagesOf(decision)
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const text = textOf(messages[index]!)
    if (text.startsWith('PAGE-PATCH ')) return text
  }
  return undefined
}

describe('PAGE-PATCH 同步（§3.10.2 组件页语义）：store 变化 → 下一轮模型请求里真的出现变化单元', () => {
  it('①变化单元进 PAGE-PATCH；无变化零注入（版本门控）', async () => {
    const ctx = new Context()
    const hub = createPageDataSync()
    const { store, agent } = mountSession(hub, ctx, 's-1', [{ id: 'i-1', title: '基线任务' }])

    // 首帧无变化 → 零注入（基线已在 PAGE 块正文里，不重复灌水）
    // No change since mount → zero injection (the baseline is already the PAGE block's body)
    const first = await runPreStep(ctx, agent, [user('第一轮')])
    expect(pagePatchText(first)).toBeUndefined()

    // THE 行为：store 一变，下一轮模型请求里真的出现变化行
    // THE behavior: one store mutation, and the next model-facing request really carries the changed line
    store.mutate([{ id: 'i-1', title: '基线任务' }, { id: 'i-2', title: '新任务α' }])
    const second = await runPreStep(ctx, agent, [user('第二轮')])
    const patch = pagePatchText(second)
    expect(patch?.startsWith('PAGE-PATCH demo/board /apps/demo/board/1 v')).toBe(true)
    expect(patch).toContain('- i-2 新任务α')
    // 未变的基线行不重发 / the unchanged baseline line is not re-sent
    expect(patch).not.toContain('- i-1')

    // 已注入的版本推进：下一轮（无变化）零注入——上下文不被重复灌水
    // The injected version advanced: no change → no injection next turn
    const third = await runPreStep(ctx, agent, [user('第三轮')])
    expect(pagePatchText(third)).toBeUndefined()
    expect(messagesOf(third)).toHaveLength(1)
  })

  it('②顺序钉死：page_send 的已认领消息在前，PAGE-PATCH 追加在后', async () => {
    const ctx = new Context()
    const hub = createPageDataSync()
    const { store, agent } = mountSession(hub, ctx, 's-1', [{ id: 'i-1', title: '任务' }])
    store.mutate([{ id: 'i-1', title: '任务' }, { id: 'i-2', title: '变更' }])
    // followup（page_send 语义）先入队，成为下一轮的已认领消息
    // The followup (page_send semantics) enqueues first and becomes the claimed message
    const decision = await runPreStep(ctx, agent, [user('page/send 投递文本')])
    expect(textOf(messagesOf(decision)[0]!)).toBe('page/send 投递文本')
    expect(textOf(messagesOf(decision)[1]!).startsWith('PAGE-PATCH ')).toBe(true)
  })

  it('③多会话隔离：只有本会话的 agent 收到本会话页面的注入', async () => {
    const ctx = new Context()
    const hub = createPageDataSync()
    const a = mountSession(hub, ctx, 's-a', [{ id: 'i-1', title: 'α页任务' }])
    const b = mountSession(hub, ctx, 's-b', [{ id: 'j-1', title: 'β页任务' }])
    // B 先跑完自己的首轮（基线已注入、游标就位），隔离断言才公平
    // B first consumes its own baseline turn, so the isolation assertion is fair
    await runPreStep(ctx, b.agent, [user('B 首轮')])
    // 只动 A 的 store：A 的下一轮有 α 数据；B 的下一轮一片干净
    // Only A's store moves: A's next turn carries α data; B's next turn stays clean
    a.store.mutate([{ id: 'i-1', title: 'α页任务' }, { id: 'i-2', title: 'α的新变化' }])
    const decisionA = await runPreStep(ctx, a.agent, [user('A 轮')])
    expect(pagePatchText(decisionA)).toContain('α的新变化')
    const decisionB = await runPreStep(ctx, b.agent, [user('B 轮')])
    expect(pagePatchText(decisionB)).toBeUndefined()
    expect(messagesOf(decisionB)).toHaveLength(1)
  })

  it('④废弃（unbind）后：视图退订（版本不再前进），agent 再跑 pre-step 零注入', async () => {
    const ctx = new Context()
    const hub = createPageDataSync()
    const { store, view, agent } = mountSession(hub, ctx, 's-1', [{ id: 'i-1', title: '任务' }])
    const versionBefore = view.host.currentVersion
    hub.port.unbind('s-1') // page-registry 废弃路径调用的入口 / the deprecation path's entry call
    expect(hub.size()).toBe(0)
    store.mutate([{ id: 'i-1', title: '任务' }, { id: 'i-2', title: '废弃后的变化' }])
    // 订阅已退订：store 变化不再推动这个视图 / The subscription is gone: store changes no longer move this view
    expect(view.host.currentVersion).toBe(versionBefore)
    const decision = await runPreStep(ctx, agent, [user('废弃后的轮次')])
    expect(pagePatchText(decision)).toBeUndefined()
  })
})
