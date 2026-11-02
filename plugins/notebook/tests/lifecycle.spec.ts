/**
 * The lifecycle properties, against in-memory tables — the executable form of
 * docs/notebook-note-types.cn.md's invariants: the intake valve stays loose
 * and off-graph, promotion applies the full write-time discipline, archive
 * demands distill-back evidence, nothing ages away on its own, and every
 * transition lands in the ledger.
 *
 * 生命周期性质，对内存表——docs/notebook-note-types.cn.md 不变式的可执行形态：
 * 进料阀保持宽松且不入图，炼成适用完整写入纪律，归档索要蒸馏证据，没有任何卡
 * 会自己老化消失，每次转移都落账。
 */

import { describe, expect, it } from 'vitest'
import { applyCardCreate, applyCardRemove, applyCardUpdate } from '../src/cards.ts'
import { applyCardArchive, applyCardCapture, applyCardPromote, mintFleetingTitle } from '../src/lifecycle.ts'
import { FLEETING_DAYS, intakeView } from '../src/queue.ts'
import { boxStats } from '../src/stats.ts'
import { cachedBacklinks, hubView, staleView } from '../src/graph.ts'
import { riddlePairs } from '../src/riddles.ts'
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

/** Two days and a bit after NOW — past the intake window. NOW 两天多之后——过了进料窗。 */
const OVERDUE = '2026-11-04T13:00:00.000Z'

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

describe('capture — the intake valve / 捕获——进料阀', () => {
  it('mints the title from the first line and keeps duplicate fleeting titles legal', async () => {
    const box = tables()
    const first = await applyCardCapture(box, 'ada', { body: '关于存储的想法一\n细节随后补' }, NOW, 'f1')
    const second = await applyCardCapture(box, 'ada', { body: '关于存储的想法一\n另一条同题闪念' }, NOW, 'f2')
    expect(first.title).toBe('关于存储的想法一')
    expect(second.title).toBe('关于存储的想法一')
    expect(first.kind).toBe('fleeting')
    // 闪念不是地址：两张闪念同题不构成歧义（裁决 #6/#8）。
    // / Fleeting cards are not addresses: two same-titled ones are unambiguous (adjudication #6/#8).
    expect(mintFleetingTitle('   \n只有第二行')).toBe('只有第二行')
  })

  it('refuses a title a link-target card already holds, and empty bodies via the shared limits', async () => {
    const box = tables()
    await applyCardCreate(box, 'ada', { title: '已被占用的标题', body: 'permanent' }, NOW, 'p1')
    expect(await refusedCode(() =>
      applyCardCapture(box, 'ada', { title: '已被占用的标题', body: '撞永久卡的标题' }, NOW),
    )).toBe('notebook/title-conflict')
    expect(await refusedCode(() =>
      applyCardCapture(box, 'ada', { title: '空的正文', body: '   ' }, NOW),
    )).toBe('notebook/input-invalid')
  })

  it('keeps dangling [[links]] verbatim and the card off the graph', async () => {
    const box = tables()
    const card = await applyCardCapture(box, 'ada', { body: '想到了 [[还不存在的卡]] 这件事' }, NOW, 'f1')
    expect(card.body).toContain('[[还不存在的卡]]')
    // 不入图：无缓存行，枢纽/反链/谜面/迷失区都不见它。/ Off the graph: no cache rows; hubs/backlinks/riddles/stale never see it.
    expect(box.links.all()).toEqual([])
    await applyCardCreate(box, 'ada', { title: '锚卡', body: 'graph citizen' }, NOW, 'g1')
    expect(hubView(box.notes, box.links, 'ada', 10)).toEqual([])
    expect(riddlePairs(box.notes, box.links, 'ada')).toEqual([])
    expect(staleView(box.notes, box.links, 'ada', Date.parse(OVERDUE))).toEqual([])
    // 永久卡不得链接闪念：解析排除闪念目标。/ A permanent card cannot link a fleeting one: resolution excludes fleeting targets.
    expect(await refusedCode(() =>
      applyCardCreate(box, 'ada', { title: '指错方向', body: '见 [[关于存储的想法一]]' }, NOW),
    )).toBe('notebook/link-unresolved')
  })

  it('has no TTL: an overdue fleeting card is still there and still listed, never auto-removed', async () => {
    const box = tables()
    await applyCardCapture(box, 'ada', { body: '一两天内该加工的闪念' }, NOW, 'f1')
    const nowMs = Date.parse(OVERDUE)
    const intake = intakeView(box.notes, 'ada', nowMs)
    expect(intake.fleet.map(row => row.id)).toEqual(['f1'])
    expect(intake.overdue.map(row => row.id)).toEqual(['f1'])
    // 时间再过一周，卡还在——窗口只决定浮出，不决定生死。/ A week later the card is still there — the window decides visibility, never life.
    expect(intakeView(box.notes, 'ada', nowMs + 7 * 24 * 60 * 60 * 1000).fleet).toHaveLength(1)
    expect(box.notes.all()).toHaveLength(1)
    void FLEETING_DAYS
  })

  it('lands a captured row in the ledger', async () => {
    const box = tables()
    await applyCardCapture(box, 'ada', { body: '记账的一张' }, NOW, 'f1')
    expect(box.ledger.all().map(row => [row.action, row.cardId])).toEqual([['captured', 'f1']])
  })
})

describe('promote — the compounding step / 炼成——化合步', () => {
  it('applies the full write-time discipline at processing time', async () => {
    const box = tables()
    await applyCardCreate(box, 'ada', { title: '既有卡', body: 'target' }, NOW, 'p1')
    const card = await applyCardCapture(box, 'ada', { body: '想到 [[既有卡]] 和 [[缺的卡]]' }, NOW, 'f1')

    // 悬空链接在炼成时刻被拒——纪律从写入时移到加工时，而不是取消。
    // / Dangling links refuse at processing time — the discipline moved to processing, not dropped.
    expect(await refusedCode(() =>
      applyCardPromote(box, 'ada', 'f1', {}, NOW),
    )).toBe('notebook/link-unresolved')

    const promoted = await applyCardPromote(box, 'ada', 'f1', { body: '想清楚了：见 [[既有卡]]' }, OVERDUE)
    expect(promoted.kind).toBe('permanent')
    expect(cachedBacklinks(box.links, 'ada', '既有卡').map(row => row.sourceId)).toEqual(['f1'])
    // 时间戳被盖为炼成时刻（乐观守卫的基准）。/ The stamp moves to the promotion instant (the guard's baseline).
    expect(promoted.updatedAt).toBe(OVERDUE)
    expect(card.kind).toBe('fleeting') // 旧投影不变 / the old projection untouched
  })

  it('refuses kind mismatches, honors the optimistic guard, and records the ledger row', async () => {
    const box = tables()
    await applyCardCreate(box, 'ada', { title: '生而永久', body: 'not fleeting' }, NOW, 'p1')
    expect(await refusedCode(() =>
      applyCardPromote(box, 'ada', 'p1', {}, NOW),
    )).toBe('notebook/kind-mismatch')

    const card = await applyCardCapture(box, 'ada', { body: '炼两次试试' }, NOW, 'f1')
    await applyCardPromote(box, 'ada', 'f1', { title: '炼成的卡' }, NOW)
    expect(await refusedCode(() =>
      applyCardPromote(box, 'ada', 'f1', {}, NOW),
    )).toBe('notebook/kind-mismatch')

    const box2 = tables()
    await applyCardCapture(box2, 'ada', { body: '乐观守卫' }, NOW, 'f1')
    expect(await refusedCode(() =>
      applyCardPromote(box2, 'ada', 'f1', { expectedUpdatedAt: '2000-01-01T00:00:00.000Z' }, NOW),
    )).toBe('notebook/conflict')
    // 被拒的炼成不记账：账上只有此前的捕获。/ A refused promotion records nothing: only the earlier capture is on file.
    expect(box2.ledger.all().map(row => row.action)).toEqual(['captured'])
    const ok = await applyCardPromote(box2, 'ada', 'f1', { expectedUpdatedAt: card.updatedAt }, NOW)
    expect(ok.kind).toBe('permanent')
    expect(box2.ledger.all().map(row => row.action)).toEqual(['captured', 'promoted'])
  })
})

describe('archive — the honest project ending / 归档——项目体面的终点', () => {
  it('demands real distill-back evidence before it moves anything', async () => {
    const box = tables()
    await applyCardCreate(box, 'ada', { title: '洞见卡', body: 'settled insight' }, NOW, 'i1')
    await applyCardCapture(box, 'ada', { body: '还没炼的闪念' }, NOW, 'f1')
    const project = await applyCardCreate(box, 'ada', { title: '存储迁移项目', body: '进行中的事项' }, NOW, 'pr1')
    // 项目卡怎么造？write_note 造的是永久卡——项目卡经 capture+anchor 路径，见下一用例；
    // 这里先把这张永久卡转成项目卡是不可逆的（无降级转移），故直接改存储行。
    // / How does a project card come to be? write_note makes permanent cards — the project path is capture with
    // an anchor, next case; there is no demotion transition, so this row is set directly.
    await box.notes.put(`ada/pr1`, { ...project, kind: 'project' })

    expect(await refusedCode(() =>
      applyCardArchive(box, 'ada', 'pr1', [], NOW),
    )).toBe('notebook/archive-undistilled')
    expect(await refusedCode(() =>
      applyCardArchive(box, 'ada', 'pr1', ['missing-id'], NOW),
    )).toBe('notebook/archive-undistilled')
    // 指向闪念不算蒸馏——价值只落进永久卡。/ Pointing at a fleeting card is not distillation — value settles into permanents only.
    expect(await refusedCode(() =>
      applyCardArchive(box, 'ada', 'pr1', ['f1'], NOW),
    )).toBe('notebook/archive-undistilled')
    // 非项目卡拒绝归档。/ A non-project card refuses to archive.
    expect(await refusedCode(() =>
      applyCardArchive(box, 'ada', 'i1', ['i1'], NOW),
    )).toBe('notebook/kind-mismatch')
    void project
  })

  it('deletes the project card once the evidence holds, and refuses while referenced', async () => {
    const box = tables()
    const insight = await applyCardCreate(box, 'ada', { title: '迁移必须不丢行', body: 'settled' }, NOW, 'i1')
    void insight
    const project = await applyCardCreate(box, 'ada', { title: '存储迁移项目', body: '收尾中' }, NOW, 'pr1')
    await box.notes.put(`ada/pr1`, { ...project, kind: 'project', anchor: 'task-42' })
    await applyCardCreate(box, 'ada', { title: '引用方', body: '见 [[存储迁移项目]]' }, NOW, 'r1')
    expect(await refusedCode(() =>
      applyCardArchive(box, 'ada', 'pr1', ['i1'], NOW),
    )).toBe('notebook/card-referenced')
    await applyCardUpdate(box, 'ada', 'r1', { body: '不再引用' }, NOW)
    await expect(applyCardArchive(box, 'ada', 'pr1', ['i1'], NOW)).resolves.toBe(true)
    expect(box.notes.get('ada/pr1')).toBeUndefined()
    expect(box.ledger.all().map(row => row.action)).toContain('archived')
  })

  it('creates project cards through capture with an anchor, visible via the kind filter', async () => {
    const box = tables()
    const row = await applyCardCapture(box, 'ada', { title: 'IM 内容路由', body: '项目进行中', anchor: 'task-42' }, NOW, 'pr1')
    expect(row.kind).toBe('project')
    expect(row.anchor).toBe('task-42')
    // 空白 anchor 拒绝：锚必须是非空 taskId。/ A blank anchor refuses: an anchor must be a non-empty taskId.
    expect(await refusedCode(() =>
      applyCardCapture(box, 'ada', { body: '空锚', anchor: '   ' }, NOW),
    )).toBe('notebook/input-invalid')
    const listed = intakeView(box.notes, 'ada', Date.parse(NOW))
    // 项目卡不在闪念队列里。/ Project cards are not in the intake queue.
    expect(listed.fleet.map(r => r.id)).toEqual([])
    const stored = box.notes.get('ada/pr1')
    expect(stored?.kind).toBe('project')
    expect(stored?.anchor).toBe('task-42')
  })
})

describe('trash / stats — the flywheel readout / 扔与读数——飞轮仪表', () => {
  it('counts every transition and the density over graph citizens only', async () => {
    const box = tables()
    await applyCardCapture(box, 'ada', { body: '闪念一' }, NOW, 'f1')
    await applyCardCapture(box, 'ada', { body: '闪念二' }, NOW, 'f2')
    await applyCardCreate(box, 'ada', { title: '永久一', body: 'a' }, NOW, 'p1')
    await applyCardPromote(box, 'ada', 'f1', { title: '炼成一', body: '见 [[永久一]]' }, NOW)
    await applyCardRemove(box, 'ada', 'f2', OVERDUE)
    const stats = boxStats(box.notes, box.links, box.ledger, 'ada', Date.parse(OVERDUE))
    expect(stats.cards).toEqual({ fleeting: 0, permanent: 2, project: 0 })
    expect(stats.links).toBe(1)
    expect(stats.density).toBe(0.5)
    expect(stats.intake.fleet).toEqual([])
    expect(stats.rates).toEqual({ days: 7, captured: 2, promoted: 1, trashed: 1, archived: 0, riddlesClosed: 0 })
  })

  it('records a riddle closure only when a new direct link closes a real riddle', async () => {
    const box = tables()
    await applyCardCreate(box, 'ada', { title: '邻一', body: 'n1' }, NOW, 'n1')
    await applyCardCreate(box, 'ada', { title: '邻二', body: 'n2' }, NOW, 'n2')
    await applyCardCreate(box, 'ada', { title: '甲', body: '见 [[邻一]] 与 [[邻二]]' }, NOW, 'a1')
    await applyCardCreate(box, 'ada', { title: '乙', body: '见 [[邻一]] 与 [[邻二]]' }, NOW, 'b1')
    // 谜面在案：(甲,乙)。甲补上 [[乙]] → 闭合，记 riddle_closed。
    // / The riddle (甲,乙) is on file; 甲 gains [[乙]] → closed, ledger row.
    expect(riddlePairs(box.notes, box.links, 'ada').some(pair => pair.aId === 'a1' && pair.bId === 'b1')).toBe(true)
    await applyCardUpdate(box, 'ada', 'a1', { body: '见 [[邻一]] 与 [[邻二]]，见 [[乙]]' }, NOW)
    expect(box.ledger.all().filter(row => row.action === 'riddle_closed')).toHaveLength(1)
    // 重复链接不再记账：谜面已不存在。/ Relinking records nothing: the riddle is gone.
    await applyCardUpdate(box, 'ada', 'a1', { body: '见 [[邻一]] 与 [[邻二]]，见 [[乙]] 与 [[乙]]' }, NOW)
    expect(box.ledger.all().filter(row => row.action === 'riddle_closed')).toHaveLength(1)
  })
})
