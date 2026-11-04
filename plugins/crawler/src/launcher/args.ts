/**
 * 启动参数解析与校验（design/modules/launcher.md 契约 + api.md 请求体）。
 * Launch argument parsing and validation (the launcher contract in
 * design/modules/launcher.md plus the start-request body in design/api.md).
 *
 * 枚举非法直接抛错（fail loud）——存储只认宿主 storageDomain 后，文件/
 * 数据库时代的 saveDataOption、initDb、saveDataPath 已随介质一起移除。
 * Illegal enums throw (fail loud) — with storage being the host
 * storageDomain only, the file/db-era saveDataOption, initDb and
 * saveDataPath went away together with the media.
 *
 * @module @veren/crawler/launcher/args
 */
import { PLATFORMS } from '../constants.ts'
import {
  assertCrawlerType,
  assertLoginType,
  assertPlatform,
  invalidArgument,
} from '../errors.ts'
import type { CommandArgs, CrawlerType, LoginType, Platform } from '../types.ts'

/** 解析输入：部分字段缺失时以默认值补齐 / the parse input: missing fields fall back to defaults */
export interface RawCommandArgs {
  platform: string
  loginType: string
  crawlerType: string
  keywords?: string[]
  specifiedId?: string[]
  creatorId?: string[]
  startPage?: number
  getComment: boolean
  getSubComment: boolean
  getMedia: boolean
  cookies: string | null
  headless: boolean
  crawlerMaxNotesCount?: number
  maxCommentsCountSingleNotes?: number
  maxConcurrencyNum?: number
  enableIpProxy?: boolean
  ipProxyPoolCount?: number
  ipProxyProviderName?: string
  staticProxyUrl?: string | null
}

/** 默认值（与 config DEFAULT_CONFIG 对齐）/ defaults (aligned with DEFAULT_CONFIG in config) */
export interface ArgDefaults {
  loginType: LoginType
  crawlerType: CrawlerType
  platform: Platform
}

/** 正整数守卫：非正或不给默认 1 / positive-int guard: non-positive or missing defaults to 1 */
function positiveInt(value: number | undefined, field: string): number {
  if (value === undefined) return 1
  if (!Number.isInteger(value) || value < 1) throw invalidArgument(field, String(value))
  return value
}

/** 非空字符串数组守卫 / non-empty string array guard */
function requireNonEmpty(value: string[] | undefined, field: string): string[] {
  if (value === undefined || value.length === 0) throw invalidArgument(field, '[]')
  return value
}

/** 模式专属必填项校验 / mode-specific required-field validation */
function requireModeFields(args: CommandArgs): void {
  if (args.crawlerType === 'search') requireNonEmpty(args.keywords, 'keywords')
  if (args.crawlerType === 'detail') requireNonEmpty(args.specifiedId, 'specifiedId')
  if (args.crawlerType === 'creator') requireNonEmpty(args.creatorId, 'creatorId')
}

/** cookie 登录必填凭证 / cookie login requires the credential string */
function requireCredential(args: CommandArgs): void {
  if (args.loginType === 'cookie' && (args.cookies === null || args.cookies.length === 0)) {
    throw invalidArgument('cookies', 'null')
  }
}

/**
 * 解析并校验启动参数：枚举守卫 + 模式必填项 + cookie 凭证 + 正整数。
 * Parses and validates the launch arguments: enum guards, mode-specific
 * required fields, the cookie credential, and positive-int checks.
 */
export function resolveCommandArgs(raw: RawCommandArgs, defaults: ArgDefaults): CommandArgs {
  const args: CommandArgs = {
    platform: assertPlatform(raw.platform),
    loginType: assertLoginType(raw.loginType || defaults.loginType),
    crawlerType: assertCrawlerType(raw.crawlerType || defaults.crawlerType),
    keywords: raw.keywords ?? [],
    specifiedId: raw.specifiedId ?? [],
    creatorId: raw.creatorId ?? [],
    startPage: positiveInt(raw.startPage, 'startPage'),
    getComment: raw.getComment,
    getSubComment: raw.getSubComment,
    getMedia: raw.getMedia,
    cookies: raw.cookies ?? null,
    headless: raw.headless,
    crawlerMaxNotesCount: positiveInt(raw.crawlerMaxNotesCount, 'crawlerMaxNotesCount'),
    maxCommentsCountSingleNotes: positiveInt(raw.maxCommentsCountSingleNotes, 'maxCommentsCountSingleNotes'),
    maxConcurrencyNum: positiveInt(raw.maxConcurrencyNum, 'maxConcurrencyNum'),
    enableIpProxy: raw.enableIpProxy ?? false,
    ipProxyPoolCount: positiveInt(raw.ipProxyPoolCount, 'ipProxyPoolCount'),
    ipProxyProviderName: raw.ipProxyProviderName === undefined ? 'static' : assertProxyProvider(raw.ipProxyProviderName),
    staticProxyUrl: raw.staticProxyUrl ?? null,
  }
  requireModeFields(args)
  requireCredential(args)
  return args
}

/** 代理服务商守卫 / proxy provider guard */
function assertProxyProvider(value: string): CommandArgs['ipProxyProviderName'] {
  if (value === 'kuaidaili' || value === 'wandouhttp' || value === 'static') return value
  throw invalidArgument('ipProxyProviderName', value)
}

/** 是否为合法平台值（CLI 告警回退用）/ whether the value is a legal platform (for CLI fallback) */
export function isLegalPlatform(value: string): boolean {
  return (PLATFORMS as readonly string[]).includes(value)
}
