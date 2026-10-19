// 官方 buildForkSeed 的冒烟测试：确认公开导出满足本插件的分叉语义。
// Smoke tests for the official buildForkSeed: confirm the public export meets
// this plugin's fork semantics.
import { describe, expect, it } from 'vitest'
import { buildForkSeed, SessionSeq } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

/** 构造最小事件夹具。Build a minimal event fixture. */
function event(type: string, seq: number, data: unknown = {}): SessionEvent {
  return { type, seq, time: 0, surfaceOp: 'append', data } as unknown as SessionEvent
}

describe('buildForkSeed（官方导出 / shipped export）', () => {
  it('复制前缀并写入继承标记 / copies the prefix and marks the inherited cut', () => {
    const events = [
      event('turn/start', 0, { turn: 0 }),
      event('turn/end', 1, { turn: 0 }),
    ]
    const seed = buildForkSeed(events, SessionSeq(1))
    expect(seed.slice(0, 2)).toEqual(events)
    expect(seed[2]).toMatchObject({ type: 'session/end-seed', seq: 2, data: { inherited: true } })
    // 已平衡日志只追加继承标记。A balanced log only gains the inherited marker.
    expect(seed).toHaveLength(3)
  })

  it('开放尾部补合成 closers / closes an open tail with synthetic closers', () => {
    const events = [
      event('turn/start', 0, { turn: 0 }),
      event('step/start', 1, { turn: 0, step: 0 }),
      event('assistant/message', 2, {
        turn: 0, step: 0,
        message: { id: 'a1', role: 'assistant', content: [{ type: 'tool-call', id: 'call-1' }] },
      }),
      // 已记录开始但结果未落盘：恢复码必须是 OUTCOME_UNKNOWN。
      // Started but its result was never durably recorded: the recovery code
      // must be OUTCOME_UNKNOWN.
      event('tool/call', 3, { callId: 'call-1', turn: 0, step: 0 }),
    ]
    const seed = buildForkSeed(events, SessionSeq(3))
    // 种子布局：前缀(4) + end-seed(1) + 合成 closers。
    // Seed layout: prefix(4) + end-seed(1) + synthetic closers.
    const types = seed.slice(5).map(e => e.type)
    // 合成 tool/result + step/end + turn/end。A synthetic tool/result, step/end, turn/end.
    expect(types).toEqual(['tool/result', 'step/end', 'turn/end'])
    const result = seed[5] as unknown as { data: { error: { code: string }, message: { isError: boolean } } }
    expect(result.data.error.code).toBe('TOOL_OUTCOME_UNKNOWN')
    expect(result.data.message.isError).toBe(true)
  })
})
