/**
 * The panel catalog's read lifecycle.
 *
 * The page has exactly one authority: the catalog observable. These specs pin
 * its externally visible rules — one shared read, invalidation on a Host
 * change or transport reset, error state that keeps the last good records, and
 * a last-unsubscribe teardown that discards a read which resolves afterwards.
 *
 * 面板目录的读取生命周期。
 *
 * 页面只有一个权威来源：目录可观察对象。这些测试钉住它对外可见的规则——共享的一次
 * 读取、宿主变更或连接重置时失效重读、失败时保留上一次成功记录，以及最后一个订阅
 * 取消后丢弃迟到读取的拆卸行为。
 */

import { describe, expect, it, vi } from 'vitest'
import { createStartupCatalog } from '../src/client/catalog.ts'
import type { StartupCatalogDeps } from '../src/client/catalog.ts'
import type { StartupItemView, StartupRemoteResult } from '../src/client/remote.ts'

/** One item as the Host would report it. 一条宿主会返回的启动项。 */
function item(over: Partial<StartupItemView> = {}): StartupItemView {
  return {
    id: 's1',
    name: 'Daily digest',
    enabled: true,
    action: 'new_session',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    runCount: 0,
    ...over,
  }
}

/** A successful Remote result. 一个成功的远端结果。 */
function ok<T>(value: T): StartupRemoteResult<T> {
  return { ok: true, value }
}

/** A failed Remote result. 一个失败的远端结果。 */
function failure(message: string): StartupRemoteResult<never> {
  return { ok: false, error: { code: 'startup/storage-failed', message } }
}

/** Let queued microtasks and the read's promise chain settle. 让排队的微任务与读取链落定。 */
function flush(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}

/** A catalog whose Remote read and invalidation sources the test drives. 由测试驱动远端读取与失效来源的目录。 */
function bench(list: StartupCatalogDeps['list']) {
  const changed = new Set<() => void>()
  const reset = new Set<() => void>()
  const disposeChanged = vi.fn()
  const disposeReset = vi.fn()
  const deps: StartupCatalogDeps = {
    list,
    subscribeChanged(listener) {
      changed.add(listener)
      return () => {
        changed.delete(listener)
        disposeChanged()
      }
    },
    subscribeReset(listener) {
      reset.add(listener)
      return () => {
        reset.delete(listener)
        disposeReset()
      }
    },
  }
  return {
    deps,
    catalog: createStartupCatalog(deps),
    emitChanged(): void { for (const listener of [...changed]) listener() },
    emitReset(): void { for (const listener of [...reset]) listener() },
    changedSubscribers: () => changed.size,
    resetSubscribers: () => reset.size,
    disposeChanged,
    disposeReset,
  }
}

describe('startup catalog / 启动项目录', () => {
  it('reads once on the first subscriber and publishes the records', async () => {
    const list = vi.fn(async () => ok([item()]))
    const { catalog } = bench(list)
    const seen: string[] = []
    const off = catalog.source.subscribe(() => seen.push(catalog.source.getSnapshot().status))

    // The loading republish is synchronous, so the first notification already sees it.
    // loading 是同步发布的，首个通知就能看到它。
    expect(seen).toEqual(['loading'])
    await flush()

    expect(list).toHaveBeenCalledTimes(1)
    expect(catalog.source.getSnapshot()).toMatchObject({ status: 'ready', settled: true, records: [item()] })
    expect(seen).toEqual(['loading', 'ready'])
    off()
  })

  it('shares one in-flight read between subscribers of the same mount', async () => {
    const list = vi.fn(async () => ok([item()]))
    const { catalog } = bench(list)
    const first = vi.fn()
    const second = vi.fn()
    const offFirst = catalog.source.subscribe(first)
    const offSecond = catalog.source.subscribe(second)

    await flush()

    expect(list).toHaveBeenCalledTimes(1)
    expect(first).toHaveBeenCalledTimes(2)
    expect(second).toHaveBeenCalledTimes(1)
    expect(catalog.source.getSnapshot().records).toEqual([item()])
    offFirst()
    offSecond()
  })

  it('keeps the snapshot reference until a fact moves', async () => {
    const list = vi.fn(async () => ok([item()]))
    const { catalog } = bench(list)
    const off = catalog.source.subscribe(() => {})
    await flush()

    const settled = catalog.source.getSnapshot()
    const offSecond = catalog.source.subscribe(() => {})

    // A second subscriber alone is not a fact change. 仅多一个订阅者不算事实变化。
    expect(catalog.source.getSnapshot()).toBe(settled)
    offSecond()
    off()
  })

  it('re-reads after a Host change and after a transport reset', async () => {
    const list = vi.fn()
      .mockResolvedValueOnce(ok([item({ name: 'first' })]))
      .mockResolvedValueOnce(ok([item({ name: 'second' })]))
      .mockResolvedValueOnce(ok([item({ name: 'third' })]))
    const { catalog, emitChanged, emitReset } = bench(list)
    const off = catalog.source.subscribe(() => {})
    await flush()

    emitChanged()
    await flush()
    expect(catalog.source.getSnapshot().records.map(record => record.name)).toEqual(['second'])

    emitReset()
    await flush()
    expect(catalog.source.getSnapshot().records.map(record => record.name)).toEqual(['third'])
    expect(list).toHaveBeenCalledTimes(3)
    off()
  })

  it('reports a failed read without dropping the last good records', async () => {
    const list = vi.fn()
      .mockResolvedValueOnce(ok([item()]))
      .mockResolvedValueOnce(failure('storage unavailable'))
    const { catalog, emitChanged } = bench(list)
    const off = catalog.source.subscribe(() => {})
    await flush()

    emitChanged()
    await flush()

    expect(catalog.source.getSnapshot()).toMatchObject({ status: 'error', settled: true, records: [item()] })
    off()
  })

  it('treats a rejected read as an error rather than an unhandled rejection', async () => {
    const list = vi.fn().mockRejectedValue(new Error('connection lost'))
    const { catalog } = bench(list)
    const off = catalog.source.subscribe(() => {})
    await flush()

    expect(catalog.source.getSnapshot()).toMatchObject({ status: 'error', settled: false, records: [] })
    off()
  })

  it('discards a read that resolves after the last subscriber left', async () => {
    let resolveRead: (value: StartupRemoteResult<readonly StartupItemView[]>) => void = () => {}
    const list = vi.fn(() => new Promise<StartupRemoteResult<readonly StartupItemView[]>>((resolve) => {
      resolveRead = resolve
    }))
    const { catalog } = bench(list)
    const listener = vi.fn()
    const off = catalog.source.subscribe(listener)
    off()

    resolveRead(ok([item()]))
    await flush()

    // The teardown reset wins over the late read: a closed panel cannot publish.
    // 拆卸时的重置胜过迟到读取：关闭的面板不能发布。
    expect(catalog.source.getSnapshot()).toEqual({ records: [], status: 'loading', settled: false })
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('releases both invalidation subscriptions with the last unsubscribe', async () => {
    const list = vi.fn(async () => ok([item()]))
    const { catalog, changedSubscribers, resetSubscribers, disposeChanged, disposeReset } = bench(list)
    const offFirst = catalog.source.subscribe(() => {})
    const offSecond = catalog.source.subscribe(() => {})
    await flush()

    offFirst()
    expect(changedSubscribers()).toBe(1)
    expect(resetSubscribers()).toBe(1)
    expect(disposeChanged).not.toHaveBeenCalled()

    offSecond()
    expect(changedSubscribers()).toBe(0)
    expect(resetSubscribers()).toBe(0)
    expect(disposeChanged).toHaveBeenCalledTimes(1)
    expect(disposeReset).toHaveBeenCalledTimes(1)
  })

  it('re-reads on the retry affordance', async () => {
    const list = vi.fn()
      .mockResolvedValueOnce(failure('down'))
      .mockResolvedValueOnce(ok([item()]))
    const { catalog } = bench(list)
    const off = catalog.source.subscribe(() => {})
    await flush()
    expect(catalog.source.getSnapshot().status).toBe('error')

    catalog.refresh()
    await flush()

    expect(list).toHaveBeenCalledTimes(2)
    expect(catalog.source.getSnapshot()).toMatchObject({ status: 'ready', settled: true, records: [item()] })
    off()
  })
})
