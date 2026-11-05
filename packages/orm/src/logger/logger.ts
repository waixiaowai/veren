/**
 * 日志面：查询、慢查询、模式、迁移与通用三级共六类出口。
 * 默认实现只写 console，不含 ANSI——管道与 Workers 日志都不会被转义码污染。
 *
 * The logging face: six outlets for queries, slow queries, schema builds,
 * migrations and generic levels. The default writes to console without ANSI, so
 * piped logs and Workers logs stay free of escape codes.
 *
 * @module @veren/orm/logger
 */

import type { DataSourceOptions, LogLevel } from '../types.ts'

/** 日志器契约。 / The logger contract. */
export interface Logger {
  logQuery(query: string, parameters?: readonly unknown[]): void
  logQueryError(error: string, query: string, parameters?: readonly unknown[]): void
  logQuerySlow(time: number, query: string, parameters?: readonly unknown[]): void
  logSchemaBuild(message: string): void
  logMigration(message: string): void
  log(level: 'log' | 'info' | 'warn', message: string): void
}

/** 安静日志器：显式 `logger: false` 时使用。 / The silent logger used by `logger: false`. */
export class NoopLogger implements Logger {
  logQuery(_query?: string, _parameters?: readonly unknown[]): void {}
  logQueryError(_error?: string, _query?: string, _parameters?: readonly unknown[]): void {}
  logQuerySlow(_time?: number, _query?: string, _parameters?: readonly unknown[]): void {}
  logSchemaBuild(_message?: string): void {}
  logMigration(_message?: string): void {}
  log(_level?: 'log' | 'info' | 'warn', _message?: string): void {}
}

/** 控制台日志器；级别由 `logging` 配置决定。 / Console logger; levels come from the `logging` option. */
export class ConsoleLogger implements Logger {
  constructor(private readonly levels: ReadonlySet<LogLevel>) {}

  logQuery(query: string, parameters: readonly unknown[] = []): void {
    if (!this.levels.has('query')) return
    console.log(`[orm] query: ${query}${parameters.length === 0 ? '' : ` -- params: ${format(parameters)}`}`)
  }

  logQueryError(error: string, query: string, parameters: readonly unknown[] = []): void {
    if (!this.levels.has('error')) return
    console.error(`[orm] query failed: ${error}\n[orm] sql: ${query}${parameters.length === 0 ? '' : ` -- params: ${format(parameters)}`}`)
  }

  logQuerySlow(time: number, query: string, parameters: readonly unknown[] = []): void {
    if (!this.levels.has('warn')) return
    console.warn(`[orm] slow query (${time}ms): ${query}${parameters.length === 0 ? '' : ` -- params: ${format(parameters)}`}`)
  }

  logSchemaBuild(message: string): void {
    if (!this.levels.has('schema')) return
    console.log(`[orm] schema: ${message}`)
  }

  logMigration(message: string): void {
    if (!this.levels.has('migration')) return
    console.log(`[orm] migration: ${message}`)
  }

  log(level: 'log' | 'info' | 'warn', message: string): void {
    if (!this.levels.has(level)) return
    console[level](`[orm] ${message}`)
  }
}

/** 按配置装配日志器；自定义实例原样返回。 / Build the logger from options; a custom instance passes through. */
export function createLogger(options: DataSourceOptions): Logger {
  if (options.logger === false) return new NoopLogger()
  if (options.logger !== undefined) return options.logger
  return new ConsoleLogger(resolveLevels(options.logging))
}

/** 日志级别归一：true / "all" / 数组。 / Normalize logging: true / "all" / an array. */
export function resolveLevels(logging: DataSourceOptions['logging']): ReadonlySet<LogLevel> {
  if (logging === true || logging === 'all') {
    return new Set<LogLevel>(['query', 'schema', 'error', 'warn', 'info', 'log', 'migration'])
  }
  if (Array.isArray(logging)) return new Set(logging)
  return new Set<LogLevel>()
}

/** 参数摘要；长值截断。 / Parameter summary with long values truncated. */
function format(parameters: readonly unknown[]): string {
  const text = parameters.map((value) => (typeof value === 'string' ? `'${value}'` : String(value))).join(', ')
  return text.length > 500 ? `${text.slice(0, 500)}…` : text
}
