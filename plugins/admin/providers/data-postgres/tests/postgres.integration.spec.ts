/**
 * Real PostgreSQL integration: idempotent bootstrap, DDL footprint, durable
 * round-trip through every platform collection, fallback collection, and
 * transaction commit/rollback.
 *
 * The suite runs only when `VEREN_PG_TEST_URL` is set, for example:
 * `$env:VEREN_PG_TEST_URL = 'postgres://veren:veren@127.0.0.1:5432/veren_admin'`.
 * It works inside a throwaway schema and drops that schema afterwards, so it
 * never touches tables outside its own namespace.
 *
 * 鐪熷疄 PostgreSQL 闆嗘垚娴嬭瘯锛氬箓绛夊紩瀵笺€丏DL 瓒宠抗銆佸叏閮ㄥ钩鍙伴泦鍚堜笌鍥為€€闆嗗悎鐨勬寔涔呭線杩斻€? * 浜嬪姟鎻愪氦/鍥炴粴銆備粎鍦ㄨ缃?`VEREN_PG_TEST_URL` 鏃惰繍琛岋紝渚嬪锛? * `$env:VEREN_PG_TEST_URL = 'postgres://veren:veren@127.0.0.1:5432/veren_admin'`銆? * 瀹冨湪涓€娆℃€?schema 鍐呭伐浣滃苟鍦ㄧ粨鏉熷悗鍒犻櫎璇?schema锛屽洜姝ょ粷涓嶈Е纰板懡鍚嶇┖闂村鐨勮〃銆? */

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AdminDatabase, AdminEntity } from '@veren/admin-contract'
import {
  PLATFORM_TABLES,
  createPostgresDatabase,
  createSqlRecordStore,
  ensureSchema,
  openPostgres,
} from '../src/index.ts'
import type { ResolvedConfig, SqlPool } from '../src/index.ts'

/** Loose record type for the integration fixtures. 闆嗘垚澶瑰叿浣跨敤鐨勫鏉捐褰曠被鍨嬨€?*/
type Row = AdminEntity & Record<string, unknown>

/** Connection URL; the suite self-skips when it is absent. 杩炴帴 URL锛涚己澶辨椂濂椾欢鑷姩璺宠繃銆?*/
const connectionUrl = process.env['VEREN_PG_TEST_URL'] ?? ''

/** Throwaway schema owned by this run. 鏈杩愯鎷ユ湁鐨勪竴娆℃€?schema銆?*/
const schema = `veren_it_${process.pid}_${Date.now()}`

/** Turn the test URL into resolved settings. 鎶婃祴璇?URL 杞负瑙ｆ瀽鍚庣殑璁剧疆銆?*/
function settings(): ResolvedConfig {
  const parsed = new URL(connectionUrl)
  return {
    host: parsed.hostname,
    port: parsed.port === '' ? 5432 : Number(parsed.port),
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.replace(/^\//, ''),
    schema,
    ssl: parsed.searchParams.get('sslmode') === 'require',
    maxConnections: 2,
    connectTimeoutMs: 10_000,
    migrateOnBoot: true,
  }
}

describe.skipIf(connectionUrl === '')('PostgreSQL integration (set VEREN_PG_TEST_URL)', () => {
  let pool: SqlPool | undefined

  /** Resolve the pool opened by `beforeAll`. 瑙ｆ瀽 `beforeAll` 鎵撳紑鐨勮繛鎺ユ睜銆?*/
  function connection(): SqlPool {
    if (pool === undefined) throw new Error('the integration pool is not open')
    return pool
  }

  beforeAll(async () => {
    pool = openPostgres(settings())
    await ensureSchema(pool, schema)
  })

  afterAll(async () => {
    const opened = pool
    if (opened === undefined) return
    try {
      await opened.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    } finally {
      await opened.close()
    }
  })

  it('creates every veren_ table and index idempotently', async () => {
    const tables = await connection().query(
      'SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name',
      [schema],
    )
    expect(tables.rows.map((row) => row['table_name'])).toEqual([
      ...PLATFORM_TABLES.map((table) => table.table).sort(),
      'veren_records',
    ].sort())

    const indexes = await connection().query('SELECT indexname FROM pg_indexes WHERE schemaname = $1', [schema])
    const names = indexes.rows.map((row) => row['indexname'])
    expect(names).toEqual(expect.arrayContaining([
      'veren_users_email_key',
      'veren_sessions_token_hash_key',
      'veren_tokens_secret_hash_key',
      'veren_bindings_user_role_key',
      'veren_audit_at_idx',
      'veren_records_collection_idx',
    ]))

    await expect(ensureSchema(connection(), schema)).resolves.toBeUndefined()
  })

  it('round-trips every platform collection and the fallback collection', async () => {
    const database = await createPostgresDatabase({ store: createSqlRecordStore(connection()) })
    const userId = randomUUID()
    const sessionId = randomUUID()
    const roleId = randomUUID()
    const bindingId = `${userId}:${roleId}`
    const tokenId = randomUUID()
    const auditId = randomUUID()
    const noteId = randomUUID()

    await database.table<Row>('admin_users').save({
      id: userId,
      email: 'owner@example.com',
      name: 'Owner',
      active: true,
      passwordHash: 'scrypt$hash',
      createdAt: '2026-10-20T00:00:00.000Z',
    })
    await database.table<Row>('admin_sessions').save({
      id: sessionId,
      userId,
      tokenHash: 'sha256-session',
      createdAt: '2026-10-20T00:00:00.000Z',
      expiresAt: '2026-10-27T00:00:00.000Z',
      lastSeenAt: '2026-10-20T00:00:00.000Z',
    })
    await database.table<Row>('admin_tokens').save({
      id: tokenId,
      userId,
      name: 'deploy',
      prefix: 'veren_ab',
      secretHash: 'sha256-token',
      scopes: ['admin.users.manage'],
      createdAt: '2026-10-20T00:00:00.000Z',
    })
    await database.table<Row>('admin_roles').save({
      id: roleId,
      label: 'Auditor',
      permissions: ['admin.audit.read'],
      createdAt: '2026-10-20T00:00:00.000Z',
    })
    await database.table<Row>('admin_bindings').save({
      id: bindingId,
      userId,
      roleId,
      createdAt: '2026-10-20T00:00:00.000Z',
    })
    await database.table<Row>('admin_audit').save({
      id: auditId,
      at: '2026-10-20T00:00:00.000Z',
      actorId: userId,
      actorLabel: 'Owner',
      action: 'auth.login',
      result: 'success',
      detail: { ip: '127.0.0.1' },
    })
    await database.table<Row>('notes').save({ id: noteId, text: 'fallback row' })

    const reloaded = await createPostgresDatabase({ store: createSqlRecordStore(connection()) })
    expect(reloaded.table('admin_users').find(userId)).toMatchObject({ email: 'owner@example.com', active: true })
    expect(reloaded.table('admin_sessions').find(sessionId)).toMatchObject({ tokenHash: 'sha256-session' })
    expect(reloaded.table('admin_tokens').find(tokenId)).toMatchObject({ scopes: ['admin.users.manage'] })
    expect(reloaded.table('admin_roles').find(roleId)).toMatchObject({ permissions: ['admin.audit.read'] })
    expect(reloaded.table('admin_bindings').find(bindingId)).toMatchObject({ userId, roleId })
    expect(reloaded.table('admin_audit').find(auditId)).toMatchObject({ result: 'success', detail: { ip: '127.0.0.1' } })
    expect(reloaded.table('notes').find(noteId)).toMatchObject({ text: 'fallback row' })

    const projected = await connection().query(
      'SELECT "email", "active", "data" FROM "veren_users" WHERE "id" = $1',
      [userId],
    )
    expect(projected.rows[0]).toMatchObject({ email: 'owner@example.com', active: true, data: { id: userId } })

    const fallback = await connection().query(
      'SELECT "collection", "data" FROM "veren_records" WHERE "id" = $1',
      [noteId],
    )
    expect(fallback.rows[0]).toMatchObject({ collection: 'notes', data: { id: noteId, text: 'fallback row' } })
  })

  it('commits and rolls back real transactions', async () => {
    const database: AdminDatabase = await createPostgresDatabase({ store: createSqlRecordStore(connection()) })
    const committed = randomUUID()
    const rolledBack = randomUUID()

    await database.transaction(async (uow) => {
      await uow.table<Row>('admin_users').save({ id: committed, email: 'kept@example.com', name: 'Kept', active: true })
    })
    await expect(database.transaction(async (uow) => {
      await uow.table<Row>('admin_users').save({ id: rolledBack, email: 'gone@example.com', name: 'Gone', active: true })
      throw new Error('rollback this one')
    })).rejects.toThrow('rollback this one')

    const rows = await connection().query('SELECT "id" FROM "veren_users" WHERE "id" = ANY($1::text[])', [[committed, rolledBack]])
    expect(rows.rows.map((row) => row['id'])).toEqual([committed])

    const reloaded = await createPostgresDatabase({ store: createSqlRecordStore(connection()) })
    expect(reloaded.table('admin_users').find(committed)).toMatchObject({ email: 'kept@example.com' })
    expect(reloaded.table('admin_users').find(rolledBack)).toBeUndefined()
  })
})
