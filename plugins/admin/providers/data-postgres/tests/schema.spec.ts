/**
 * Schema catalog and SQL binding: table coverage, idempotent DDL, projection,
 * upsert/delete plans for dedicated and fallback tables.
 *
 * schema 目录与 SQL 绑定：表覆盖、幂等 DDL、投影、专用表与回退表的 upsert/delete 计划。
 */

import { describe, expect, it } from 'vitest'
import type { AdminEntity } from '@veren/admin-contract'
import {
  FALLBACK_TABLE,
  PLATFORM_TABLES,
  bindColumn,
  planLoad,
  planLoadFallback,
  planRemove,
  planUpsert,
  schemaStatements,
  tableFor,
} from '../src/schema.ts'

/** One complete user record used by the plans. 计划使用的完整用户记录。 */
const user = {
  id: 'u1',
  email: 'owner@example.com',
  name: 'Owner',
  active: true,
  passwordHash: 'scrypt$hash',
  createdAt: '2026-10-20T00:00:00.000Z',
} as const

/** Collapse the DDL into one searchable text. 把 DDL 合并为一段可搜索文本。 */
const ddl = schemaStatements().join('\n')

/** Test-only escape hatch for malformed records the static type forbids. 测试专用：构造静态类型不允许的畸形记录。 */
function record(value: { readonly id: string } & Record<string, unknown>): AdminEntity {
  return { ...value }
}

describe('schema catalog', () => {
  it('covers every platform collection with a veren_ table', () => {
    expect(PLATFORM_TABLES.map((table) => table.collection)).toEqual([
      'admin_users',
      'admin_sessions',
      'admin_tokens',
      'admin_roles',
      'admin_bindings',
      'admin_audit',
    ])
    for (const table of PLATFORM_TABLES) {
      expect(table.table.startsWith('veren_')).toBe(true)
      expect(ddl).toContain(`CREATE TABLE IF NOT EXISTS "${table.table}"`)
      for (const column of table.columns) {
        expect(ddl).toContain(`ALTER TABLE "${table.table}" ADD COLUMN IF NOT EXISTS "${column.column}"`)
      }
      for (const index of table.indexes) {
        expect(ddl).toContain(`INDEX IF NOT EXISTS "${index.name}" ON "${table.table}"`)
      }
    }
  })

  it('declares the shared fallback table and its collection index', () => {
    expect(ddl).toContain(`CREATE TABLE IF NOT EXISTS "${FALLBACK_TABLE}"`)
    expect(ddl).toContain(`ON "${FALLBACK_TABLE}" ("collection")`)
    expect(tableFor('notes')).toBeUndefined()
    expect(tableFor('admin_users')?.table).toBe('veren_users')
  })

  it('keeps the DDL idempotent', () => {
    for (const statement of schemaStatements()) {
      expect(statement).toMatch(/^CREATE (UNIQUE )?(TABLE|INDEX) IF NOT EXISTS|^ALTER TABLE .+ ADD COLUMN IF NOT EXISTS/)
      expect(statement).not.toMatch(/DROP\s/i)
    }
  })
})

describe('upsert plans', () => {
  it('binds every projected user field in column order', () => {
    const plan = planUpsert('admin_users', user)
    expect(plan.sql).toContain('INSERT INTO "veren_users"')
    expect(plan.sql).toContain('"id", "data", "email", "name", "active", "password_hash", "created_at", "last_login_at"')
    expect(plan.sql).toContain('$2::jsonb')
    expect(plan.sql).toContain('ON CONFLICT ("id") DO UPDATE SET')
    expect(plan.params[0]).toBe('u1')
    expect(plan.params[1]).toBe(JSON.stringify(user))
    expect(plan.params.slice(2)).toEqual([
      'owner@example.com',
      'Owner',
      true,
      'scrypt$hash',
      '2026-10-20T00:00:00.000Z',
      null,
    ])
  })

  it('binds unknown collections to the fallback table', () => {
    const fallback = { id: 'n1', text: 'hello' }
    const plan = planUpsert('notes', fallback)
    expect(plan.sql).toContain(`INSERT INTO "${FALLBACK_TABLE}" ("collection", "id", "data")`)
    expect(plan.sql).toContain('ON CONFLICT ("collection", "id")')
    expect(plan.params).toEqual(['notes', 'n1', JSON.stringify(fallback)])
  })

  it('turns missing or mistyped projected fields into NULL', () => {
    const columns = tableFor('admin_users')!.columns
    const byName = new Map(columns.map((column) => [column.column, column]))
    expect(bindColumn(byName.get('last_login_at')!, user)).toBeNull()
    expect(bindColumn(byName.get('active')!, record({ id: 'u1', active: 'yes' }))).toBeNull()
    expect(bindColumn(byName.get('name')!, record({ id: 'u1', name: 7 }))).toBeNull()
    expect(bindColumn(byName.get('created_at')!, record({ id: 'u1', createdAt: 1 }))).toBeNull()
  })

  it('binds string arrays and JSON objects without losing shape', () => {
    const tokenColumns = tableFor('admin_tokens')!.columns
    const scopes = tokenColumns.find((column) => column.column === 'scopes')!
    expect(bindColumn(scopes, record({ id: 't1', scopes: ['a', 'b'] }))).toEqual(['a', 'b'])
    expect(bindColumn(scopes, record({ id: 't1', scopes: 'a' }))).toBeNull()
    expect(bindColumn(scopes, record({ id: 't1', scopes: ['a', 1] }))).toBeNull()

    const auditColumns = tableFor('admin_audit')!.columns
    const detail = auditColumns.find((column) => column.column === 'detail')!
    expect(bindColumn(detail, record({ id: 'a1', detail: { userId: 'u1' } }))).toBe('{"userId":"u1"}')
    expect(bindColumn(detail, record({ id: 'a1' }))).toBeNull()
  })
})

describe('read and delete plans', () => {
  it('loads a dedicated table and the fallback table', () => {
    expect(planLoad(tableFor('admin_users')!)).toEqual({ sql: 'SELECT "data" FROM "veren_users"', params: [] })
    expect(planLoadFallback().sql).toContain(`FROM "${FALLBACK_TABLE}"`)
  })

  it('deletes by id or by collection and id', () => {
    expect(planRemove('admin_users', 'u1')).toEqual({ sql: 'DELETE FROM "veren_users" WHERE "id" = $1', params: ['u1'] })
    expect(planRemove('notes', 'n1')).toEqual({
      sql: `DELETE FROM "${FALLBACK_TABLE}" WHERE "collection" = $1 AND "id" = $2`,
      params: ['notes', 'n1'],
    })
  })
})
