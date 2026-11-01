/**
 * The effect queue's semantics over the memory backend: enqueue/run/clear,
 * kind+key coalescing, per-kind concurrency limits, exponential backoff with
 * the health threshold, `Later` deferrals, ordered kinds, cancel, queue-level
 * health, and drain. Each case mirrors one official `tests/effects.spec.ts`
 * behavior (MIT reference) on the ported core.
 *
 * 内存后端上的效果队列语义：入队/执行/清除、kind+key 合并、每类并发上限、指数退避与
 * 健康阈值、`Later` 暂缓、ordered 类型、取消、队列级健康与 drain。每条用例对应官方
 * `tests/effects.spec.ts`（MIT 参照）的一条行为，跑在移植后的核上。
 */

import { expect, it, vi } from 'vitest'
import { Effects, Later } from '../src/index.ts'
import { MemoryEffectStorage } from '../src/index.ts'
import type { EffectsOptions } from '../src/index.ts'
import { deferred, fakeClock, recordingHealth } from './helpers.ts'

/** Every case gets a fresh medium and queue; `start` happens where the case needs it. */
async function openQueue(options: EffectsOptions = {}): Promise<{ effects: Effects<{ relay: { text: string }; launch: { ticketId: string }; notice: { text: string }; delivery: { ticketId: string } }>; storage: MemoryEffectStorage }> {
  const storage = new MemoryEffectStorage()
  return { effects: await Effects.open(storage, options), storage }
}

it('runs a queued effect once, with its payload and key, then clears the row', async () => {
  const { effects } = await openQueue()
  const run = vi.fn(async (_payload: { text: string }, _key: string) => {})
  effects.start()
  effects.handle('relay', run)
  await effects.enqueue('relay', 'a', { text: 'hi' })
  await effects.idle()
  expect(run).toHaveBeenCalledTimes(1)
  expect(run).toHaveBeenCalledWith({ text: 'hi' }, 'a')
  expect(effects.pending('relay')).toBe(false)
  expect(effects.pending('relay', 'a')).toBe(false)
})

it('runs nothing before start, and the queued rows after it', async () => {
  const { effects } = await openQueue()
  const run = vi.fn(async (_payload: { text: string }, _key: string) => {})
  await effects.enqueue('relay', 'a', { text: 'early' })
  effects.handle('relay', run)
  await effects.idle()
  expect(run).not.toHaveBeenCalled()
  expect(effects.pending('relay')).toBe(true)
  effects.start()
  await effects.idle()
  expect(run).toHaveBeenCalledOnce()
  expect(effects.pending('relay')).toBe(false)
})

it('runs a row again with the latest payload when re-queued while it runs', async () => {
  const { effects } = await openQueue()
  const hold = deferred()
  const run = vi.fn(async (payload: { text: string }) => {
    if (payload.text === 'first') await hold.promise
  })
  effects.start()
  effects.handle('relay', run)
  await effects.enqueue('relay', 'k', { text: 'first' })
  await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1))
  await effects.enqueue('relay', 'k', { text: 'second' })
  await effects.enqueue('relay', 'k', { text: 'third' })
  hold.resolve()
  await effects.idle()
  expect(run.mock.calls.map(call => (call[0] as { text: string }).text)).toEqual(['first', 'third'])
  expect(effects.pending('relay')).toBe(false)
})

it('keeps a coalesced row at its queue position and runs the newest payload', async () => {
  const { effects } = await openQueue()
  let room = 0
  const run = vi.fn(async (_payload: { ticketId: string }, _key: string) => {})
  effects.start()
  effects.handle('launch', run, { limit: () => room })
  await effects.enqueue('launch', 'first', { ticketId: 't1' })
  await effects.enqueue('launch', 'second', { ticketId: 't2' })
  await effects.enqueue('launch', 'first', { ticketId: 't1-again' })
  await effects.idle()
  expect(run).not.toHaveBeenCalled()
  room = 1
  await effects.idle()
  expect(run.mock.calls.map(call => call[1])).toEqual(['first', 'second'])
  expect(run.mock.calls[0]?.[0]).toEqual({ ticketId: 't1-again' })
})

it('runs a kind oldest first, as many at once as its limit allows, and holds it at 0', async () => {
  const { effects } = await openQueue()
  const holds = new Map<string, ReturnType<typeof deferred>>()
  let limit = 2
  const run = vi.fn(async (_payload: { ticketId: string }, key: string) => {
    const hold = deferred()
    holds.set(key, hold)
    await hold.promise
  })
  effects.start()
  effects.handle('launch', run, { limit: () => limit })
  for (const key of ['a', 'b', 'c']) await effects.enqueue('launch', key, { ticketId: key })
  await vi.waitFor(() => expect(run.mock.calls.map(call => call[1])).toEqual(['a', 'b']))
  limit = 0
  holds.get('a')?.resolve()
  await vi.waitFor(() => expect(effects.pending('launch', 'a')).toBe(false))
  // 不能用 idle()：b 还被持着，idle 会等它；官方同位置用一次微任务派发。
  // / idle() would block on the still-held b; the official test dispatches once via a microtask here.
  effects.kick()
  await Promise.resolve()
  expect(run).toHaveBeenCalledTimes(2)
  limit = 2
  holds.get('b')?.resolve()
  await vi.waitFor(() => expect(run.mock.calls.map(call => call[1])).toEqual(['a', 'b', 'c']))
  holds.get('c')?.resolve()
  await effects.idle()
  expect(effects.pending('launch')).toBe(false)
})

it('does not query the limit while nothing is ready', async () => {
  const { effects } = await openQueue()
  const limit = vi.fn(() => 1)
  effects.start()
  effects.handle('relay', async () => {}, { limit })
  effects.kick()
  await effects.idle()
  expect(limit).not.toHaveBeenCalled()
})

it('retries with doubling backoff capped at the maximum, and errors health after three consecutive failures', async () => {
  const clock = fakeClock()
  const health = recordingHealth()
  const { effects } = await openQueue({ now: clock.now, health })
  let fail = true
  const run = vi.fn(async () => {
    if (fail) throw new Error('session busy')
  })
  effects.start()
  effects.handle('notice', run, { retry: [1000, 3000] })
  await effects.enqueue('notice', 'prompts', { text: 'saved' })
  await effects.idle()
  expect(health.latest('notice')).toMatchObject({ state: 'ready', detail: '1 waiting' })
  for (const wait of [1000, 2000, 3000, 3000]) {
    clock.advance(wait - 1)
    await effects.idle()
    const calls = run.mock.calls.length
    clock.advance(1)
    await effects.idle()
    expect(run).toHaveBeenCalledTimes(calls + 1)
    if (wait === 2000) {
      expect(health.latest('notice')).toMatchObject({ state: 'error', detail: expect.stringContaining('the last failure: Error: session busy') })
    }
  }
  fail = false
  clock.advance(3000)
  await effects.idle()
  expect(health.latest('notice')).toMatchObject({ state: 'ready', detail: 'Nothing waiting' })
  expect(effects.pending('notice')).toBe(false)
})

it('defers a Later throw without counting a failure, until a dispatch after its first delay', async () => {
  const clock = fakeClock()
  const health = recordingHealth()
  const { effects } = await openQueue({ now: clock.now, health })
  let later = true
  const run = vi.fn(async () => {
    if (later) throw new Later('paused')
  })
  effects.start()
  effects.handle('launch', run, { retry: [5000, 60_000] })
  await effects.enqueue('launch', 'a', { ticketId: 't' })
  await effects.idle()
  expect(run).toHaveBeenCalledOnce()
  expect(health.latest('launch')).toMatchObject({ state: 'ready', detail: '1 waiting' })
  later = false
  clock.advance(4999)
  await effects.idle()
  expect(run).toHaveBeenCalledOnce()
  clock.advance(1)
  await effects.idle()
  expect(run).toHaveBeenCalledTimes(2)
  expect(effects.pending('launch')).toBe(false)
})

it('runs an ordered kind one at a time in queue order, and holds later rows behind a failure', async () => {
  const clock = fakeClock()
  const { effects } = await openQueue({ now: clock.now })
  const failing = new Set(['first'])
  const run = vi.fn(async (_payload: { text: string }, key: string) => {
    if (failing.has(key)) throw new Error('offline')
  })
  effects.start()
  effects.handle('relay', run, { ordered: true, limit: () => 4, retry: [1000, 1000] })
  await effects.enqueue('relay', 'first', { text: 'a' })
  await effects.enqueue('relay', 'second', { text: 'b' })
  await effects.idle()
  expect(run.mock.calls.map(call => call[1])).toEqual(['first'])
  clock.advance(1000)
  await effects.idle()
  expect(run.mock.calls.map(call => call[1])).toEqual(['first', 'first'])
  failing.clear()
  clock.advance(1000)
  await effects.idle()
  expect(run.mock.calls.map(call => call[1])).toEqual(['first', 'first', 'first', 'second'])
  expect(effects.pending('relay')).toBe(false)
})

it('keeps a quiet kind out of the error state however often it fails', async () => {
  const clock = fakeClock()
  const health = recordingHealth()
  const { effects } = await openQueue({ now: clock.now, health })
  const run = vi.fn(async () => {
    throw new Error('Session gone')
  })
  effects.start()
  effects.handle('delivery', run, { quiet: true, retry: [1000, 1000] })
  await effects.enqueue('delivery', 't', { ticketId: 't' })
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await effects.idle()
    clock.advance(1000)
  }
  expect(health.latest('delivery')).toMatchObject({ state: 'ready', detail: '1 waiting' })
})

it('keeps an effect cancelled and queued again while its first run goes on, which the first run does not end', async () => {
  const { effects } = await openQueue()
  const hold = deferred()
  const run = vi.fn(async (payload: { text: string }) => {
    if (run.mock.calls.length === 1) await hold.promise
  })
  effects.start()
  effects.handle('relay', run)
  await effects.enqueue('relay', 'k', { text: 'first' })
  await vi.waitFor(() => expect(run).toHaveBeenCalledOnce())
  await effects.cancel('relay', 'k')
  await effects.enqueue('relay', 'k', { text: 'second' })
  hold.resolve()
  await effects.idle()
  expect(run.mock.calls.map(call => (call[0] as { text: string }).text)).toEqual(['first', 'second'])
  expect(effects.pending('relay')).toBe(false)
})

it('refuses a second handler for a kind', async () => {
  const { effects } = await openQueue()
  effects.handle('relay', async () => {})
  expect(() => effects.handle('relay', async () => {})).toThrow('The relay effects already have a handler')
})

it('reports a queue-level failure under its kind until a dispatch of that kind succeeds again', async () => {
  const clock = fakeClock()
  const health = recordingHealth()
  const { effects } = await openQueue({ now: clock.now, health })
  let broken = true
  effects.start()
  effects.handle('relay', async () => {}, {
    limit: () => {
      if (broken) throw new Error('database is locked')
      return 1
    },
  })
  await effects.enqueue('relay', 'k', { text: 'a' })
  await effects.idle()
  expect(health.latest('relay')).toMatchObject({ state: 'error', detail: 'The effect queue failed: Error: database is locked' })
  broken = false
  await effects.idle()
  expect(health.latest('relay')).toMatchObject({ state: 'ready' })
  expect(effects.pending('relay')).toBe(false)
})

it('stops starting effects once drained, keeps what waits, and hands it to the next start', async () => {
  const clock = fakeClock()
  const { effects, storage } = await openQueue({ now: clock.now })
  const hold = deferred()
  effects.start()
  effects.handle('relay', async () => {
    await hold.promise
    throw new Error('aborted')
  })
  await effects.enqueue('relay', 'cut', { text: 'a' })
  await vi.waitFor(() => expect(effects.pending('relay', 'cut')).toBe(true))
  const drained = effects.drain()
  await effects.enqueue('relay', 'later', { text: 'b' })
  hold.resolve()
  await drained
  const run = vi.fn(async (_payload: { text: string }, _key: string) => {})
  const next = await Effects.open<{ relay: { text: string } }>(storage, { now: clock.now })
  next.start()
  next.handle('relay', run)
  await next.idle()
  expect(run.mock.calls.map(call => call[1])).toEqual(['cut', 'later'])
  expect(next.pending('relay')).toBe(false)
})
