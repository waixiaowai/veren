/**
 * The box graph face's properties: the resolution join (dangling targets and
 * self-edges never surface), owner isolation, the derived aging (no schema, no
 * timer — a read that changes nothing), and the config clamp. The executable
 * half of docs/notebook-canvas-expiry-task.cn.md §3 D5/D3.
 *
 * 盒图面的性质：解析连接（悬空目标与自环绝不出现）、归属隔离、派生老化（不是
 * schema、不是定时器——读了什么都不改）、以及配置钳制。即
 * docs/notebook-canvas-expiry-task.cn.md §3 D5/D3 的可执行一半。
 */

import { describe, expect, it } from 'vitest'
import { boxGraphView } from '../src/boxgraph.ts'
import { clampWindowDays } from '../src/index.ts'
import { applyCardCreate } from '../src/cards.ts'
import { applyCardCapture, applyCardPromote } from '../src/lifecycle.ts'
import { syncLinks } from '../src/graph.ts'
import { NotebookError } from '../src/notes.ts'
import type { CardTables } from '../src/cards.ts'
import type { NotebookTable } from '../src/storage.ts'
import type { LedgerRecord, LinkRecord, NoteRecord } from '../src/types.ts'

/** An in-memory stand-in for one domain table. 单张域表的内存替身。 */
function memoryTable<T>(): NotebookTable<T> {
  const rows = new Map<string, T>()
  return {
    get: key => rows.get(key),
    put: async (key, value) => { rows.set(key, value) },
    del: async key => rows.delete(key),
    all: () => [...rows.values()],
  }
}

/** One fresh trio of tables per test. 每条用例一组全新的三张表。 */
function tables(): CardTables {
  return { notes: memoryTable<NoteRecord>(), links: memoryTable<LinkRecord>(), ledger: memoryTable<LedgerRecord>() }
}

/** The clock every write in one test shares. 单条用例内所有写共用的时钟。 */
const NOW = '2026-11-02T00:00:00.000Z'

/** Two days and a bit after NOW — past the default intake window. NOW 两天多之后——过了默认进料窗。 */
const OVERDUE = '2026-11-04T13:00:00.000Z'

/** Two days and a bit after OVERDUE — a read clock that separates the 2-day and 3-day windows. OVERDUE 两天多之后——能把两天窗与三天窗分开的读数时钟。 */
const LATER = '2026-11-06T13:30:00.000Z'

/** The graph face read at a fixed clock, so aging asserts are exact. 固定时钟上读图面，老化断言因此精确。 */
function face(box: CardTables, owner: string, nowMs = Date.parse(NOW), days = 2) {
  return boxGraphView(box.notes, box.links, box.ledger, owner, nowMs, days)
}

describe('box graph — the resolution join / 盒图——解析连接', () => {
  it('resolves cache rows into id edges and counts both directions', async () => {
    const box = tables()
    await applyCardCreate(box, 'ada', { title: '地址即主题', body: '一张说地址的卡' }, NOW, 'a1')
    const b = await applyCardCreate(box, 'ada', { title: '标题是链接地址', body: '被 [[地址即主题]] 引用' }, NOW, 'a2')
    await syncLinks(box.links, 'ada', b.id, b.body)
    const view = face(box, 'ada')
    expect(view.edges).toEqual([{ sourceId: 'a2', targetId: 'a1' }])
    const byId = new Map(view.nodes.map(node => [node.id, node]))
    expect(byId.get('a1')?.inbound).toBe(1)
    expect(byId.get('a1')?.outbound).toBe(0)
    expect(byId.get('a2')?.outbound).toBe(1)
    expect(byId.get('a2')?.inbound).toBe(0)
  })

  it('never surfaces a dangling target or a self-edge', async () => {
    const box = tables()
    await applyCardCreate(box, 'ada', { title: '自环卡', body: 'x' }, NOW, 's1')
    await applyCardCreate(box, 'ada', { title: '悬空目标卡', body: 'x' }, NOW, 's2')
    // Legacy rows written straight into the cache: one resolves to nothing, one is a self-edge.
    // 直接写进缓存的遗留行：一条解析不到目标，一条是自环。
    await box.links.put('ada/s1/自环卡', { owner: 'ada', sourceId: 's1', targetTitle: '自环卡' })
    await box.links.put('ada/s2/不存在的标题', { owner: 'ada', sourceId: 's2', targetTitle: '不存在的标题' })
    const view = face(box, 'ada')
    expect(view.edges).toEqual([])
    for (const node of view.nodes) {
      expect(node.inbound).toBe(0)
      expect(node.outbound).toBe(0)
    }
  })

  it('keeps owners isolated: one box never sees another box edges or counts', async () => {
    const box = tables()
    await applyCardCreate(box, 'ada', { title: '共享标题', body: 'ada 的卡' }, NOW, 'a1')
    await applyCardCreate(box, 'bob', { title: '共享标题', body: 'bob 的卡' }, NOW, 'b1')
    await applyCardCreate(box, 'bob', { title: 'bob 引用卡', body: '见 [[共享标题]]' }, NOW, 'b2')
    await syncLinks(box.links, 'bob', 'b2', '见 [[共享标题]]')
    const adaView = face(box, 'ada')
    expect(adaView.edges).toEqual([])
    expect(adaView.nodes.map(node => node.id)).toEqual(['a1'])
    expect(adaView.nodes[0]?.inbound).toBe(0)
    const bobView = face(box, 'bob')
    const b1 = box.notes.all().find(row => row.owner === 'bob' && row.title === '共享标题')!.id
    expect(bobView.edges).toEqual([{ sourceId: 'b2', targetId: b1 }])
  })
})

describe('box graph — the derived aging / 盒图——派生老化', () => {
  it('marks fleeting cards fresh or overdue and derives the deadline, touching nothing', async () => {
    const box = tables()
    await applyCardCreate(box, 'ada', { title: '永久卡', body: 'x' }, NOW, 'p1')
    await applyCardCapture(box, 'ada', { body: '新鲜闪念' }, NOW, 'f1')
    const staleBox = tables()
    await applyCardCapture(staleBox, 'ada', { body: '过期闪念' }, NOW, 'f2')
    staleBox.notes.put('ada/f2', { ...(staleBox.notes.get('ada/f2')!), updatedAt: OVERDUE })
    const view = face(box, 'ada')
    const byId = new Map(view.nodes.map(node => [node.id, node]))
    const fresh = byId.get('f1')
    expect(fresh?.aging).toBe('fresh')
    expect(fresh?.expiresAt).toBe('2026-11-04T00:00:00.000Z')
    expect(byId.get('p1')?.aging).toBeUndefined()
    expect(byId.get('p1')?.expiresAt).toBeUndefined()
    const overdueView = face(staleBox, 'ada', Date.parse(LATER))
    expect(overdueView.nodes.find(node => node.id === 'f2')?.aging).toBe('overdue')
    // Read-only: the graph face is a query, never a write (no schema, no timer).
    // 只读：图面是查询，绝不是写入（不是 schema，不是定时器）。
    expect(box.notes.all()).toHaveLength(2)
    expect(box.links.all()).toHaveLength(0)
    expect(box.ledger.all()).toHaveLength(1)
  })

  it('rides the configured window into nodes and the stats readout alike', async () => {
    const box = tables()
    await applyCardCapture(box, 'ada', { body: '三天窗闪念' }, NOW, 'f1')
    box.notes.put('ada/f1', { ...(box.notes.get('ada/f1')!), updatedAt: OVERDUE })
    // 3-day window: LATER (2d 0.5h old) is still fresh; the 2-day window flags it.
    // 三天窗：LATER（两天半旧）仍新鲜；两天窗则判过期。
    const wide = face(box, 'ada', Date.parse(LATER), 3)
    expect(wide.nodes[0]?.aging).toBe('fresh')
    expect(wide.nodes[0]?.expiresAt).toBe('2026-11-07T13:00:00.000Z')
    const narrow = face(box, 'ada', Date.parse(LATER), 2)
    expect(narrow.nodes[0]?.aging).toBe('overdue')
    expect(narrow.stats.intake.overdue).toHaveLength(1)
    expect(wide.stats.intake.overdue).toHaveLength(0)
  })

  it('promotes through the face: the node migrates and the edges appear', async () => {
    const box = tables()
    await applyCardCreate(box, 'ada', { title: '化合目标', body: 'x' }, NOW, 'p1')
    await applyCardCapture(box, 'ada', { body: '谈 [[化合目标]] 的闪念' }, NOW, 'f1')
    const before = face(box, 'ada')
    expect(before.edges).toEqual([])
    await applyCardPromote(box, 'ada', 'f1', { title: '化合完成', body: '谈 [[化合目标]] 的正文' }, OVERDUE)
    const after = face(box, 'ada', Date.parse(OVERDUE))
    expect(after.edges).toEqual([{ sourceId: 'f1', targetId: 'p1' }])
    const node = after.nodes.find(row => row.id === 'f1')
    expect(node?.kind).toBe('permanent')
    expect(node?.aging).toBeUndefined()
    try {
      await applyCardPromote(box, 'ada', 'f1', {}, OVERDUE)
      throw new Error('expected kind-mismatch')
    } catch (error: unknown) {
      expect((error as NotebookError).code).toBe('notebook/kind-mismatch')
    }
  })
})

describe('clampWindowDays — the config clamp / 配置钳制', () => {
  it('floors to one day, drops fractions, and caps runaway values', () => {
    expect(clampWindowDays(0)).toBe(1)
    expect(clampWindowDays(-5)).toBe(1)
    expect(clampWindowDays(2.9)).toBe(2)
    expect(clampWindowDays(7)).toBe(7)
    expect(clampWindowDays(400)).toBe(365)
  })
})
