/**
 * 多账号池不变式：环序轮换、冷却跳过、全冷却最快恢复、粘性不粘坏账号、
 * 未过期优先。
 * Pool invariants: ring rotation, cooldown skipping, soonest-recovery when all
 * cooled, stickiness never sticks to a bad account, unexpired preferred.
 */
import { describe, expect, it } from 'vitest'
import { chooseRotating, RegionPool, SESSION_AFFINITY_TTL_MS, type PoolAccount } from '../src/index.ts'

function account(uid: string, expiresAtMs = 10_000): PoolAccount & { uid: string } {
  return { uid, expiresAtMs }
}

describe('chooseRotating（纯函数）/ pure selection', () => {
  it('环序轮换：游标推进不重不漏', () => {
    const accounts = [account('a'), account('b'), account('c')]
    const first = chooseRotating(accounts, 0, new Map(), 0)
    expect(first?.account.uid).toBe('a')
    const second = chooseRotating(accounts, first?.nextCursor ?? 0, new Map(), 0)
    expect(second?.account.uid).toBe('b')
  })

  it('未过期优先：有活账号时不为请求花过期账号的刷新周期', () => {
    const accounts = [account('expired', 100), account('live', 10_000)]
    const decision = chooseRotating(accounts, 0, new Map(), 1_000)
    expect(decision?.account.uid).toBe('live')
  })

  it('冷却中的账号不选；全冷却时服务最快恢复的账号', () => {
    const accounts = [account('a'), account('b'), account('c')]
    const cooled = new Map([['a', 5_000], ['b', 2_000], ['c', 9_000]])
    // now=0 全冷却：b 最先恢复（2s）。
    expect(chooseRotating(accounts, 0, cooled, 0)?.account.uid).toBe('b')
    // now=3_000：只有 b 已恢复。
    expect(chooseRotating(accounts, 0, cooled, 3_000)?.account.uid).toBe('b')
  })

  it('空池回答 undefined', () => {
    expect(chooseRotating([], 0, new Map(), 0)).toBeUndefined()
  })
})

describe('RegionPool 粘性 / stickiness', () => {
  it('会话粘住同一账号；下一条消息不换人', () => {
    const pool = new RegionPool(() => [account('a'), account('b')], () => 0)
    expect(pool.resolve('sess-1')?.uid).toBe('a')
    expect(pool.resolve('sess-1')?.uid).toBe('a')
    expect(pool.resolve('sess-2')?.uid).toBe('b')
  })

  it('粘性不粘坏账号：钉住的账号被冷却后即刻让位健康账号', () => {
    const pool = new RegionPool(() => [account('a'), account('b')], () => 0)
    expect(pool.resolve('sess-1')?.uid).toBe('a')
    pool.noteCooldown('a', 60_000)
    expect(pool.resolve('sess-1')?.uid).toBe('b')
    // 钉住的会话不得绕过冷却：a 冷却期内即使再 resolve 也回不到 a。
    expect(pool.resolve('sess-1')?.uid).toBe('b')
  })

  it('粘性 TTL：静默超时的会话重新轮换', () => {
    let now = 0
    const pool = new RegionPool(() => [account('a'), account('b')], () => now)
    expect(pool.resolve('sess-1')?.uid).toBe('a')
    now += SESSION_AFFINITY_TTL_MS + 1
    expect(pool.resolve('sess-1')?.uid).toBe('b')
  })

  it('登出清除池内痕迹：冷却与粘性一并消失（账号供给同步撤走）', () => {
    const roster = [account('a'), account('b')]
    const pool = new RegionPool(() => roster, () => 0)
    expect(pool.resolve('sess-1')?.uid).toBe('a')
    pool.noteCooldown('a', 60_000)
    roster.splice(0, 1)
    pool.forget('a')
    expect(pool.resolve('sess-1')?.uid).toBe('b')
  })
})
