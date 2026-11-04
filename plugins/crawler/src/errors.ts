/**
 * 结构化错误：稳定 code + 机器可读字段（design/errors.md 全局错误码表）。
 * Structured errors: stable codes plus machine-readable fields
 * (the global error-code table in design/errors.md).
 *
 * misconfiguration fails loud：未知枚举不允许静默回退到默认再继续落库。
 * Misconfiguration fails loud: unknown enums never silently fall back.
 *
 * @module @veren/crawler/errors
 */

import { PLATFORMS, SAVE_DATA_OPTIONS } from './constants.ts'
import type { CrawlerType, InitDbOption, LoginType, Platform, SaveDataOption } from './types.ts'

/** 全局错误码闭集 / the closed set of global error codes */
export type CrawlerErrorCode =
  | 'INVALID_PLATFORM'
  | 'INVALID_ARGUMENT'
  | 'INVALID_SAVE_OPTION'
  | 'INVALID_CACHE_TYPE'
  | 'CREDENTIAL_MISSING'
  | 'CREDENTIAL_INVALID'
  | 'LOGIN_TIMEOUT'
  | 'SESSION_EXPIRED'
  | 'RATE_LIMITED'
  | 'IP_BLOCKED'
  | 'PLATFORM_ACCESS_DENIED'
  | 'CONTENT_NOT_FOUND'
  | 'CRAWLER_ALREADY_RUNNING'
  | 'CRAWLER_NOT_RUNNING'
  | 'CRAWLER_EXIT_ERROR'
  | 'DATA_PATH_OUT_OF_ROOT'
  | 'DATA_FILE_NOT_FOUND'
  | 'ENV_CHECK_TIMEOUT'
  | 'MEDIA_DOWNLOAD_FAILED'
  | 'PROXY_FETCH_FAILED'
  | 'DB_CONNECT_FAILED'

/**
 * 带稳定错误码的结构化错误。
 * Structured error carrying a stable code and machine-readable fields.
 */
export class CrawlerError extends Error {
  /** 稳定错误码 / the stable error code */
  readonly code: CrawlerErrorCode
  /** 机器可读上下文 / machine-readable context fields */
  readonly fields: Readonly<Record<string, string>>

  constructor(code: CrawlerErrorCode, message: string, fields: Record<string, string> = {}) {
    super(message)
    this.name = 'CrawlerError'
    this.code = code
    this.fields = fields
  }
}

/** 全部合法平台值的展示串 / display string of all legal platforms */
export const SUPPORTED_PLATFORMS_TEXT = PLATFORMS.join('/')

/**
 * 平台标识未注册（工厂查表失败）。
 * Unknown platform identifier (factory lookup miss).
 */
export function invalidPlatform(platform: string): CrawlerError {
  return new CrawlerError('INVALID_PLATFORM', `不支持的平台: ${platform}，可选: ${SUPPORTED_PLATFORMS_TEXT}`, {
    platform,
    supported: SUPPORTED_PLATFORMS_TEXT,
  })
}

/** 参数非法 / invalid argument */
export function invalidArgument(field: string, value: string): CrawlerError {
  return new CrawlerError('INVALID_ARGUMENT', `参数 ${field} 取值非法: ${value}`, { field, value })
}

/** 保存介质未注册 / unknown save option */
export function invalidSaveOption(option: string): CrawlerError {
  return new CrawlerError('INVALID_SAVE_OPTION', `不支持的数据保存方式: ${option}`, { option })
}

/**
 * 枚举守卫：校验平台值，非法即抛 INVALID_PLATFORM。
 * Enum guard: validates a platform value, throwing INVALID_PLATFORM when unknown.
 */
export function assertPlatform(value: string): Platform {
  if (!(PLATFORMS as readonly string[]).includes(value)) throw invalidPlatform(value)
  return value as Platform
}

/** 登录方式守卫 / login type guard */
export function assertLoginType(value: string): LoginType {
  if (value !== 'qrcode' && value !== 'phone' && value !== 'cookie') throw invalidArgument('loginType', value)
  return value
}

/** 采集模式守卫 / crawler type guard */
export function assertCrawlerType(value: string): CrawlerType {
  if (value !== 'search' && value !== 'detail' && value !== 'creator') throw invalidArgument('crawlerType', value)
  return value
}

/** 保存介质守卫 / save option guard */
export function assertSaveOption(value: string): SaveDataOption {
  if (!(SAVE_DATA_OPTIONS as readonly string[]).includes(value)) throw invalidSaveOption(value)
  return value as SaveDataOption
}

/** 数据库初始化目标守卫 / init-db guard */
export function assertInitDb(value: string | null): InitDbOption | null {
  if (value === null) return null
  if (value !== 'sqlite' && value !== 'mysql' && value !== 'postgres') throw invalidArgument('initDb', value)
  return value
}
