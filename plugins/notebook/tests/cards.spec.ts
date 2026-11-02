/**
 * The card write paths against in-memory tables: uniqueness, dangling-link
 * refusal, the backlink identity, rename following, and the delete guard.
 *
 * These are invariants I2–I6 of docs/notebook-zettelkasten-design.cn.md §8.
 * The specs call the same `applyCard*` functions the service calls, so the
 * tested path is the production path — no shim, no re-derivation.
 *
 * 内存表上的卡片写路径：标题唯一性、悬挂链接拒绝、反链恒等式、改名跟随与删除守卫。
 *
 * 即 docs/notebook-zettelkasten-design.cn.md §8 的不变式 I2–I6。用例直接调用服务所
 * 调用的同一批 `applyCard*` 函数，因此被测路径就是生产路径——没有垫片，没有二次推导。
 */

import { describe, expect, it } from 'vitest'
import { buildNote, noteKey, titlesContaining } from '../src/notes.ts'
import { staleView, STALE_DAYS } from '../src/graph.ts'
import { NotebookError } from '../src/notes.ts'
import { applyCardCreate, applyCardRemove, applyCardUpdate } from '../src/cards.ts'
import type { CardTables } from '../src/cards.ts'
import { cachedBacklinks, scanBacklinks, distinctTargets, outgoingOf } from '../src/graph.ts'
import { extractLinks } from '../src/links.ts'
import type { NotebookTable } from '../src/storage.ts'
import type { LinkRecord, NoteRecord } from '../src/types.ts'

/** An in-memory stand-in for one domain table, so the paths run alone. 单张域表的内存替身，让写路径独立运行。 */
function memoryTable<T>(): NotebookTable<T> {
  const rows = new Map<string, T>()
  return {
    get: key => rows.get(key),
    put: async (key, value) => { rows.set(key, value) },
    del: async key => rows.delete(key),
    all: () => [...rows.values()],
  }
}

/** One fresh pair of notes+links tables per test. 每条用例一对全新的 notes+links 表。 */
function tables(): CardTables {
  return { notes: memoryTable<NoteRecord>(), links: memoryTable<LinkRecord>() }
}

/** The clock every write in one test shares. 单条用例内所有写共用的时钟。 */
const NOW = '2026-11-02T00:00:00.000Z'

/** The refusal code one call died with, asserted inside the call. 一次调用所死于其上的拒绝码，在调用内断言。 */
async function refusedCode(run: () => Promise<unknown>): Promise<string> {
  try {
    await run()
  } catch (error: unknown) {
    if (error instanceof NotebookError) return error.code
    throw error
  }
  throw new Error('expected the call to be refused, but it succeeded')
}

describe('card write paths / 卡片写路径', () => {
  it('I2: refuses a second card carrying a live title, and allows rename onto its own title', async () => {
    const box = tables()
    await applyCardCreate(box, 'ada', { title: 'One idea', body: 'the whole of it' }, NOW, 'a1')

    expect(await refusedCode(() => applyCardCreate(box, 'ada', { title: 'One idea', body: 'x' }, NOW)))
      .toBe('notebook/title-conflict')
    // 另一归属同题共存：唯一性按归属圈定。/ Another owner may carry the same title: uniqueness scopes per owner.
    await applyCardCreate(box, 'bob', { title: 'One idea', body: 'x' }, NOW, 'b1')
    // 同归属内改名撞另一张卡的标题被拒。/ An in-owner rename onto another card's title is refused.
    await applyCardCreate(box, 'ada', { title: 'Second idea', body: 'x' }, NOW, 'a2')
    expect(await refusedCode(() =>
      applyCardUpdate(box, 'ada', 'a1', { title: 'Second idea' }, NOW),
    )).toBe('notebook/title-conflict')
    // 改名回自己的标题：允许。/ Renaming onto its own title: allowed.
    await expect(applyCardUpdate(box, 'ada', 'a1', { title: ' One idea ' }, NOW)).resolves.toMatchObject({ title: 'One idea' })
  })

  it('I3: refuses a dangling link, names close titles, and stores literal forms verbatim', async () => {
    const box = tables()
    await applyCardCreate(box, 'ada', { title: 'Compatible versions semantics', body: 'reads older rows' }, NOW)

    const code = await refusedCode(() =>
      applyCardCreate(box, 'ada', { title: 'New card', body: 'see [[compaatible versions]] first' }, NOW))
    expect(code).toBe('notebook/link-unresolved')
    // 改名目标存在后同一正文可写。/ The same body writes once the target exists.
    await applyCardCreate(box, 'ada', { title: 'New card', body: 'see [[Compatible versions semantics]] first' }, NOW, 'n1')
    // 代码形态与转义形态按字面存储，解析出零链接。/ Code-like and escaped forms store verbatim, parsing to zero links.
    const literal = await applyCardCreate(box, 'ada', { title: 'Literal', body: 'grid [[1,2],[3,4]] and \\[[fake]]' }, NOW, 'l1')
    expect(extractLinks(literal.body)).toEqual([])
  })

  it('I4: the cache equals a fresh body scan across a random op history', async () => {
    const box = tables()
    // Deterministic PRNG so a failure reproduces. 确定性伪随机，失败可复现。
    let seed = 0x2f6e2b1
    const random = (): number => {
      seed = (seed + 0x6d2b79f5) | 0
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
    const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)] as T

    const titles = new Set<string>()
    for (let step = 0; step < 160; step++) {
      const owner = 'ada'
      const alive = [...titles]
      const roll = random()
      if (roll < 0.35 || alive.length === 0) {
        const title = alive.length < 30 ? `card ${step} 卡` : pick(alive).replace('卡', '卡二')
        if (titles.has(title)) continue
        const targets = alive.filter(() => random() < 0.3).slice(0, 3)
        await applyCardCreate(box, owner, { title, body: targets.map(t => `see [[${t}]]`).join(' ') || 'seed' }, NOW)
        titles.add(title)
      } else if (roll < 0.6) {
        const id = `x${step}`
        const targets = alive.filter(() => random() < 0.4).slice(0, 3)
        const created = await applyCardCreate(box, owner, { title: `temp ${step}`, body: 'draft' }, NOW, id)
        titles.add(`temp ${step}`)
        const title = `moved ${step}`
        await applyCardUpdate(box, owner, id, { title, body: targets.map(t => `→ [[${t}]]`).join(' ') || 'draft' }, NOW)
        titles.delete(created.title)
        titles.add(title)
      } else if (roll < 0.8) {
        const title = pick(alive)
        const id = box.notes.all().find(row => row.owner === owner && row.title === title)?.id
        if (id === undefined) continue
        try {
          await applyCardRemove(box, owner, id)
          titles.delete(title)
        } catch {
          // 被引用拒删：正常路径，图保持原样。/ Refused while referenced: the normal path; the graph stays.
        }
      } else {
        const title = pick(alive)
        const id = box.notes.all().find(row => row.owner === owner && row.title === title)?.id
        if (id === undefined) continue
        await applyCardUpdate(box, owner, id, { body: `renamed [[${pick(alive)}]] once` }, NOW)
      }
      // 每步之后：每个活标题上，缓存与全图扫描逐 id 相等。/ After each step: per live title, cache equals scan by ids.
      for (const title of titles) {
        const viaCache = cachedBacklinks(box.links, 'ada', title).map(row => row.sourceId).sort()
        const viaScan = scanBacklinks(box.notes, 'ada', title).map(row => row.id).sort()
        expect(viaCache, `title ${title} after step ${step}`).toEqual(viaScan)
      }
    }
  })

  it('I5: a rename moves the referring bodies and the cache, and keeps outgoing links resolvable', async () => {
    const box = tables()
    await applyCardCreate(box, 'ada', { title: 'Target', body: 'the target' }, NOW, 't1')
    await applyCardCreate(box, 'ada', { title: 'Referrer', body: 'depends on [[Target]] deeply' }, NOW, 'r1')

    await applyCardUpdate(box, 'ada', 't1', { title: 'Target renamed' }, NOW)

    const referrer = box.notes.get(noteKey('ada', 'r1'))
    expect(referrer?.body).toBe('depends on [[Target renamed]] deeply')
    expect(cachedBacklinks(box.links, 'ada', 'Target')).toEqual([])
    expect(cachedBacklinks(box.links, 'ada', 'Target renamed').map(row => row.sourceId)).toEqual(['r1'])
    expect(outgoingOf(box.notes, 'ada', referrer?.body ?? '')).toEqual([
      { targetId: 't1', targetTitle: 'Target renamed' },
    ])
    // 悬挂链接从未出现。/ A dangling link never appeared.
    expect(distinctTargets(box.notes.get(noteKey('ada', 'r1'))?.body ?? '').every(
      title => box.notes.all().some(row => row.title === title),
    )).toBe(true)
  })

  it('I6: refuses deleting a referenced card, then allows it once the links are gone', async () => {
    const box = tables()
    await applyCardCreate(box, 'ada', { title: 'Target', body: 'the target' }, NOW, 't1')
    await applyCardCreate(box, 'ada', { title: 'Referrer', body: 'links [[Target]]' }, NOW, 'r1')

    expect(await refusedCode(() => applyCardRemove(box, 'ada', 't1'))).toBe('notebook/card-referenced')

    await applyCardUpdate(box, 'ada', 'r1', { body: 'no longer links' }, NOW)
    await expect(applyCardRemove(box, 'ada', 't1')).resolves.toBe(true)
    expect(box.notes.get(noteKey('ada', 't1'))).toBeUndefined()
    // 删除卡的出链缓存行一并消失。/ The deleted card's outgoing cache rows go with it.
    expect(box.links.all().filter(row => row.sourceId === 't1')).toEqual([])
  })

  it('builds rows through the shared clock and key path', async () => {
    const box = tables()
    const record = await applyCardCreate(box, 'ada', { title: 'T', body: 'b' }, NOW)
    expect(record).toEqual(buildNote('ada', { title: 'T', body: 'b' }, NOW, record.id))
    expect(box.notes.get(noteKey('ada', record.id))).toBeDefined()
  })

  it('F3: a refusal’s suggestions stay inside the same fragment’s title lookup', async () => {
    const box = tables()
    await applyCardCreate(box, 'ada', { title: 'rename-follows-the-referrer-body', body: 'x' }, NOW, 's1')
    const missing = 'rename-follows-the-referrer-body-and-more'
    let message = ''
    try {
      await applyCardCreate(box, 'ada', { title: '写前查重', body: `链接 [[${missing}]]` }, NOW)
    } catch (error: unknown) {
      if (error instanceof NotebookError) message = error.message
      else throw error
    }
    expect(message).toContain('Existing titles containing the text')
    const suggested = [...message.matchAll(/「([^」]+)」/g)].map(match => match[1] as string)
    expect(suggested.length).toBeGreaterThan(0)
    const lookup = titlesContaining(box.notes, 'ada', missing.slice(0, 20)).map(row => row.title)
    for (const title of suggested) expect(lookup).toContain(title)
  })

  it('M2/S1: the stale queue is exactly unlinked cards past the freshness window, oldest first', async () => {
    const box = tables()
    const old = '2026-10-01T00:00:00.000Z'
    const fresh = '2026-11-01T00:00:00.000Z'
    await applyCardCreate(box, 'ada', { title: '老而孤', body: '谁也不链我' }, old, 's-old-lone')
    await applyCardCreate(box, 'ada', { title: '老而有链目标', body: '被指着' }, old, 's-old-linked')
    await applyCardCreate(box, 'ada', { title: '较新引用者', body: '指向 [[老而有链目标]]' }, fresh, 's-new-ref')
    await applyCardCreate(box, 'ada', { title: '新而孤', body: '新来的孤儿' }, fresh, 's-new-lone')

    const nowMs = Date.parse('2026-11-02T00:00:00.000Z')
    const stale = staleView(box.notes, box.links, 'ada', nowMs)
    expect(stale.map(row => row.title)).toEqual(['老而孤'])
    // 保鲜窗内不浮出（默认 7 天）；窗口拉长到 0 天则所有无入链的卡都进队——
    // 注意「较新引用者」有出链但无入链，按定义仍是孤儿（出链不锚定自己）。
    // / Inside the window nothing surfaces (default 7 days); with the window at
    // 0 days every unlinked card enters — note that the fresh referrer has
    // outbound links but no inbound ones, so it is still an orphan by the
    // definition (outbound links do not anchor the card itself).
    expect(staleView(box.notes, box.links, 'ada', nowMs, 0).map(row => row.title))
      .toEqual(['老而孤', '较新引用者', '新而孤'])
    void STALE_DAYS
  })
})
