/**
 * Notebook invariants that carry no Host: owner-scoped keys, validation,
 * conflict detection, and the owner list.
 *
 * These are the rules that make isolation structural rather than advisory, so
 * they are tested where they live. A key that forgets its owner is one preset
 * reading another preset's note; a missing limit is a note the storage layer
 * silently truncates later.
 *
 * 不依赖宿主的记事本不变量：按归属划分的键、校验、冲突检测与归属列表。
 *
 * 这些规则让隔离成为结构事实而不是口头约定，因此就在它们所在之处测试。忘记带归属的键，就是
 * 一个预设读到了另一个预设的笔记；缺失的上限，就是以后被存储层悄悄截断的笔记。
 */

import { describe, expect, it } from 'vitest'
import {
  MAX_BODY_CHARS, NotebookError, applyUpdate, buildNote, ensureExpected, noteKey, notesOf, ownersOf,
  requireOwned, validateCreate, validateUpdate,
} from '../src/notes.ts'
import type { NotebookTable } from '../src/storage.ts'
import type { NoteRecord } from '../src/types.ts'

/** An in-memory stand-in for the notes table, so the rules run alone. */
function memoryTable(): NotebookTable<NoteRecord> {
  const rows = new Map<string, NoteRecord>()
  return {
    get: key => rows.get(key),
    put: async (key, value) => { rows.set(key, value) },
    del: async key => rows.delete(key),
    all: () => [...rows.values()],
  }
}

/** Build and store one note, returning its row. */
async function stored(
  table: NotebookTable<NoteRecord>,
  owner: string,
  title: string,
  now: string,
): Promise<NoteRecord> {
  const record = buildNote(owner, validateCreate({ title, body: 'body of ' + title }), now)
  await table.put(noteKey(owner, record.id), record)
  return record
}

describe('notebook ownership', () => {
  it('scopes the storage key by owner', () => {
    expect(noteKey('alice', 'n1')).not.toBe(noteKey('bob', 'n1'))
    expect(noteKey('alice', 'n1')).toBe('alice/n1')
    expect(noteKey('a/b', 'n1')).toBe('a%2Fb/n1')
  })

  it('never returns another preset\u2019s notes from a list', async () => {
    const table = memoryTable()
    await stored(table, 'alice', 'Alice one', '2026-01-01T00:00:00.000Z')
    await stored(table, 'bob', 'Bob one', '2026-01-02T00:00:00.000Z')

    expect(notesOf(table, 'alice').map(note => note.title)).toEqual(['Alice one'])
    expect(notesOf(table, 'bob').map(note => note.title)).toEqual(['Bob one'])
  })

  it('refuses a note id held by another owner', async () => {
    const table = memoryTable()
    const bob = await stored(table, 'bob', 'Bob secret', '2026-01-02T00:00:00.000Z')

    expect(() => requireOwned(table, 'alice', bob.id)).toThrow(NotebookError)
    try {
      requireOwned(table, 'alice', bob.id)
    } catch (error: unknown) {
      expect((error as NotebookError).code).toBe('notebook/note-not-found')
    }
  })

  it('keeps an orphaned owner visible after its preset is gone', async () => {
    const table = memoryTable()
    await stored(table, 'gone', 'Still here', '2026-01-03T00:00:00.000Z')

    const owners = ownersOf(table, ['alice'])
    expect(owners).toEqual([
      { id: 'alice', declared: true, noteCount: 0 },
      { id: 'gone', declared: false, noteCount: 1 },
    ])
  })
})

describe('notebook note rules', () => {
  it('trims fields and refuses a blank title', () => {
    expect(validateCreate({ title: '  A title  ', body: '  body  ' }))
      .toEqual({ title: 'A title', body: 'body' })
    expect(() => validateCreate({ title: '   ', body: 'x' })).toThrow(NotebookError)
  })

  it('refuses a body beyond the stored limit and names the limit', () => {
    let caught: NotebookError | undefined
    try {
      validateCreate({ title: 'Long', body: 'x'.repeat(MAX_BODY_CHARS + 1) })
    } catch (error: unknown) {
      caught = error as NotebookError
    }
    expect(caught?.code).toBe('notebook/body-too-long')
    expect(caught?.message).toContain(String(MAX_BODY_CHARS))
  })

  it('updates only the supplied field and bumps the update time', () => {
    const record = buildNote('alice', { title: 'Old', body: 'Keep me' }, '2026-01-01T00:00:00.000Z', 'n1')
    const next = applyUpdate(record, validateUpdate({ title: 'New' }), '2026-01-02T00:00:00.000Z')

    expect(next.title).toBe('New')
    expect(next.body).toBe('Keep me')
    expect(next.createdAt).toBe(record.createdAt)
    expect(next.updatedAt).toBe('2026-01-02T00:00:00.000Z')
  })

  it('refuses a stale update but accepts the current update time', () => {
    const record = buildNote('alice', { title: 'Old', body: '' }, '2026-01-01T00:00:00.000Z', 'n1')
    expect(() => ensureExpected(record, '2025-01-01T00:00:00.000Z')).toThrow(NotebookError)
    expect(() => ensureExpected(record, record.updatedAt)).not.toThrow()
    expect(() => ensureExpected(record, undefined)).not.toThrow()
  })
})
