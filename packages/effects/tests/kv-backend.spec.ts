/**
 * The key/value adapter: binding correctness against the real DSH surface.
 *
 * `EffectKvTable` is a structural subset of `KvTable<string, EffectRow>` from
 * `@deepseek-ai/dsh-storage-domain` — the host storage API task-center and im
 * actually persist through. The fake below implements the FULL real
 * `KvTable` interface, so if the DSH type surface drifts, this file stops
 * compiling: the adapter can never silently invent a facade.
 *
 * 键值适配器：对着真实 DSH 面验证绑定正确性。`EffectKvTable` 是
 * `@deepseek-ai/dsh-storage-domain` 的 `KvTable<string, EffectRow>` 的结构子集——即
 * task-center 与 im 实际持久化所用的宿主存储 API。下面的 fake 实现了完整的真实
 * `KvTable` 接口，DSH 类型面一漂移本文件就编译不过：适配器永远无法悄悄发明门面。
 */

import { expect, it, vi } from 'vitest'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import { Effects, effectRowKey, kvEffectStorage } from '../src/index.ts'
import type { EffectRow } from '../src/index.ts'
import { fakeClock } from './helpers.ts'

/** In-memory stand-in implementing the FULL real DSH `KvTable` interface. */
class FakeKvTable implements KvTable<string, EffectRow> {
  readonly #rows = new Map<string, EffectRow>()

  get(key: string): EffectRow | undefined {
    return this.#rows.get(key)
  }

  entries(): IterableIterator<[string, EffectRow]> {
    return this.#rows.entries()
  }

  keys(): IterableIterator<string> {
    return this.#rows.keys()
  }

  get size(): number {
    return this.#rows.size
  }

  async put(key: string, value: EffectRow): Promise<void> {
    this.#rows.set(key, value)
  }

  async delete(key: string): Promise<boolean> {
    return this.#rows.delete(key)
  }

  async update(key: string, fn: (current: EffectRow) => EffectRow): Promise<EffectRow> {
    const current = this.#rows.get(key)
    if (current === undefined) throw new Error('missing-key')
    const next = fn(current)
    this.#rows.set(key, next)
    return next
  }
}

type RelayEffects = Effects<{ relay: { text: string }; launch: { ticketId: string } }>

async function openQueue(): Promise<{ effects: RelayEffects; table: FakeKvTable }> {
  const table = new FakeKvTable()
  return { effects: await Effects.open(kvEffectStorage(table), { now: fakeClock().now }), table }
}

it('stores rows under the composite kind+key, isolated between kinds', async () => {
  const { effects, table } = await openQueue()
  effects.start()
  // limit 0 持住所有行，行才留在介质上供检查 / limit 0 holds every row, so rows stay on the medium for inspection
  effects.handle('relay', async () => {}, { limit: () => 0 })
  effects.handle('launch', async () => {}, { limit: () => 0 })
  await effects.enqueue('relay', 'k', { text: 'a' })
  await effects.enqueue('launch', 'k', { ticketId: 't' })
  await effects.enqueue('relay', 'k2', { text: 'b' })
  await effects.enqueue('launch', 'k2', { ticketId: 't2' })
  expect(table.get(effectRowKey('relay', 'k2'))).toMatchObject({ kind: 'relay', key: 'k2', seq: 3 })
  expect(table.get(effectRowKey('launch', 'k2'))).toMatchObject({ kind: 'launch', key: 'k2', seq: 4 })
  expect(table.size).toBe(4)
  await effects.cancel('relay', 'k2')
  expect(table.get(effectRowKey('relay', 'k2'))).toBeUndefined()
  expect(table.get(effectRowKey('launch', 'k2'))).toBeDefined()
})

it('resumes a queue over the same kv medium after a restart', async () => {
  const clock = fakeClock()
  const table = new FakeKvTable()
  const killer: RelayEffects = await Effects.open(kvEffectStorage(table), { now: clock.now })
  killer.start()
  const run = vi.fn(async () => {})
  killer.handle('relay', run)
  await killer.enqueue('relay', 'k', { text: 'a' })
  await vi.waitFor(() => expect(run).toHaveBeenCalledOnce())

  // 同一介质上重开：行已清空，新队列照常工作 / reopen over the same medium: rows cleared, the new queue works
  const revived: RelayEffects = await Effects.open(kvEffectStorage(table), { now: clock.now })
  revived.start()
  const next = vi.fn(async () => {})
  revived.handle('relay', next)
  await revived.enqueue('relay', 'fresh', { text: 'b' })
  await revived.idle()
  expect(next).toHaveBeenCalledOnce()
  expect(revived.pending('relay')).toBe(false)
})

it('keeps a pending row through the restart over the kv medium', async () => {
  const clock = fakeClock()
  const table = new FakeKvTable()
  const killer: RelayEffects = await Effects.open(kvEffectStorage(table), { now: clock.now })
  // 未 start、未 handle：行只入队（官方语义：start 前的行等待）/ not started, no handler: rows just queue (official rule)
  await killer.enqueue('relay', 'waiting', { text: 'a' })
  expect(table.get(effectRowKey('relay', 'waiting'))).toBeDefined()

  const revived: RelayEffects = await Effects.open(kvEffectStorage(table), { now: clock.now })
  const run = vi.fn(async () => {})
  revived.start()
  revived.handle('relay', run)
  await revived.idle()
  expect(run).toHaveBeenCalledWith({ text: 'a' }, 'waiting')
  expect(table.get(effectRowKey('relay', 'waiting'))).toBeUndefined()
})
