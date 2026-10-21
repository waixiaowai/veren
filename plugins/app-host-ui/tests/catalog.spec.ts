/**
 * Catalog observable behavior: loading → ready/failed transitions, identity
 * stability, invalidation via connection resets, and listener cleanup.
 *
 * 目录可观察对象的行为：loading → ready/failed 迁移、快照身份稳定、经连接重置的
 * 失效通知、监听器清理。
 */
import { describe, expect, it } from 'vitest'
import { createAppCatalog } from '../src/client/catalog.ts'
import type { AppHostRemoteApi, AppHostResult } from '../src/client/remote.ts'

/** A scripted remote: one queued result per catalog call. */
function scriptedRemote(results: Array<AppHostResult<readonly never[]>>): { remote: AppHostRemoteApi; opens: string[] } {
  const queue = [...results]
  const opens: string[] = []
  const remote = {
    catalog: () => Promise.resolve(queue.shift() ?? { ok: true, value: [] }),
    open: async (appId: string) => {
      opens.push(appId)
      return { ok: true, value: { sessionId: 's', url: '/u', title: 't' } }
    },
  } as AppHostRemoteApi
  return { remote, opens }
}

describe('createAppCatalog', () => {
  it('starts loading, publishes ready with the catalog, and keeps the snapshot identity stable', async () => {
    const { remote } = scriptedRemote([{ ok: true, value: [{ id: 'a', name: 'A', description: 'd', state: 'active', entryUrl: '/apps/a' }] }])
    let snapshotCount = 0
    const source = createAppCatalog(remote, () => () => undefined)
    expect(source.getSnapshot().state).toBe('loading')
    await Promise.resolve()
    await Promise.resolve()
    expect(source.getSnapshot().state).toBe('ready')
    expect(source.getSnapshot().apps.map((app) => app.id)).toEqual(['a'])
    const before = source.getSnapshot()
    source.getSnapshot()
    expect(source.getSnapshot()).toBe(before)
    const unsubscribe = source.subscribe(() => { snapshotCount += 1 })
    source.refresh()
    await Promise.resolve()
    await Promise.resolve()
    expect(snapshotCount).toBe(1)
    unsubscribe()
    source.refresh()
    await Promise.resolve()
    await Promise.resolve()
    expect(snapshotCount).toBe(1)
  })

  it('publishes the structured failure verbatim and re-reads after invalidation', async () => {
    let fail = true
    const remote = {
      catalog: async () => (fail
        ? { ok: false as const, error: { code: 'app-host/gateway-failed', message: 'down' } }
        : { ok: true as const, value: [] }),
      open: async () => ({ ok: false as const, error: { code: 'x', message: 'x' } }),
    }
    const invalidations: Array<() => void> = []
    const source = createAppCatalog(remote as AppHostRemoteApi, (listener) => { invalidations.push(listener); return () => undefined })
    await Promise.resolve()
    await Promise.resolve()
    expect(source.getSnapshot()).toMatchObject({ state: 'failed', error: { code: 'app-host/gateway-failed' } })
    fail = false
    for (const invalidate of invalidations) invalidate()
    await Promise.resolve()
    await Promise.resolve()
    expect(source.getSnapshot().state).toBe('ready')
  })
})
