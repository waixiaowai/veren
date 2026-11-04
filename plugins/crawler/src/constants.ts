/**
 * 闭集枚举常量：与 design/modules/launcher.md 的枚举契约一一对应。
 * Closed-set enum constants: one-to-one with the enum contracts in
 * design/modules/launcher.md.
 *
 * @module @veren/crawler/constants
 */

import type { CrawlerType, LoginType, Platform, ProxyProviderName } from './types.ts'

/** 全部合法平台 / all legal platforms */
export const PLATFORMS: readonly Platform[] = ['xhs', 'dy', 'ks', 'bili', 'wb', 'tieba', 'zhihu']

/** 全部采集模式 / all crawling modes */
export const CRAWLER_TYPES: readonly CrawlerType[] = ['search', 'detail', 'creator']

/** 全部登录方式 / all login methods */
export const LOGIN_TYPES: readonly LoginType[] = ['qrcode', 'phone', 'cookie']


/** 全部代理服务商 / all proxy provider names */
export const PROXY_PROVIDER_NAMES: readonly ProxyProviderName[] = ['kuaidaili', 'wandouhttp', 'static']

/** 首次中断的优雅清理限时（毫秒）/ graceful cleanup window on first interrupt (ms) */
export const INTERRUPT_GRACE_MS = 15_000
