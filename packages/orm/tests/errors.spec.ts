import { describe, expect, it } from 'vitest'
import {
  CannotCreateEntityIdMapError,
  CannotExecuteNotConnectedError,
  CircularRelationsError,
  ColumnTypeUndefinedError,
  DriverOptionNotSetError,
  DriverPackageNotInstalledError,
  DuplicateMetadataError,
  EmptyCriteriaError,
  EntityMetadataNotFoundError,
  EntityNotFoundError,
  EntityPropertyNotFoundError,
  InvalidMetadataError,
  MigrationError,
  MissingDeleteDateColumnError,
  MissingDriverError,
  MissingPrimaryColumnError,
  OptimisticLockVersionMismatchError,
  OrmError,
  QueryFailedError,
  QueryRunnerAlreadyReleasedError,
  SchemaSyncError,
  TransactionAlreadyStartedError,
  TransactionNotStartedError,
  UnsupportedDataTypeError,
  UnsupportedFeatureError,
} from '../src/index.ts'

/** 每个错误都断言 code、name 与消息三要素。 / Assert code, name and message for every error. */
function expectError(error: OrmError, code: string, name: string): void {
  expect(error).toBeInstanceOf(OrmError)
  expect(error.code).toBe(code)
  expect(error.name).toBe(name)
  expect(error.message.length).toBeGreaterThan(0)
}

describe('error taxonomy', () => {
  it('keeps query failures structured with the original driver error', () => {
    const driverError = new Error('syntax error')
    const error = new QueryFailedError('SELECT :id', [1, 2], driverError)
    expectError(error, 'QUERY_FAILED', 'QueryFailedError')
    expect(error.query).toBe('SELECT :id')
    expect(error.parameters).toEqual([1, 2])
    expect(error.driverError).toBe(driverError)
    expect(error.message).toContain('syntax error')
  })

  it('truncates very long parameter summaries', () => {
    const error = new QueryFailedError('SELECT 1', ['x'.repeat(600)], 'boom')
    expect(error.message).toContain('…')
    expect(error.message.length).toBeLessThan(600)
  })

  it('formats non-Error driver failures without throwing', () => {
    const error = new QueryFailedError('SELECT 1', [], { code: 'X' })
    expect(error.message).toContain('Object')
    expect(error.driverError).toEqual({ code: 'X' })
  })

  it('exposes stable codes for lifecycle and driver failures', () => {
    expectError(new QueryRunnerAlreadyReleasedError(), 'QUERY_RUNNER_RELEASED', 'QueryRunnerAlreadyReleasedError')
    expectError(new TransactionAlreadyStartedError(), 'TRANSACTION_ALREADY_STARTED', 'TransactionAlreadyStartedError')
    expectError(new TransactionNotStartedError(), 'TRANSACTION_NOT_STARTED', 'TransactionNotStartedError')
    expectError(new MissingDriverError('duck', ['sqlite', 'postgres']), 'MISSING_DRIVER', 'MissingDriverError')
    expectError(new DriverPackageNotInstalledError('pg'), 'DRIVER_PACKAGE_NOT_INSTALLED', 'DriverPackageNotInstalledError')
    expectError(new DriverOptionNotSetError('url'), 'DRIVER_OPTION_NOT_SET', 'DriverOptionNotSetError')
    expectError(new UnsupportedDataTypeError('geometry', 'sqlite'), 'UNSUPPORTED_DATA_TYPE', 'UnsupportedDataTypeError')
    expectError(new CannotExecuteNotConnectedError(), 'CANNOT_EXECUTE_NOT_CONNECTED', 'CannotExecuteNotConnectedError')
    expectError(new UnsupportedFeatureError('Locks'), 'UNSUPPORTED_FEATURE', 'UnsupportedFeatureError')
  })

  it('exposes stable codes for metadata and persistence failures', () => {
    expectError(new MissingPrimaryColumnError('User'), 'MISSING_PRIMARY_COLUMN', 'MissingPrimaryColumnError')
    expectError(new ColumnTypeUndefinedError('User', 'name'), 'COLUMN_TYPE_UNDEFINED', 'ColumnTypeUndefinedError')
    expectError(new DuplicateMetadataError('users'), 'DUPLICATE_METADATA', 'DuplicateMetadataError')
    expectError(new CircularRelationsError('oops'), 'CIRCULAR_RELATIONS', 'CircularRelationsError')
    expectError(new InvalidMetadataError('bad'), 'INVALID_METADATA', 'InvalidMetadataError')
    expectError(new EmptyCriteriaError('delete'), 'EMPTY_CRITERIA', 'EmptyCriteriaError')
    expectError(new EntityPropertyNotFoundError('age', 'User'), 'ENTITY_PROPERTY_NOT_FOUND', 'EntityPropertyNotFoundError')
    expectError(new CannotCreateEntityIdMapError('User'), 'CANNOT_CREATE_ENTITY_ID', 'CannotCreateEntityIdMapError')
    expectError(new MissingDeleteDateColumnError('User'), 'MISSING_DELETE_DATE_COLUMN', 'MissingDeleteDateColumnError')
    expectError(new OptimisticLockVersionMismatchError('User', 2, 3), 'OPTIMISTIC_LOCK_MISMATCH', 'OptimisticLockVersionMismatchError')
    expectError(new EntityNotFoundError('User', '{"id":1}'), 'ENTITY_NOT_FOUND', 'EntityNotFoundError')
    expectError(new EntityMetadataNotFoundError('User'), 'ENTITY_METADATA_NOT_FOUND', 'EntityMetadataNotFoundError')
  })

  it('keeps schema and migration causes attached', () => {
    const cause = new Error('ddl failed')
    const schema = new SchemaSyncError('sync failed', { cause })
    expectError(schema, 'SCHEMA_SYNC_FAILED', 'SchemaSyncError')
    expect(schema.cause).toBe(cause)

    const migration = new MigrationError('AddUsers1712345678901', 'boom')
    expectError(migration, 'MIGRATION_FAILED', 'MigrationError')
    expect(migration.migrationName).toBe('AddUsers1712345678901')
    expect(migration.message).toContain('AddUsers1712345678901')
  })

  it('keeps messages actionable and includes the offending values', () => {
    expect(new MissingDriverError('x', ['mysql']).message).toContain('Registered types: mysql')
    expect(new DriverPackageNotInstalledError('pg').message).toContain('pnpm add pg')
    expect(new EntityPropertyNotFoundError('age', 'User').message).toContain('User')
    expect(new EmptyCriteriaError('update').message).toContain('non-empty criteria')
    expect(new OptimisticLockVersionMismatchError('User', 1, 2).message).toContain('expected 1')
  })
})
