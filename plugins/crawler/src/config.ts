/**
 * 插件配置：使用 @deepseek-ai/schemastery 定义（仓库铁律）。
 * Plugin configuration defined with @deepseek-ai/schemastery (house rule).
 *
 * 配置只承载默认值与开关；每次采集任务的参数以启动请求为准（design/api.md）。
 * Configuration carries defaults and switches only; per-task arguments come
 * from the start request (design/api.md).
 *
 * @module @veren/crawler/config
 */
import z from '@deepseek-ai/schemastery'
import { CRAWLER_TYPES, LOGIN_TYPES, PLATFORMS } from './constants.ts'

/** 插件配置形状 / the plugin configuration shape */
export interface Config {
  /** 是否启用 IP 代理默认值 / default IP proxy switch */
  enableIpProxy: boolean
  /** 默认内容数量上限 / default max note count */
  crawlerMaxNotesCount: number
  /** 默认单条内容评论上限 / default max comments per note */
  maxCommentsCountSingleNotes: number
  /** 默认并发信号量 / default concurrency semaphore */
  maxConcurrencyNum: number
  /** 默认平台 / default platform */
  platform: (typeof PLATFORMS)[number]
  /** 默认采集模式 / default crawling mode */
  crawlerType: (typeof CRAWLER_TYPES)[number]
  /** 默认登录方式 / default login type */
  loginType: (typeof LOGIN_TYPES)[number]
  /** 媒体文件根目录（媒体开关开启时）/ the media file root (when the media switch is on) */
  mediaRoot: string
  /** 浏览器登录档案根目录 / the browser profile root directory */
  browserDataRoot: string
  /** 标准启动的系统浏览器渠道 / the system browser channel for standard launches */
  browserChannel: 'chrome' | 'msedge'
  /** 采集结束后向站内通知收件箱投回执（需同 profile 安装 @veren/mail） / deliver a receipt to the station inbox after each run (needs @veren/mail in the same profile) */
  notifyOnFinish: boolean
}

/**
 * schemastery 配置 schema：字段含义见各注释。
 * The schemastery config schema; field meanings live in the comments below.
 */
export const Config: z<Config> = z
  .object({
    enableIpProxy: z.boolean().default(false).description('是否启用 IP 代理 / enable IP proxy'),
    crawlerMaxNotesCount: z.number().default(20).description('内容数量上限 / max note count'),
    maxCommentsCountSingleNotes: z.number().default(10).description('单条内容评论上限 / max comments per note'),
    maxConcurrencyNum: z.number().default(5).description('并发信号量 / concurrency semaphore'),
    platform: z.union(PLATFORMS).default('tieba').description('默认平台 / default platform'),
    crawlerType: z.union(CRAWLER_TYPES).default('search').description('默认采集模式 / default crawler type'),
    loginType: z.union(LOGIN_TYPES).default('qrcode').description('默认登录方式 / default login type'),
    mediaRoot: z.string().default('./data/crawler/media').description('媒体文件根目录 / media file root'),
    browserDataRoot: z.string().default('./browser-data').description('浏览器登录档案根目录 / browser profile root'),
    browserChannel: z.union(['chrome', 'msedge'] as const).default('chrome').description('系统浏览器渠道 / the system browser channel'),
    notifyOnFinish: z.boolean().default(true).description('采集结束后投站内通知回执 / deliver a station notice after each run'),
  })
  .description('多平台内容采集配置 / multi-platform content crawler configuration')

/** 解析后的运行时配置（当前与 Config 同形）/ the resolved runtime config (same shape as Config for now) */
export type RuntimeConfig = Config

/** 代码级默认值：与 schema 默认值保持一致 / code-level defaults, kept in sync with the schema defaults */
export const DEFAULT_CONFIG: Config = {
  enableIpProxy: false,
  crawlerMaxNotesCount: 20,
  maxCommentsCountSingleNotes: 10,
  maxConcurrencyNum: 5,
  platform: 'tieba',
  crawlerType: 'search',
  loginType: 'qrcode',
  mediaRoot: './data/crawler/media',
    browserDataRoot: './browser-data',
    browserChannel: 'chrome',
    notifyOnFinish: true,
  }

/**
 * 应用默认值，得到运行时配置。
 * Applies the defaults, yielding the runtime configuration.
 */
export function resolveConfig(config: Partial<Config>): RuntimeConfig {
  return { ...DEFAULT_CONFIG, ...config }
}
