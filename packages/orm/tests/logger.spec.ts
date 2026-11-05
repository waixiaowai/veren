import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ConsoleLogger,
  createLogger,
  NoopLogger,
  resolveLevels,
} from '../src/index.ts'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('logger', () => {
  it('normalizes logging switches', () => {
    expect(resolveLevels(true).size).toBe(7)
    expect(resolveLevels('all').has('migration')).toBe(true)
    expect(resolveLevels(['query', 'error'])).toEqual(new Set(['query', 'error']))
    expect(resolveLevels(false).size).toBe(0)
    expect(resolveLevels(undefined).size).toBe(0)
  })

  it('filters console output by level', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const logger = new ConsoleLogger(new Set(['query', 'warn']))

    logger.logQuery('SELECT 1', [1])
    logger.logQuery('SELECT 2')
    logger.logQueryError('boom', 'SELECT 3', [])
    logger.logQuerySlow(12, 'SELECT 4')
    logger.logSchemaBuild('schema')
    logger.logMigration('migration')
    logger.log('info', 'info')

    expect(log).toHaveBeenCalledTimes(2)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(error).not.toHaveBeenCalled()
  })

  it('emits all five categories when every level is enabled', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const logger = new ConsoleLogger(new Set(['query', 'schema', 'migration', 'warn', 'error', 'log']))

    logger.logQuery('SELECT 1', [])
    logger.logQueryError('boom', 'SELECT 2', [1])
    logger.logQuerySlow(5, 'SELECT 3', [])
    logger.logSchemaBuild('schema')
    logger.logMigration('migration')
    logger.log('log', 'plain')

    expect(log).toHaveBeenCalledTimes(4)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(error).toHaveBeenCalledTimes(1)
  })

  it('truncates long parameter lists', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    new ConsoleLogger(new Set(['query'])).logQuery('SELECT 1', ['x'.repeat(600)])
    expect(String(log.mock.calls[0]?.[0])).toContain('…')
  })

  it('builds the logger from options', () => {
    expect(createLogger({ type: 'sqlite' })).toBeInstanceOf(ConsoleLogger)
    expect(createLogger({ type: 'sqlite', logger: false })).toBeInstanceOf(NoopLogger)
    const custom = new NoopLogger()
    expect(createLogger({ type: 'sqlite', logger: custom })).toBe(custom)
  })

  it('keeps the silent logger silent and safe', () => {
    const logger = new NoopLogger()
    expect(() => {
      logger.logQuery('SELECT 1')
      logger.logQueryError('e', 'q')
      logger.logQuerySlow(1, 'q')
      logger.logSchemaBuild('s')
      logger.logMigration('m')
      logger.log('warn', 'w')
    }).not.toThrow()
  })
})
