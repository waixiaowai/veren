/**
 * The activity source: the panel's working row is fed by one adaptive poll
 * loop. A poll that returns the same runs must not re-render the timeline, a
 * refusal must keep the last good snapshot, and the loop must stop when the
 * last listener leaves.
 *
 * 活动 source：面板的工作行由一条自适应轮询循环喂养。返回同样运行的轮询不得让时间线重渲染；
 * 被拒时必须保留上一份好快照；最后一个监听者离开时循环必须停止。
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createActivitySource } from '../src/client/activity-source.ts'
import { turnRemote } from '../src/client/turn-remote.ts'
import type { ImTurnApi, RoomActivity } from '../src/client/turn-remote.ts'

/** One live run as the host reports it. */
function runOf(overrides: Partial<RoomActivity> = {}): RoomActivity {
  return {
    runId: 'run-1',
    roomId: 'room-1',
    agentParticipantId: 'agent:default',
    phase: 'thinking',
    startedAt: 1_000,
    updatedAt: 1_000,
    ...overrides,
  }
}

/** A fake turn host whose answer the test controls. */
function fakeApi(read: () => readonly RoomActivity[]): ImTurnApi & { calls: number } {
  const api = {
    calls: 0,
    activity: async () => {
      api.calls += 1
      return { ok: true as const, value: { runs: read() } }
    },
  }
  return api as ImTurnApi & { calls: number }
}

afterEach(() => { vi.useRealTimers() })

describe('createActivitySource', () => {
  it('publishes the first read and re-renders only when a run changed', async () => {
    vi.useFakeTimers()
    let runs: readonly RoomActivity[] = [runOf()]
    const api = fakeApi(() => runs)
    const source = createActivitySource(api).source
    const renders: number[] = []
    const stop = source.subscribe(() => { renders.push(source.getSnapshot().runs.length) })
    try {
      await vi.advanceTimersByTimeAsync(0)
      expect(source.getSnapshot().runs).toHaveLength(1)
      expect(renders).toHaveLength(1)
      // The same payload again is not a change.
      // 同样的载荷再来一次不算变化。
      await vi.advanceTimersByTimeAsync(1_300)
      expect(renders).toHaveLength(1)
      // A phase change is.
      // 阶段变化才算。
      runs = [runOf({ phase: 'tool', toolName: 'bash', updatedAt: 2_000 })]
      await vi.advanceTimersByTimeAsync(1_300)
      expect(renders).toHaveLength(2)
      expect(source.getSnapshot().runs[0]).toMatchObject({ phase: 'tool', toolName: 'bash' })
    } finally {
      stop()
    }
  })

  it('keeps the last good snapshot when the host refuses the read', async () => {
    vi.useFakeTimers()
    let refuse = false
    const api: ImTurnApi & { calls: number } = {
      calls: 0,
      activity: async () => {
        api.calls += 1
        return refuse
          ? { ok: false as const, error: { code: 'NO_TURN', message: 'turn domain absent' } }
          : { ok: true as const, value: { runs: [runOf()] } }
      },
    }
    const source = createActivitySource(api).source
    const stop = source.subscribe(() => undefined)
    try {
      await vi.advanceTimersByTimeAsync(0)
      refuse = true
      await vi.advanceTimersByTimeAsync(1_300)
      expect(source.getSnapshot().runs).toHaveLength(1)
    } finally {
      stop()
    }
  })

  it('stops polling when the last listener leaves', async () => {
    vi.useFakeTimers()
    const api = fakeApi(() => [])
    const source = createActivitySource(api).source
    const stop = source.subscribe(() => undefined)
    await vi.advanceTimersByTimeAsync(0)
    const before = api.calls
    stop()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(api.calls).toBe(before)
  })

  it('polls immediately on the after-send refresh', async () => {
    vi.useFakeTimers()
    const api = fakeApi(() => [])
    const activity = createActivitySource(api)
    const stop = activity.source.subscribe(() => undefined)
    try {
      await vi.advanceTimersByTimeAsync(0)
      const before = api.calls
      activity.refresh()
      await vi.advanceTimersByTimeAsync(0)
      expect(api.calls).toBe(before + 1)
    } finally {
      stop()
    }
  })

  it('wires the activity method to the imTurnGateway service', () => {
    const methods = (turnRemote as { methods: Record<string, { service: string }> }).methods
    expect(Object.keys(methods)).toEqual(['imTurn/activity'])
    expect(methods['imTurn/activity']?.service).toBe('imTurnGateway')
  })
})
