import { describe, expect, it } from 'vitest'
import { ALICE, BOB, OWNER, build } from './helpers.ts'

describe('write gates', () => {
  it('rejects a stale draft with the unseen facts attached, then passes a plain resend', async () => {
    const { rooms, post, coordination } = build()
    // Three seats: direct rooms (two members) are exempt from freshness.
    // 三个座位：私聊（两成员）豁免新鲜度。
    const room = await rooms.createRoom({ kind: 'group', memberIds: [OWNER, ALICE, BOB] })
    await post.post({ roomId: room.id, actorId: ALICE, kind: 'text', body: '方案甲更好' })
    await coordination.markSeen(BOB, room.id, 1)
    // A peer writes after Bob's watermark: Bob's world is now stale.
    // 同伴在 Bob 的水位之后写入：Bob 的世界过期了。
    await post.post({ roomId: room.id, actorId: OWNER, kind: 'text', body: '我选方案乙' })
    await post.post({ roomId: room.id, actorId: ALICE, kind: 'text', body: '乙可以，我补充一点' })

    const preflight = await coordination.preflightReply(BOB, room.id, '方案甲更好')
    expect(preflight.hold).toBe(true)
    if (preflight.kind !== 'freshness') throw new Error('expected a freshness hold')
    expect(preflight.newer.map(line => line.excerpt)).toEqual(['我选方案乙', '乙可以，我补充一点'])
    // The hold advanced Bob's watermark, so a plain resend passes (design O-03).
    // 拒绝推进了 Bob 的水位，因此原样重发即可通过（设计 O-03）。
    const resend = await coordination.preflightReply(BOB, room.id, '方案甲更好')
    expect(resend.hold).toBe(false)
  })

  it('refuses a verbatim repeat at write time, atomically with the post', async () => {
    const { rooms, post, coordination } = build()
    const room = await rooms.createRoom({ kind: 'direct', memberIds: [OWNER, ALICE] })
    await post.post({ roomId: room.id, actorId: OWNER, kind: 'text', body: '收到' })
    const gate = coordination.gatePost(ALICE, '收到\n', 1)
    await expect(post.post({
      roomId: room.id, actorId: ALICE, kind: 'text', body: '收到', clientId: 'a1',
    }, gate)).rejects.toMatchObject({ code: 'HELD_VERBATIM' })
    // Whitespace differences still collide; a different body passes.
    // 空白差异照样撞车；不同的正文放行。
    const ok = await post.post({ roomId: room.id, actorId: ALICE, kind: 'text', body: '好的，我来处理' },
      coordination.gatePost(ALICE, '好的，我来处理', 1))
    expect(ok.replayed).toBe(false)
    expect(post.list({ roomId: room.id })).toHaveLength(2)
  })

  it('lets two racing posters resolve atomically: first wins, second is held fresh', async () => {
    const { rooms, post, coordination } = build()
    const room = await rooms.createRoom({ kind: 'group', memberIds: [OWNER, ALICE, BOB] })
    await post.post({ roomId: room.id, actorId: OWNER, kind: 'text', body: '报个数' })
    await coordination.markSeen(ALICE, room.id, 1)
    await coordination.markSeen(BOB, room.id, 1)
    const settled = await Promise.allSettled([
      post.post({ roomId: room.id, actorId: ALICE, kind: 'text', body: '一' },
        coordination.gatePost(ALICE, '一', 0)),
      post.post({ roomId: room.id, actorId: BOB, kind: 'text', body: '一' },
        coordination.gatePost(BOB, '一', 0)),
    ])
    // Exactly one poster succeeds; the other was refused by a gate.
    // 恰有一个提交者成功；另一个被闸门拒绝。
    const succeeded = settled.filter(entry => entry.status === 'fulfilled')
    const refused = settled.filter(entry => entry.status === 'rejected')
    expect(succeeded).toHaveLength(1)
    expect(refused).toHaveLength(1)
    expect(post.list({ roomId: room.id }).filter(m => m.body === '一')).toHaveLength(1)
  })

  it('fails open for never-woken agents and two-seat direct rooms', async () => {
    const { rooms, post, coordination } = build()
    const direct = await rooms.createRoom({ kind: 'direct', memberIds: [OWNER, ALICE] })
    await post.post({ roomId: direct.id, actorId: OWNER, kind: 'text', body: '私聊消息' })
    expect((await coordination.preflightReply(ALICE, direct.id, '答')).hold).toBe(false)
    const group = await rooms.createRoom({ kind: 'group', memberIds: [OWNER, ALICE, BOB] })
    await post.post({ roomId: group.id, actorId: OWNER, kind: 'text', body: '群消息一' })
    await post.post({ roomId: group.id, actorId: BOB, kind: 'text', body: '群消息二' })
    // Alice has no watermark: fail open.
    // Alice 没有水位：失败开放。
    expect((await coordination.preflightReply(ALICE, group.id, '答')).hold).toBe(false)
  })
})
