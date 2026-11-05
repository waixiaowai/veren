import { describe, expect, it, vi } from 'vitest'
import {
  BaseDriver,
  CannotExecuteNotConnectedError,
  ColumnMetadata,
  EntityMetadata,
  getDriverDefinition,
  getRegisteredDriverTypes,
  hasDriver,
  MissingDriverError,
  MysqlDialect,
  PostgresDialect,
  QueryRunner,
  QueryRunnerAlreadyReleasedError,
  registerDriver,
  singleClientPool,
  SqliteDialect,
  TransactionAlreadyStartedError,
  TransactionNotStartedError,
  type DataSourceOptions,
  type SqlClient,
} from '../src/index.ts'

/** 录制型客户端。 / A recording client. */
class RecordingClient implements SqlClient {
  readonly statements: Array<{ sql: string; parameters: readonly unknown[] }> = []
  closed = false

  async query(sql: string, parameters: readonly unknown[] = []) {
    this.statements.push({ sql, parameters })
    return { rows: [], affected: 0 }
  }

  async close() {
    this.closed = true
  }
}

/** 构造一列用于值归一测试。 / Build a column for value-normalization tests. */
function makeColumn(type: 'boolean' | 'date' | 'json' | 'simple-array' | 'simple-json' | 'varchar'): ColumnMetadata {
  const metadata = new EntityMetadata({ targetName: 'T', tableName: 't' })
  return new ColumnMetadata(metadata, {
    propertyName: 'value',
    databaseName: 'value',
    type,
    options: { type },
    isPrimary: false,
  })
}

/** 构造一个可注入客户端的驱动。 / Build a driver with an injectable client. */
function makeDriver(options: DataSourceOptions, client: SqlClient): BaseDriver {
  return new BaseDriver(new SqliteDialect(), options, async () => singleClientPool(client))
}

describe('driver base', () => {
  it('opens the pool lazily and releases it once', async () => {
    const client = new RecordingClient()
    const driver = makeDriver({ type: 'sqlite' }, client)
    await expect(driver.acquireClient()).rejects.toBeInstanceOf(CannotExecuteNotConnectedError)
    await driver.initialize()
    await driver.initialize()
    expect(await driver.acquireClient()).toBe(client)
    await driver.releaseClient(client)
    await driver.destroy()
    await driver.destroy()
    expect(client.closed).toBe(true)
    await expect(driver.acquireClient()).rejects.toBeInstanceOf(CannotExecuteNotConnectedError)
  })

  it('normalizes values for write and read', () => {
    const sqlite = makeDriver({ type: 'sqlite' }, new RecordingClient())
    const postgres = new BaseDriver(new PostgresDialect(), { type: 'postgres' }, async () => singleClientPool(new RecordingClient()))

    expect(sqlite.preparePersistentValue(makeColumn('boolean'), true)).toBe(1)
    expect(postgres.preparePersistentValue(makeColumn('boolean'), true)).toBe(true)
    expect(sqlite.preparePersistentValue(makeColumn('json'), { a: 1 })).toBe('{"a":1}')
    expect(sqlite.preparePersistentValue(makeColumn('simple-array'), ['a', 'b'])).toBe('a,b')
    expect(sqlite.preparePersistentValue(makeColumn('varchar'), 'x')).toBe('x')
    expect(sqlite.preparePersistentValue(makeColumn('varchar'), null)).toBeNull()
    expect(sqlite.preparePersistentValue(makeColumn('varchar'), undefined)).toBeUndefined()

    const date = new Date('2024-01-02T03:04:05.000Z')
    expect(sqlite.preparePersistentValue(makeColumn('date'), date)).toBe('2024-01-02T03:04:05.000Z')
    expect(postgres.preparePersistentValue(makeColumn('date'), date)).toBe(date)

    expect(sqlite.prepareHydratedValue(makeColumn('boolean'), 1)).toBe(true)
    expect(sqlite.prepareHydratedValue(makeColumn('boolean'), true)).toBe(true)
    expect(sqlite.prepareHydratedValue(makeColumn('boolean'), 0)).toBe(false)
    expect(sqlite.prepareHydratedValue(makeColumn('json'), '{"a":1}')).toEqual({ a: 1 })
    expect(sqlite.prepareHydratedValue(makeColumn('json'), 'not-json')).toBe('not-json')
    expect(sqlite.prepareHydratedValue(makeColumn('simple-array'), 'a,b')).toEqual(['a', 'b'])
    expect(sqlite.prepareHydratedValue(makeColumn('date'), '2024-01-02T03:04:05.000Z')).toBeInstanceOf(Date)
    expect(sqlite.prepareHydratedValue(makeColumn('varchar'), null)).toBeNull()
  })

  it('applies column transformers on both sides', () => {
    const driver = makeDriver({ type: 'sqlite' }, new RecordingClient())
    const metadata = new EntityMetadata({ targetName: 'T', tableName: 't' })
    const column = new ColumnMetadata(metadata, {
      propertyName: 'value',
      databaseName: 'value',
      type: 'varchar',
      options: { type: 'varchar', transformer: { to: (value) => `to:${String(value)}`, from: (value) => `from:${String(value)}` } },
      isPrimary: false,
    })
    expect(driver.preparePersistentValue(column, 'x')).toBe('to:x')
    expect(driver.prepareHydratedValue(column, 'x')).toBe('from:x')
  })

  it('escapes identifiers and named parameters', () => {
    const driver = makeDriver({ type: 'sqlite' }, new RecordingClient())
    expect(driver.escape('select')).toBe('"select"')
    expect(driver.escapeQueryWithParameters('SELECT :id', { id: 1 })).toEqual(['SELECT ?', [1]])
    expect(() => driver.escapeQueryWithParameters('SELECT :id', {})).toThrow(/no value was provided/)
  })
})

describe('driver registry', () => {
  it('registers idempotently and reports unknown types', () => {
    const definition = { type: 'unit-test-driver', create: () => makeDriver({ type: 'unit-test-driver' }, new RecordingClient()) }
    registerDriver(definition)
    registerDriver({ ...definition, create: () => { throw new Error('must not replace') } })
    expect(hasDriver('unit-test-driver')).toBe(true)
    expect(getDriverDefinition('unit-test-driver').create).toBe(definition.create)
    expect(getRegisteredDriverTypes()).toContain('unit-test-driver')
    expect(() => getDriverDefinition('missing-unit-driver')).toThrow(MissingDriverError)
  })
})

describe('client pool', () => {
  it('returns the same single client and closes it once', async () => {
    const client = new RecordingClient()
    const pool = singleClientPool(client)
    expect(await pool.acquire()).toBe(client)
    await pool.release(client)
    await pool.close()
    expect(client.closed).toBe(true)
  })

  it('prefers an injected client and otherwise calls the fallback', async () => {
    const { poolFromOptions } = await import('../src/driver/driver.ts')
    const injected = new RecordingClient()
    const fromObject = await poolFromOptions({ type: 'x', client: injected }, async () => { throw new Error('fallback') })
    expect(await fromObject.acquire()).toBe(injected)

    const factory = vi.fn(async () => injected)
    const fromFactory = await poolFromOptions({ type: 'x', client: factory }, async () => { throw new Error('fallback') })
    expect(await fromFactory.acquire()).toBe(injected)
    expect(factory).toHaveBeenCalledTimes(1)

    const fallbackClient = new RecordingClient()
    const fromFallback = await poolFromOptions({ type: 'x' }, async () => singleClientPool(fallbackClient))
    expect(await fromFallback.acquire()).toBe(fallbackClient)
  })
})

describe('query runner', () => {
  it('manages connection and transaction state', async () => {
    const client = new RecordingClient()
    const driver = makeDriver({ type: 'sqlite' }, client)
    await driver.initialize()
    const runner = new QueryRunner(driver)
    await runner.connect()
    expect(runner.isTransactionActive).toBe(false)
    await runner.query('SELECT 1', [])
    expect(client.statements).toEqual([{ sql: 'SELECT 1', parameters: [] }])

    await expect(runner.commitTransaction()).rejects.toBeInstanceOf(TransactionNotStartedError)
    await runner.startTransaction()
    expect(runner.isTransactionActive).toBe(true)
    await expect(runner.startTransaction()).rejects.toBeInstanceOf(TransactionAlreadyStartedError)
    await runner.commitTransaction()
    expect(runner.isTransactionActive).toBe(false)

    await runner.startTransaction()
    await runner.rollbackTransaction()
    expect(runner.isTransactionActive).toBe(false)
    expect(client.statements.map((item) => item.sql)).toEqual(['SELECT 1', 'BEGIN', 'COMMIT', 'BEGIN', 'ROLLBACK'])
  })

  it('rolls back an active transaction on release and stays idempotent', async () => {
    const client = new RecordingClient()
    const driver = makeDriver({ type: 'sqlite' }, client)
    await driver.initialize()
    const runner = new QueryRunner(driver)
    await runner.connect()
    await runner.startTransaction()
    await runner.release()
    await runner.release()
    expect(client.statements.map((item) => item.sql)).toEqual(['BEGIN', 'ROLLBACK'])
    await expect(runner.query('SELECT 1')).rejects.toBeInstanceOf(QueryRunnerAlreadyReleasedError)
    expect(runner.isReleased).toBe(true)
  })

  it('wraps driver failures with the original error', async () => {
    const failing: SqlClient = { query: async () => { throw new Error('driver down') } }
    const driver = makeDriver({ type: 'sqlite' }, failing)
    await driver.initialize()
    const runner = new QueryRunner(driver)
    await expect(runner.query('SELECT 1')).rejects.toMatchObject({ code: 'QUERY_FAILED', driverError: expect.any(Error) })
  })
})

describe('dialect statements', () => {
  it('renders transaction statements per dialect', () => {
    expect(new SqliteDialect().beginStatements()).toEqual(['BEGIN'])
    expect(new PostgresDialect().beginStatements('SERIALIZABLE')).toEqual(['BEGIN ISOLATION LEVEL SERIALIZABLE'])
    expect(new MysqlDialect().beginStatements()).toEqual(['START TRANSACTION'])
    expect(new MysqlDialect().beginStatements('READ COMMITTED')).toEqual([
      'SET TRANSACTION ISOLATION LEVEL READ COMMITTED',
      'START TRANSACTION',
    ])
    expect(new SqliteDialect().capabilities.savepoints).toBe(true)
    expect(new PostgresDialect().supportsType('jsonb')).toBe(true)
    expect(new MysqlDialect().nowExpression).toBe('CURRENT_TIMESTAMP')
  })
})
