/**
 * Plugin declaration and lifecycle: config defaults and validation, manifest
 * priority, registration through the kernel, and disposal.
 *
 * The SQL transport is a recording pool, so the test drives the real plugin
 * registration path without opening a socket.
 *
 * 插件声明与生命周期：配置默认值与校验、manifest 优先级、经内核注册以及卸载。SQL 传输
 * 使用记录型连接池，因此测试驱动真实插件注册路径而无需打开套接字。
 */

import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { AdminKernel } from '@veren/admin-kernel'
import { createPostgresDatabase } from '../src/adapter.ts'
import {
  Config,
  DEFAULT_POSTGRES_CONFIG,
  MANIFEST,
  inject,
  name,
  registerDataProvider,
  resolveConfig,
  serveData,
} from '../src/plugin.ts'
import { createSqlRecordStore } from '../src/store.ts'
import { FakeSqlPool } from './fake-sql.ts'

/** One booted context with its kernel. 一个已装好的上下文及其内核。 */
interface Booted {
  readonly ctx: Context
  readonly kernel: AdminKernel
}

/** Mount the kernel on a fresh root context. 在全新根上下文上挂载内核。 */
function boot(): Booted {
  const ctx = new Context()
  return { ctx, kernel: new AdminKernel(ctx, { essential: [] }) }
}

describe('plugin declaration', () => {
  it('declares the data capability with a higher priority than the KV fallback', () => {
    expect(name).toBe('admin-data-postgres')
    expect([...inject]).toEqual(['admin'])
    expect(MANIFEST).toMatchObject({
      id: 'postgres',
      capability: 'data',
      contract: '^1.0',
      priority: 10,
      dataDomain: 'veren_admin',
    })
  })

  it('defaults every connection field and keeps them overridable', () => {
    const defaults = Config({})
    expect(defaults).toMatchObject(DEFAULT_POSTGRES_CONFIG)
    const overridden = resolveConfig({
      host: ' pg.internal ',
      port: 6543,
      user: 'admin',
      password: 'secret',
      database: 'admin_db',
      schema: 'veren',
      ssl: true,
      maxConnections: 4,
      connectTimeoutMs: 30_000,
      migrateOnBoot: false,
    })
    expect(overridden).toEqual({
      host: 'pg.internal',
      port: 6543,
      user: 'admin',
      password: 'secret',
      database: 'admin_db',
      schema: 'veren',
      ssl: true,
      maxConnections: 4,
      connectTimeoutMs: 30_000,
      migrateOnBoot: false,
    })
  })

  it('fails loud on an empty connection field or an unsafe schema', () => {
    expect(() => resolveConfig({ database: '   ' })).toThrow(/config\.database/)
    expect(() => resolveConfig({ schema: 'public; DROP SCHEMA public' })).toThrow(/config\.schema/)
    expect(() => resolveConfig({ port: 0 })).toThrow(/config\.port/)
  })
})

describe('plugin lifecycle', () => {
  it('bootstraps, registers and serves records through the kernel façade', async () => {
    const { ctx, kernel } = boot()
    const pool = new FakeSqlPool()

    await serveData(ctx, pool, { schema: 'public', migrateOnBoot: true })

    expect(kernel.has('data')).toBe(true)
    expect(pool.queries.some((query) => query.sql.includes('CREATE TABLE IF NOT EXISTS "veren_users"'))).toBe(true)

    const notes = ctx.adminData.table<{ readonly id: string, readonly text: string }>('notes')
    await notes.save({ id: 'n1', text: 'ok' })
    expect(notes.find('n1')).toMatchObject({ text: 'ok' })
    expect(pool.queries.some((query) => query.sql.includes('INSERT INTO "veren_records"'))).toBe(true)
    await expect(kernel.refreshHealth()).resolves.toMatchObject({ backends: [{ name: 'data', health: { status: 'ok' } }] })

    await ctx.fiber.dispose()
    expect(kernel.has('data')).toBe(false)
  })

  it('skips DDL when migrateOnBoot is false', async () => {
    const { ctx, kernel } = boot()
    const pool = new FakeSqlPool()

    await serveData(ctx, pool, { schema: 'public', migrateOnBoot: false })

    expect(kernel.has('data')).toBe(true)
    expect(pool.queries.some((query) => query.sql.startsWith('CREATE TABLE'))).toBe(false)
    await ctx.fiber.dispose()
  })

  it('removes the registration through the returned disposer', async () => {
    const { ctx, kernel } = boot()
    const pool = new FakeSqlPool()
    const database = await createPostgresDatabase({ store: createSqlRecordStore(pool) })

    const dispose = registerDataProvider(ctx, database)
    expect(kernel.has('data')).toBe(true)

    dispose()
    expect(kernel.has('data')).toBe(false)
  })
})
