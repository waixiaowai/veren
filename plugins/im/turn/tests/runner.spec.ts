import { describe, expect, it } from 'vitest'
import { ALICE, BOB, OWNER, build, postedBy, wakeAlice } from './helpers.ts'

describe('turn runner', () => {
  it('runs one wake into one posted reply and a completed run', async () => {
    const stack = build()
    const room = await stack.rooms.createRoom({ kind: 'direct', memberIds: [OWNER, ALICE] })
    const trigger = await postedBy(stack, room.id, OWNER, '帮我看下这个方案')
    stack.engine.feed('方案整体可行，我建议把第二段拆成两步。')
    await wakeAlice(stack, room.id, trigger.id)
    const messages = stack.runMessages().filter(m => m.author_id === ALICE)
    expect(messages).toHaveLength(1)
    expect(messages[0]?.body).toContain('第二段')
    const run = stack.runs.list()[0]
    expect(run?.status).toBe('completed')
    expect(run?.replyMessageId).toBeDefined()
    // The watermark advanced to the inbox end: a re-wake reads nothing.
    // 水位推进到收件箱末端：再次唤醒读不到东西。
    await wakeAlice(stack, room.id, trigger.id)
    expect(stack.runs.list()[0]?.status).toBe('completed')
    expect(stack.runs.list().filter(run => run.skipCause === 'nothing-to-read')).toHaveLength(1)
  })

  it('stays deliberately quiet when the engine answers empty, and records it', async () => {
    const stack = build()
    const room = await stack.rooms.createRoom({ kind: 'direct', memberIds: [OWNER, ALICE] })
    const trigger = await postedBy(stack, room.id, OWNER, '（闲聊）')
    stack.engine.feed(undefined)
    await wakeAlice(stack, room.id, trigger.id)
    expect(stack.runMessages().filter(m => m.author_id === ALICE)).toHaveLength(0)
    expect(stack.runs.list()[0]?.status).toBe('completed')
    // The quiet still consumed the inbox: no repeated wake storm.
    // 安静也消费了收件箱：不会反复唤醒成风暴。
    await wakeAlice(stack, room.id, trigger.id)
    expect(stack.runs.list().filter(run => run.skipCause === 'nothing-to-read')).toHaveLength(1)
  })

  it('absorbs a duplicate wake through the input fingerprint', async () => {
    const stack = build()
    const room = await stack.rooms.createRoom({ kind: 'group', memberIds: [OWNER, ALICE, BOB] })
    const trigger = await postedBy(stack, room.id, OWNER, '报个数')
    stack.engine.feed('一')
    await stack.coordination.markSeen(BOB, room.id, 1)
    await wakeAlice(stack, room.id, trigger.id)
    // Simulate the crash state: the reply landed but the seen mark lagged, so
    // the same inbox presents again. The fingerprint absorbs it.
    // 模拟崩溃状态：回复已落地但已见标记滞后，同一收件箱再次出现。指纹把它吸收掉。
    await stack.setSeenDirectly(ALICE, room.id, 0)
    await wakeAlice(stack, room.id, trigger.id)
    expect(stack.runMessages().filter(m => m.author_id === ALICE && m.body === '一')).toHaveLength(1)
    expect(stack.runs.list().filter(run => run.skipCause === 'fingerprint-hit')).toHaveLength(1)
  })

  it('rewrites after a verbatim hold and passes on the second attempt', async () => {
    const stack = build()
    const room = await stack.rooms.createRoom({ kind: 'direct', memberIds: [OWNER, ALICE] })
    // The latest peer message IS '收到', so echoing it verbatim must hold.
    // 最新的非自身消息就是「收到」，因此逐字复述必须被拒。
    const trigger = await postedBy(stack, room.id, OWNER, '收到')
    stack.engine.feed('收到', '好的，收到，我们继续')
    await wakeAlice(stack, room.id, trigger.id)
    const replies = stack.runMessages().filter(m => m.author_id === ALICE)
    expect(replies).toHaveLength(1)
    expect(replies[0]?.body).toBe('好的，收到，我们继续')
    expect(stack.engine.prompts[1]).toContain('Your reply was held')
    expect(stack.runs.list()[0]?.status).toBe('completed')
  })

  it('stands down after three gate rounds with a skipped(held-out) run', async () => {
    const stack = build()
    const room = await stack.rooms.createRoom({ kind: 'group', memberIds: [OWNER, ALICE, BOB] })
    await postedBy(stack, room.id, OWNER, '话题甲')
    const trigger = await postedBy(stack, room.id, OWNER, '继续话题甲')
    // Every reply collides verbatim with Bob's standing messages.
    // 每条回复都与 Bob 的既有消息逐字撞车。
    stack.engine.feed('话题甲', '话题甲', '话题甲')
    await postedBy(stack, room.id, BOB, '话题甲')
    await postedBy(stack, room.id, BOB, '话题甲')
    await wakeAlice(stack, room.id, trigger.id)
    expect(stack.runMessages().filter(m => m.author_id === ALICE)).toHaveLength(0)
    const run = stack.runs.list()[0]
    expect(run?.status).toBe('skipped')
    expect(run?.skipCause).toBe('held-out')
  })

  it('records a rate-limited model as skipped with one deduplicated notice', async () => {
    const stack = build()
    const room = await stack.rooms.createRoom({ kind: 'direct', memberIds: [OWNER, ALICE] })
    const trigger = await postedBy(stack, room.id, OWNER, '在吗')
    stack.engine.feed(new Error('provider returned 429 rate limited'))
    await wakeAlice(stack, room.id, trigger.id)
    const run = stack.runs.list()[0]
    expect(run?.status).toBe('skipped')
    expect(run?.skipCause).toBe('model-rate-limited')
    const notices = stack.runMessages().filter(m => m.kind === 'system')
    expect(notices).toHaveLength(1)
    // A second identical failure inside the window posts nothing new.
    // 窗口内的第二次相同失败不再发新提示。
    await postedBy(stack, room.id, OWNER, '还在吗')
    stack.engine.feed(new Error('provider returned 429 rate limited'))
    await wakeAlice(stack, room.id, trigger.id)
    expect(stack.runMessages().filter(m => m.kind === 'system')).toHaveLength(1)
  })

  it('lands a generic engine failure as a failed run with the reason recorded', async () => {
    const stack = build()
    const room = await stack.rooms.createRoom({ kind: 'direct', memberIds: [OWNER, ALICE] })
    const trigger = await postedBy(stack, room.id, OWNER, '在吗')
    stack.engine.feed(new Error('session crashed mid-turn'))
    await wakeAlice(stack, room.id, trigger.id)
    const run = stack.runs.list()[0]
    expect(run?.status).toBe('failed')
    expect(run?.error).toContain('session crashed mid-turn')
  })
})
