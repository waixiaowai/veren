/**
 * The service on the real storage stack: the concurrent-write race and the
 * v1→v2 migration.
 *
 * Invariants I2 (the race half) and I7 of
 * docs/notebook-zettelkasten-design.cn.md §8. The race rides the service's
 * FIFO write chain — two concurrent `create` calls with one title must land
 * exactly one card. The migration seeds a genuine version-1 medium (notes
 * only, no global slot, free-form bodies), then opens it under the v2 domain:
 * every row must survive untouched and the links cache must rebuild from the
 * bodies on that first open.
 *
 * 真实存储栈上的服务：并发写竞态与 v1→v2 迁移。
 *
 * 即 docs/notebook-zettelkasten-design.cn.md §8 的 I2（竞态半边）与 I7。竞态走服务的
 * FIFO 写链——同标题的两次并发 `create` 必须恰好落一张卡。迁移先种出真正的 v1 介质
 * （只有 notes 表、无全局槽、自由正文），再在 v2 域下打开：每一行都必须原样幸存，链接
 * 缓存必须在首次打开时从正文重建。
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import * as Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import NotebookService, { NOTEBOOK_DOMAIN_NAME, NotebookError } from '../src/index.ts'
import { buildNote, noteKey } from '../src/notes.ts'
import type { NoteRecord, NoteSummary } from '../src/types.ts'

/** The roots one spec's temp storage lives under, removed after the spec. 每条用例的临时存储根，测后删除。 */
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** One temporary storage root, removed after the spec. 测试结束后删除的一个临时存储根目录。 */
function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'notebook-service-'))
  roots.push(root)
  return root
}

/** The storage stack exactly as the Web profile provides it, over one root. 与 Web profile 完全相同的存储栈，作用于同一个根。 */
async function storageStack(ctx: Context, root: string): Promise<void> {
  ctx.provide('tools', { register: () => () => undefined })
  ctx.provide('agentPresets', { list: async () => [], composedPreset: () => undefined })
  await ctx.plugin(Storage.default)
  await ctx.plugin(StorageJson, { root })
  await ctx.plugin(StorageDomain, { backend: 'json' })
}

/** Seed one genuine v1 medium: the v1 domain, notes only, no global slot. 种出真正的 v1 介质：只有 notes 表的 v1 域，无全局槽。 */
async function seedV1Medium(root: string): Promise<void> {
  const v1Domain = defineDomain({
    name: NOTEBOOK_DOMAIN_NAME,
    version: 1,
    tables: {
      notes: domainTable<string, NoteRecord>(z.object({
        id: z.string().min(1),
        owner: z.string().min(1),
        title: z.string().min(1),
        body: z.string(),
        createdAt: z.string().min(1),
        updatedAt: z.string().min(1),
      })),
    },
  })
  const ctx = new Context()
  await storageStack(ctx, root)
  const domain = await ctx.storageDomain.open(v1Domain)
  const legacy = (id: string, title: string, body: string): NoteRecord =>
    buildNote('ada', { title, body }, '2026-01-01T00:00:00.000Z', id)
  const table = domain.table('notes')
  await table.put(noteKey('ada', 'legacy-1'), legacy('legacy-1', '迁移原则', '存量行必须原样幸存'))
  // 自由正文里的 [[迁移原则]] 早于语法规则存在——重建应把它收进缓存。
  // The [[迁移原则]] in this free-form body predates the grammar — the rebuild must fold it into the cache.
  await table.put(noteKey('ada', 'legacy-2'), legacy('legacy-2', '升级步骤', '先备份，再按 [[迁移原则]] 校验'))
  await domain.close()
}

describe('notebook service on real storage / 真实存储上的记事本服务', () => {
  it('I2: one FIFO chain lands exactly one of two same-title concurrent creates', async () => {
    const ctx = new Context()
    await storageStack(ctx, tempRoot())
    const fiber = await ctx.plugin(NotebookService, { globalTools: { enabled: false } })
    const port = ctx.notebook.toolsPort()

    const attempts = await Promise.allSettled([
      port.create('ada', 'Colliding title 碰撞标题', 'first writer'),
      port.create('ada', 'Colliding title 碰撞标题', 'second writer'),
    ])
    const fulfilled = attempts.filter(entry => entry.status === 'fulfilled')
    const refused = attempts.filter(entry => entry.status === 'rejected')
    expect(fulfilled).toHaveLength(1)
    expect(refused).toHaveLength(1)
    const reason = (refused[0] as PromiseRejectedResult).reason
    expect(reason).toBeInstanceOf(NotebookError)
    expect((reason as NotebookError).code).toBe('notebook/title-conflict')
    // 幸存的那张卡带上写链顺序里先落库的正文。/ The surviving card carries the first body in chain order.
    expect((await port.list('ada')).map(row => row.title)).toEqual(['Colliding title 碰撞标题'])

    await fiber.dispose()
  })

  it('I7: a v1 medium survives the v2 open intact, with its links cache rebuilt from bodies', async () => {
    const root = tempRoot()
    await seedV1Medium(root)

    const ctx = new Context()
    await storageStack(ctx, root)
    const fiber = await ctx.plugin(NotebookService, { globalTools: { enabled: false } })
    const port = ctx.notebook.toolsPort()

    // 行零丢失：两条 v1 记录按原字段可读。/ No row lost: both v1 records read with their fields intact.
    const rows = await port.list('ada')
    expect(rows.map(row => row.title).sort()).toEqual(['升级步骤', '迁移原则'])
    const principle = (await port.read('ada', 'legacy-1')).body
    expect(principle).toBe('存量行必须原样幸存')

    // 重建后的缓存让旧正文里的链接成为真语义：反链可查、被引用即拒删。
    // The rebuilt cache turns legacy body links into real semantics: backlinks resolve, referenced delete refuses.
    const backlinks = await port.backlinks('ada', 'legacy-1')
    expect(backlinks.map(row => row.sourceId)).toEqual(['legacy-2'])
    await expect(port.remove('ada', 'legacy-1')).rejects.toMatchObject({ code: 'notebook/card-referenced' })

    await fiber.dispose()
  })

  it('lists summaries with excerpts and never crosses owners', async () => {
    const ctx = new Context()
    await storageStack(ctx, tempRoot())
    const fiber = await ctx.plugin(NotebookService, { globalTools: { enabled: false } })
    const port = ctx.notebook.toolsPort()

    await port.create('ada', 'Ada card', 'ada body')
    await port.create('bob', 'Bob card', 'bob body')

    const rows = await port.list('ada')
    expect(rows.map(row => (row as NoteSummary).title)).toEqual(['Ada card'])
    expect((await port.list('bob')).map(row => row.title)).toEqual(['Bob card'])

    await fiber.dispose()
  })
})
