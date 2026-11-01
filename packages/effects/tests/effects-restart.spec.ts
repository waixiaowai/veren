/**
 * 死刑测试：进程杀死后重启（kill-and-restart）。
 * Death tests: the process is killed and comes back.
 *
 * 不丢——被杀进程没写回的行还在介质上，重启后被接手执行；
 * 不重——已写回（完成/删除）的行不会重跑；一次尝试至多被接手一次；
 * 不乱序——恢复的行按 `seq` 次序执行，重启后新入队的行排在它们后面。
 * Not lost — rows the killed process never wrote back stay on the medium and
 * are taken over after the restart; not duplicated — rows already written
 * back (completed/deleted) never run again; in order — resumed rows run by
 * `seq`, and rows enqueued after the restart sort behind them.
 *
 * 介质用 `MemoryEffectStorage`：实例活得比 `Effects` 久，等价于"进程死了、盘还在"。
 * 时钟为确定性注入（官方 Effects 构造器的 `now` 参数照抄），不依赖任何真实定时器。
 * The medium is `MemoryEffectStorage`: the instance outlives its `Effects`,
 * which is exactly "process died, disk remains". The clock is injected
 * deterministically (the official Effects constructor's `now` parameter),
 * with no reliance on real timers.
 */

import { expect, it, vi } from 'vitest'
import { Effects } from '../src/index.ts'
import { MemoryEffectStorage } from '../src/index.ts'
import { deferred, fakeClock } from './helpers.ts'

type RelayEffects = Effects<{ relay: { text: string }; notice: { text: string } }>

it('a row killed mid-flight is not lost, runs exactly once after the restart, and a completed row stays gone', async () => {
  const clock = fakeClock()
  const storage = new MemoryEffectStorage()
  const killer: RelayEffects = await Effects.open(storage, { now: clock.now })
  killer.start()
  // held 行跑到一半进程被杀；held 的 promise 永不放行，模拟进程连同其内存一起消失。
  // / the held row is mid-flight when the process dies; its promise never
  // resolves, standing in for the process memory vanishing with it.
  const hold = deferred()
  // 并发放宽：held 行持住时 done 行要能跑完（默认 limit 1 会把它挡在后面）。
  // / widen the limit: done must complete while held is stuck (a default limit of 1 would gate it).
  killer.handle('relay', async (_payload, key) => {
    if (key === 'held') await hold.promise
  }, { limit: () => 4 })
  await killer.enqueue('relay', 'held', { text: 'interrupted' })
  await killer.enqueue('relay', 'done', { text: 'finished' })
  await vi.waitFor(() => expect(killer.pending('relay', 'done')).toBe(false))

  // 重启：同一介质上新开队列（不 drain、不清理）/ the restart: a fresh queue over the same medium, no drain, no cleanup
  const run = vi.fn(async (_payload: { text: string }, _key: string) => {})
  const revived: RelayEffects = await Effects.open(storage, { now: clock.now })
  revived.start()
  revived.handle('relay', run)
  await revived.idle()

  expect(run.mock.calls.map(call => call[1])).toEqual(['held'])
  expect(run).toHaveBeenCalledTimes(1)
  expect(revived.pending('relay')).toBe(false)
  expect(storage.list('relay')).toHaveLength(0)
})

it('an ordered kind resumes in queue order without re-running completed rows', async () => {
  const clock = fakeClock()
  const storage = new MemoryEffectStorage()
  const killer: RelayEffects = await Effects.open(storage, { now: clock.now })
  killer.start()
  const hold = deferred()
  killer.handle('relay', async () => {
    await hold.promise
  }, { ordered: true })
  await killer.enqueue('relay', 'a', { text: '1' })
  await killer.enqueue('relay', 'b', { text: '2' })
  await vi.waitFor(() => expect(killer.pending('relay', 'a')).toBe(true))

  const run = vi.fn(async (_payload: { text: string }, _key: string) => {})
  const revived: RelayEffects = await Effects.open(storage, { now: clock.now })
  revived.handle('relay', run, { ordered: true })
  revived.start()
  await revived.idle()

  expect(run.mock.calls.map(call => call[1])).toEqual(['a', 'b'])
  expect(revived.pending('relay')).toBe(false)
})

it('rows enqueued after the restart run behind the ones that waited, and seq continues monotonically', async () => {
  const clock = fakeClock()
  const storage = new MemoryEffectStorage()
  const killer: RelayEffects = await Effects.open(storage, { now: clock.now })
  killer.start()
  const hold = deferred()
  killer.handle('relay', async () => {
    await hold.promise
  }, { ordered: true })
  await killer.enqueue('relay', 'first', { text: 'a' })
  await killer.enqueue('relay', 'second', { text: 'b' })
  await vi.waitFor(() => expect(killer.pending('relay', 'first')).toBe(true))

  const revived: RelayEffects = await Effects.open(storage, { now: clock.now })
  await revived.enqueue('relay', 'third', { text: 'c' })
  const run = vi.fn(async (_payload: { text: string }, _key: string) => {})
  revived.handle('relay', run, { ordered: true })
  revived.start()
  await revived.idle()

  expect(run.mock.calls.map(call => call[1])).toEqual(['first', 'second', 'third'])
})

it('backoff state survives the kill, so a failing row does not restart its ladder', async () => {
  const clock = fakeClock()
  const storage = new MemoryEffectStorage()
  const killer: RelayEffects = await Effects.open(storage, { now: clock.now })
  killer.start()
  let fail = true
  killer.handle('notice', async () => {
    if (fail) throw new Error('boom')
  }, { retry: [1000, 4000] })
  await killer.enqueue('notice', 'k', { text: 'n' })
  await killer.idle()
  clock.advance(1000)
  await killer.idle()

  // 杀死时已连续失败 2 次（attempts=2，下次退避 4s）/ two consecutive failures at kill time (attempts=2, next backoff 4s)
  const revived: RelayEffects = await Effects.open(storage, { now: clock.now })
  const run = vi.fn(async () => {
    if (fail) throw new Error('boom')
  })
  revived.handle('notice', run, { retry: [1000, 4000] })
  revived.start()
  clock.advance(1999)
  await revived.idle()
  expect(run).not.toHaveBeenCalled()
  clock.advance(1)
  await revived.idle()
  expect(run).toHaveBeenCalledTimes(1)
  expect(storage.list('notice')[0]?.attempts).toBe(3)

  fail = false
  clock.advance(4000)
  await revived.idle()
  expect(revived.pending('notice')).toBe(false)
})
