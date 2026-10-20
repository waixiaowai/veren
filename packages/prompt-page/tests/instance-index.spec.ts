import { describe, expect, it } from 'vitest'
import { canonicalizePageUrl } from '../src/contract.ts'
import { KvPageInstanceIndex } from '../src/instance-index.ts'
import type { InstanceKvPort } from '../src/instance-index.ts'
import type { PageInstanceKey, PageInstanceRecord } from '../src/contract.ts'

/** 内存 KV：与 storageDomain 的 KvTable 同形，可重复挂新索引（模拟重启） */
function memKv(): InstanceKvPort & { readonly map: Map<string, PageInstanceRecord> } {
  const map = new Map<string, PageInstanceRecord>()
  return {
    map,
    get: (key) => map.get(key),
    put: async (key, value) => { map.set(key, value) },
    del: async (key) => map.delete(key),
    all: () => [...map.values()],
  }
}

function snapshot(overrides: Partial<Parameters<KvPageInstanceIndex['reserve']>[2]> = {}) {
  return {
    appId: 'demo',
    page: 'demo/task',
    instanceTitle: '任务 #1',
    pageRevision: 1,
    params: { id: '1' },
    appVersion: '1.0.0',
    ...overrides,
  }
}

describe('canonicalizePageUrl（§3.5.1）', () => {
  it('路径规范化：补前导斜杠、去尾斜杠、折叠空段、percent 统一', () => {
    expect(canonicalizePageUrl('/apps/demo/task/1')).toBe('/apps/demo/task/1' as PageInstanceKey)
    expect(canonicalizePageUrl('apps/demo/task/1/')).toBe('/apps/demo/task/1' as PageInstanceKey)
    expect(canonicalizePageUrl('//apps//demo//task//1')).toBe('/apps/demo/task/1' as PageInstanceKey)
    expect(canonicalizePageUrl('/apps/demo/a%20b')).toBe('/apps/demo/a%20b' as PageInstanceKey)
    expect(canonicalizePageUrl('/apps/demo/a b')).toBe('/apps/demo/a%20b' as PageInstanceKey)
  })

  it('查询串参与身份：排序、去空查询串、不同查询 = 不同实例', () => {
    expect(canonicalizePageUrl('/apps/demo/task/1?b=2&a=1'))
      .toBe('/apps/demo/task/1?a=1&b=2' as PageInstanceKey)
    expect(canonicalizePageUrl('/apps/demo/task/1?tab=diff'))
      .not.toBe(canonicalizePageUrl('/apps/demo/task/1'))
    expect(canonicalizePageUrl('/apps/demo/task/1?')).toBe('/apps/demo/task/1' as PageInstanceKey)
    expect(canonicalizePageUrl('/apps/demo/task/1?k=z&k=a'))
      .toBe('/apps/demo/task/1?k=a&k=z' as PageInstanceKey)
  })

  it('拒绝片段与空串，fail loud 带稳定码', () => {
    expect(() => canonicalizePageUrl('/apps/demo/task/1#top')).toThrow(/fragment/)
    expect(() => canonicalizePageUrl('')).toThrow(/page\/url-invalid|non-empty/)
  })
})

describe('KvPageInstanceIndex（两阶段创建 + 持久化）', () => {
  it('reserve → commit 翻 live；同一 URL 两次打开语义由 lookup 命中体现', async () => {
    const kv = memKv()
    const index = new KvPageInstanceIndex(kv)
    await index.reserve('/apps/demo/task/1' as PageInstanceKey, 's-1', snapshot())
    expect((await index.lookup('/apps/demo/task/1' as PageInstanceKey))?.state).toBe('reserved')
    const live = await index.commit('/apps/demo/task/1' as PageInstanceKey, 's-1')
    expect(live.state).toBe('live')
    expect((await index.lookup('/apps/demo/task/1' as PageInstanceKey))?.sessionId).toBe('s-1')
  })

  it('/task/1 与 /task/2 是两行；listByApp 按应用过滤', async () => {
    const kv = memKv()
    const index = new KvPageInstanceIndex(kv)
    await index.reserve('/apps/demo/task/1' as PageInstanceKey, 's-1', snapshot())
    await index.reserve('/apps/demo/task/2' as PageInstanceKey, 's-2', snapshot({ params: { id: '2' } }))
    expect(kv.map.size).toBe(2)
    expect((await index.listByApp('demo')).length).toBe(2)
    expect((await index.listByApp('other')).length).toBe(0)
  })

  it('reserve 冲突 fail loud：URL 已有行、sessionId 已被别的 URL 占用', async () => {
    const index = new KvPageInstanceIndex(memKv())
    const url = '/apps/demo/task/1' as PageInstanceKey
    await index.reserve(url, 's-1', snapshot())
    await expect(index.reserve(url, 's-2', snapshot())).rejects.toMatchObject({ code: 'page/index-conflict' })
    await expect(index.reserve('/apps/demo/task/2' as PageInstanceKey, 's-1', snapshot()))
      .rejects.toMatchObject({ code: 'page/index-conflict' })
  })

  it('commit 校验 reserved 状态与 sessionId；fail 只清 reserved 行', async () => {
    const kv = memKv()
    const index = new KvPageInstanceIndex(kv)
    const url = '/apps/demo/task/1' as PageInstanceKey
    await expect(index.commit(url, 's-9')).rejects.toMatchObject({ code: 'page/index-conflict' })
    await index.reserve(url, 's-1', snapshot())
    await expect(index.commit(url, 's-9')).rejects.toMatchObject({ code: 'page/index-conflict' })
    await index.commit(url, 's-1')
    await index.fail(url, 'late failure') // live 行不受 fail 影响
    expect(kv.map.get(url)?.state).toBe('live')
    await index.forget(url)
    expect(kv.map.has(url)).toBe(false)
  })

  it('reserved 阶段失败：fail 删行，不留幽灵索引', async () => {
    const kv = memKv()
    const index = new KvPageInstanceIndex(kv)
    const url = '/apps/demo/task/1' as PageInstanceKey
    await index.reserve(url, 's-1', snapshot())
    await index.fail(url, 'session create failed')
    expect(await index.lookup(url)).toBeUndefined()
    expect(kv.map.size).toBe(0)
  })

  it('会话被删除：lookup 探测失效并 forget，下次打开按未命中重建', async () => {
    const kv = memKv()
    const alive = new Set(['s-1'])
    const index = new KvPageInstanceIndex(kv, { sessionExists: (id) => alive.has(id) })
    const url = '/apps/demo/task/1' as PageInstanceKey
    await index.reserve(url, 's-1', snapshot())
    await index.commit(url, 's-1')
    alive.delete('s-1')
    expect(await index.lookup(url)).toBeUndefined()
    expect(kv.map.has(url)).toBe(false)
  })

  it('进程重启：同一份 KV 挂一个新索引实例，仍命中同一会话', async () => {
    const kv = memKv()
    const first = new KvPageInstanceIndex(kv)
    const url = '/apps/demo/task/1' as PageInstanceKey
    await first.reserve(url, 's-1', snapshot())
    await first.commit(url, 's-1')
    const restarted = new KvPageInstanceIndex(kv)
    const row = await restarted.lookup(url)
    expect(row?.sessionId).toBe('s-1')
    expect(row?.state).toBe('live')
  })
})
