/**
 * 启动参数解析与校验（design/modules/launcher.md 契约 + api.md 请求体）。
 * Launch argument parsing and validation (the launcher contract in
 * design/modules/launcher.md plus the start-request body in design/api.md).
 *
 * 枚举非法在 CLI 路径告警后回退默认（不中断进程）；API 路径与未知平台
 * 一律抛错——意图分离：自动化脚本不因小笔误中断，服务接口则 fail loud。
 * Illegal enums fall back to defaults on the CLI path (process continues);
 * the API path and unknown platforms throw — automation scripts survive
 * typos while service interfaces fail loud.
 *
 * @module @veren/crawler/launcher/args
 */
import { PLATFORMS } from '../constants.ts'
import {
  assertCrawlerType,
  assertInitDb,
  assertLoginType,
  assertPlatform,
  assertSaveOption,
  invalidArgument,
} from '../errors.ts'
import type { CommandArgs, CrawlerType, LoginType, Platform, SaveDataOption } from '../types.ts'

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
  saveDataOption: string
  cookies: string | null
  headless: boolean
  crawlerMaxNotesCount?: number
  maxCommentsCountSingleNotes?: number
  maxConcurrencyNum?: number
  initDb?: string | null
  saveDataPath: string
  enableIpProxy?: boolean
  ipProxyPoolCount?: number
  ipProxyProviderName?: string
  staticProxyUrl?: string | null
}

/** 默认值（与 config DEFAULT_CONFIG 对齐）/ defaults (aligned with DEFAULT_CONFIG in config) */
export interface ArgDefaults {
  loginType: LoginType
  crawlerType: CrawlerType
  saveDataOption: SaveDataOption
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
 * 解析并校验启动参数。枚举非法直接抛错（API 语义）；CLI 告警回退由
 * 调用方捕获 CrawlerError 后回退重调。
 * Parses and validates the launch arguments. Illegal enums throw (API
 * semantics); the CLI path catches the CrawlerError, warns and retries
 * with the defaulted field.
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
    saveDataOption: assertSaveOption(raw.saveDataOption || defaults.saveDataOption),
    cookies: raw.cookies ?? null,
    headless: raw.headless,
    crawlerMaxNotesCount: positiveInt(raw.crawlerMaxNotesCount, 'crawlerMaxNotesCount'),
    maxCommentsCountSingleNotes: positiveInt(raw.maxCommentsCountSingleNotes, 'maxCommentsCountSingleNotes'),
    maxConcurrencyNum: positiveInt(raw.maxConcurrencyNum, 'maxConcurrencyNum'),
    initDb: assertInitDb(raw.initDb ?? null),
    saveDataPath: raw.saveDataPath,
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
