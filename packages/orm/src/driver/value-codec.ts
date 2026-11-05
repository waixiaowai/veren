/**
 * 值编解码：把同一份实体值转成各方言能绑定的表示，读回时再还原。
 * 方言只提供布尔/日期的少量规则，公共的 JSON、数组、decimal、blob 逻辑在这里。
 *
 * Value codec: translate one entity value into a dialect-bindable representation
 * and restore it on read. A dialect supplies only boolean/date rules; the shared
 * JSON, array, decimal and blob logic lives here.
 *
 * @module @veren/orm/driver/value-codec
 */

import type { ColumnMetadata } from '../metadata/entity-metadata.ts'
import type { ColumnType } from '../types.ts'

/** 实体值编解码器。 / Entity value codec. */
export interface ValueCodec {
  encode(column: ColumnMetadata, value: unknown): unknown
  decode(column: ColumnMetadata, value: unknown): unknown
}

/** 方言特有的布尔/日期规则。 / Dialect-specific boolean/date rules. */
export interface ValueCodecRules {
  encodeBoolean(value: boolean): unknown
  encodeDate(value: Date): unknown
  encodeDateTime(value: Date): unknown
  decodeDate(value: unknown): unknown
  decodeDateTime(value: unknown): unknown
}

/** 日期类列。 / Date-like columns. */
export const DATE_TYPES = new Set<ColumnType>(['date', 'datetime', 'timestamp'])

/** 通用编解码器；方言通过规则注入差异。 / Generic codec; a dialect injects differences through rules. */
export class ConfigurableValueCodec implements ValueCodec {
  constructor(private readonly rules: ValueCodecRules) {}

  encode(column: ColumnMetadata, value: unknown): unknown {
    if (value === null || value === undefined) return value
    if (column.type === 'boolean') return this.rules.encodeBoolean(isTruthy(value))
    if (DATE_TYPES.has(column.type)) return this.encodeDate(column.type, value)
    if (typeof value === 'bigint') return value.toString()
    if (typeof value === 'boolean') return value ? 1 : 0
    if (column.type === 'json' || column.type === 'jsonb' || column.type === 'simple-json') {
      return typeof value === 'string' ? value : JSON.stringify(value)
    }
    if (column.type === 'simple-array') return Array.isArray(value) ? value.join(',') : value
    return value
  }

  decode(column: ColumnMetadata, value: unknown): unknown {
    if (value === null || value === undefined) return value
    if (column.type === 'boolean') return isTruthy(value)
    if (column.type === 'decimal') return canonicalDecimal(value)
    if (column.type === 'bigint') return String(value)
    if (column.type === 'json' || column.type === 'jsonb' || column.type === 'simple-json') {
      return parseJson(value)
    }
    if (column.type === 'simple-array') return typeof value === 'string' ? value.split(',') : value
    if (column.type === 'blob' && value instanceof Uint8Array) return new Uint8Array(value)
    if (column.type === 'date') return this.rules.decodeDate(value)
    if (DATE_TYPES.has(column.type)) return this.rules.decodeDateTime(value)
    return value
  }

  /** 日期字符串先解析，再交给方言规则。 / Parse date strings first, then apply the dialect rule. */
  private encodeDate(type: ColumnType, value: unknown): unknown {
    if (typeof value === 'string') {
      const parsed = parsePortableDate(value)
      if (!Number.isNaN(parsed.getTime())) return this.encodeDate(type, parsed)
      return value
    }
    if (!(value instanceof Date)) return value
    return type === 'date' ? this.rules.encodeDate(value) : this.rules.encodeDateTime(value)
  }
}

/** 标准 SQL 规则（布尔原样、日期原样）。 / Standard SQL rules (booleans/dates as-is). */
export const STANDARD_RULES: ValueCodecRules = {
  encodeBoolean: (value) => value,
  encodeDate: dateOnly,
  encodeDateTime: (value) => value,
  decodeDate: (value) => decodeDate(value, true),
  decodeDateTime: decodeDateTime,
}

/** SQLite 规则：布尔 0/1，datetime ISO 文本，date 只存日历日。 / SQLite rules: 0/1 booleans, ISO datetime text, calendar-only dates. */
export const SQLITE_RULES: ValueCodecRules = {
  encodeBoolean: (value) => value ? 1 : 0,
  encodeDate: dateOnly,
  encodeDateTime: (value) => value.toISOString(),
  decodeDate: (value) => decodeDate(value, true),
  decodeDateTime: decodeDateTime,
}

/** PostgreSQL 规则：布尔原生，日期交给 pg，datetime 为 timestamptz。 / PostgreSQL rules: native booleans, pg dates, timestamptz datetimes. */
export const POSTGRES_RULES: ValueCodecRules = {
  encodeBoolean: (value) => value,
  encodeDate: dateOnly,
  encodeDateTime: (value) => value,
  decodeDate: (value) => decodeDate(value, false),
  decodeDateTime: decodeDateTime,
}

/** MySQL 规则：布尔 0/1，datetime 为 UTC 文本。 / MySQL rules: 0/1 booleans, UTC datetime text. */
export const MYSQL_RULES: ValueCodecRules = {
  encodeBoolean: (value) => value ? 1 : 0,
  encodeDate: dateOnly,
  encodeDateTime: formatMysqlDate,
  decodeDate: (value) => decodeDate(value, false),
  decodeDateTime: decodeDateTime,
}

/** 日历日文本 `YYYY-MM-DD`。 / Calendar-day text. */
export function dateOnly(value: Date): string {
  return value.toISOString().slice(0, 10)
}

/** MySQL DATETIME 文本：`YYYY-MM-DD HH:mm:ss.SSS`（UTC）。 / MySQL DATETIME text (UTC). */
export function formatMysqlDate(value: Date): string {
  return value.toISOString().slice(0, 23).replace('T', ' ')
}

/** 解析三种库的日期文本；无时区的 MySQL DATETIME 按 UTC。 / Parse date text; a zoneless MySQL DATETIME is UTC. */
export function parsePortableDate(value: string): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(`${value}T00:00:00.000Z`)
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(value)) {
    return new Date(`${value.replace(' ', 'T')}Z`)
  }
  return new Date(value)
}

/** 去尾零的十进制文本。 / Decimal text without trailing zeros. */
export function canonicalDecimal(value: unknown): string {
  const text = String(value)
  if (!/^-?\d+(\.\d+)?$/.test(text)) return text
  return text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text
}

/** 布尔归一：兼容 true/false、1/0、"1"/"0"/"true"。 / Boolean normalization. */
function isTruthy(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'true'
}

/** JSON 文本解析；无效文本原样返回。 / Parse JSON text; invalid text returns as-is. */
function parseJson(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

/** DATE 读取：字符串按 UTC；Date 按驱动是否本地午夜还原。 / DATE read: strings are UTC; Date uses local or UTC components. */
function decodeDate(value: unknown, utc: boolean): unknown {
  if (typeof value === 'string') return parsePortableDate(value.slice(0, 10))
  if (!(value instanceof Date)) return value
  const year = utc ? value.getUTCFullYear() : value.getFullYear()
  const month = utc ? value.getUTCMonth() : value.getMonth()
  const day = utc ? value.getUTCDate() : value.getDate()
  return new Date(Date.UTC(year, month, day))
}

/** DATETIME 读取：Date 原样，字符串按 UTC。 / DATETIME read: Date as-is, strings as UTC. */
function decodeDateTime(value: unknown): unknown {
  if (value instanceof Date) return value
  return typeof value === 'string' ? parsePortableDate(value) : value
}
