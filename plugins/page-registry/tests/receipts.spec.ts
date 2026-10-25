/**
 * page_send 回执台账的单元验收：回合边界判定、销毁撤销、防回环（wake:false）。
 * Unit acceptance for the page_send receipt ledger: turn-boundary detection,
 * disarm-on-disposal, and the anti-loop invariant (wake:false).
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { DeliveryReceipts, PAGE_RECEIPT_SOURCE } from '../src/receipts.ts'

/** 会话事件的最小形状（真实派发经 scopeTarget 载体；global 监听器两侧都收）*/
type EventLike = { type: string; data?: unknown }

/** 记录 append 调用的假件 / append spy */
function makeLedger() {
  const appended: Array<{ sessionId: string; text: string; source: string; wake: boolean | undefined }> = []
  const warnings: string[] = []
  const ctx = new Context()
  const receipts = new DeliveryReceipts({
    ctx,
    append: async (sessionId, text, source, options) => {
      appended.push({ sessionId, text, source, wake: options?.wake })
    },
    warn: (message) => { warnings.push(message) },
  })
  const emit = (sessionId: string, event: EventLike): void => {
    // 事件载荷只取本测试关心的两个字段；真实类型在 @deepseek-ai/dsh-session
    // / only the two fields this suite cares about; real types live in dsh-session
    ;(ctx.events as { emit: (...args: unknown[]) => void }).emit('session/event', { id: sessionId }, event)
  }
  const dispose = async (sessionId: string): Promise<void> => {
    ;(ctx.events as { emit: (...args: unknown[]) => void }).emit('agent/disposed', { agent: { session: { id: sessionId } } })
  }
  return { receipts, appended, warnings, emit, dispose }
}

/** assistant 文本事件 / an assistant text event */
const say = (text: string): EventLike => ({
  type: 'assistant/message',
  data: { message: { content: [{ type: 'text', text }] } },
})

describe('DeliveryReceipts（page_send 回执台账）', () => {
  it('唤醒回合结束 → 最终回答以 PAGE-RECEIPT 落回发送方（wake:false，防回环）', async () => {
    const h = makeLedger()
    h.receipts.arm('target-1', 'caller-1', '/apps/x/list')
    h.emit('target-1', { type: 'turn/start', data: { turn: 2 } })
    h.emit('target-1', say('中间思考不算'))
    h.emit('target-1', say('已完成 t-9'))
    h.emit('target-1', { type: 'turn/end', data: { turn: 2, reason: { kind: 'completed' } } })
    await new Promise((resolve) => { setImmediate(resolve) })
    expect(h.appended).toHaveLength(1)
    expect(h.appended[0]).toMatchObject({ sessionId: 'caller-1', source: PAGE_RECEIPT_SOURCE, wake: false })
    expect(h.appended[0].text.startsWith('PAGE-RECEIPT /apps/x/list')).toBe(true)
    expect(h.appended[0].text.includes('已完成 t-9')).toBe(true)
    // 点火即清账 / fired once, ledger emptied
    expect(h.receipts.size).toBe(0)
  })

  it('武装时旧回合在飞行：旧回合的收尾不点火，等真正的回应回合', async () => {
    const h = makeLedger()
    h.emit('target-1', { type: 'turn/start', data: { turn: 1 } })
    h.receipts.arm('target-1', 'caller-1', '/apps/x/list')
    h.emit('target-1', say('旧回合的回答'))
    h.emit('target-1', { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
    await new Promise((resolve) => { setImmediate(resolve) })
    expect(h.appended).toHaveLength(0)
    expect(h.receipts.size).toBe(1)
    // 真正的回应回合才发回执 / the answering round fires the receipt
    h.emit('target-1', { type: 'turn/start', data: { turn: 2 } })
    h.emit('target-1', say('新回合的回答'))
    h.emit('target-1', { type: 'turn/end', data: { turn: 2, reason: { kind: 'completed' } } })
    await new Promise((resolve) => { setImmediate(resolve) })
    expect(h.appended).toHaveLength(1)
    expect(h.appended[0].text.includes('新回合的回答')).toBe(true)
  })

  it('目标 agent 先销毁 → 撤销武装，不发票面陈旧回执', async () => {
    const h = makeLedger()
    h.receipts.arm('target-1', 'caller-1', '/apps/x/list')
    await h.dispose('target-1')
    h.emit('target-1', { type: 'turn/start', data: { turn: 3 } })
    h.emit('target-1', say('迟到的回合'))
    h.emit('target-1', { type: 'turn/end', data: { turn: 3, reason: { kind: 'completed' } } })
    await new Promise((resolve) => { setImmediate(resolve) })
    expect(h.appended).toHaveLength(0)
    expect(h.receipts.size).toBe(0)
  })

  it('无文本回答的回合：回执如实标注而非编造', async () => {
    const h = makeLedger()
    h.receipts.arm('target-2', 'caller-2', '/apps/x/detail')
    h.emit('target-2', { type: 'turn/start', data: { turn: 1 } })
    h.emit('target-2', { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
    await new Promise((resolve) => { setImmediate(resolve) })
    expect(h.appended).toHaveLength(1)
    expect(h.appended[0].text.includes('without a textual answer')).toBe(true)
  })
})
