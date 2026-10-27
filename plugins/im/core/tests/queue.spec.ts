import { describe, expect, it } from 'vitest'
import { ImMessageQueue, MAX_MESSAGE_ATTEMPTS } from '../src/queue.ts'
import type { ImMessage } from '../src/contract.ts'
import type { ImMessageRow } from '../src/store.ts'
import { MemoryStore } from './memory-store.ts'

/** One deterministic clock so received_at ordering is fully controlled. */
let clock = 1_000
const now = (): number => ++clock

/** Build one normalized text message. */
function message(id: string, conversationId: string, text: string): ImMessage {
  return {
    id,
    accountId: 'acct-1@im.bot',
    conversationId,
    sender: { id: 'human@im.wechat' },
    sentAt: now(),
    content: { type: 'text', text },
  }
}

/** The queue under test, fresh per call. */
function queue(): ImMessageQueue {
  return new ImMessageQueue({ store: new MemoryStore(), now })
}

/** Read one row back. */
function rowOf(q: ImMessageQueue, id: string): ImMessageRow | undefined {
  return q.recent(50).find(entry => entry.message_id === id)
}

describe('ImMessageQueue', () => {
  it('enqueues idempotently: the same message id is a duplicate no-op', async () => {
    const q = queue()
    expect(await q.enqueue('wechat', message('m1', 'p2p:human', '你好'))).toBe('queued')
    expect(await q.enqueue('wechat', message('m1', 'p2p:human', '你好'))).toBe('duplicate')
    expect(q.recent().length).toBe(1)
  })

  it('claims per conversation in received_at order', async () => {
    const q = queue()
    await q.enqueue('wechat', message('m1', 'p2p:human', 'first'))
    await q.enqueue('wechat', message('m2', 'p2p:human', 'second'))
    await q.enqueue('wechat', message('m3', 'p2p:other', 'unrelated'))

    const first = await q.claimNext('p2p:human')
    expect(first?.text).toBe('first')
    const second = await q.claimNext('p2p:human')
    expect(second?.text).toBe('second')
    // 至多一条在途：已认领的行不再回到 queued。
    expect(await q.claimNext('p2p:human')).toBeUndefined()
    expect(q.pendingCount('p2p:human')).toBe(2)
  })

  it('retries failed attempts and lands in the dead letter after the budget', async () => {
    const q = queue()
    await q.enqueue('wechat', message('m1', 'p2p:human', 'hello'))
    await q.claimNext('p2p:human')

    let row = await q.markFailed('wechat', 'm1')
    expect(row.status).toBe('queued')
    for (let attempt = 1; attempt < MAX_MESSAGE_ATTEMPTS; attempt += 1) {
      await q.claimNext('p2p:human')
      row = await q.markFailed('wechat', 'm1')
    }
    expect(row.status).toBe('dead')
    // 死信不再被认领：终态就是终态。
    expect(await q.claimNext('p2p:human')).toBeUndefined()
  })

  it('recovers rows stuck in consuming after a restart', async () => {
    const q = queue()
    await q.enqueue('wechat', message('m1', 'p2p:human', 'hello'))
    await q.claimNext('p2p:human')

    const recovered = await q.recoverStuck()

    expect(recovered).toBe(1)
    const again = await q.claimNext('p2p:human')
    expect(again?.text).toBe('hello')
  })

  it('remembers the private session per conversation', async () => {
    const q = queue()
    expect(q.sessionOf('p2p:human')).toBeUndefined()
    await q.rememberSession('p2p:human', 'session-1')
    expect(q.sessionOf('p2p:human')).toBe('session-1')
  })

  it('migrates in-flight rows onto the replacing account', async () => {
    const q = queue()
    await q.enqueue('wechat', message('m1', 'p2p:human', 'hello'))
    await q.migrateAccount('acct-1@im.bot', 'acct-2@im.bot')
    expect(q.recent()[0]?.account_id).toBe('acct-2@im.bot')
  })

  it('marks replies with an excerpt and reaches the replied terminal state', async () => {
    const q = queue()
    await q.enqueue('wechat', message('m1', 'p2p:human', '你好'))
    await q.claimNext('p2p:human')
    await q.markReplied('wechat', 'm1', '你好！有什么可以帮你？')
    const row = rowOf(q, 'm1')
    expect(row?.status).toBe('replied')
    expect(row?.reply_excerpt).toContain('有什么')
  })
})
