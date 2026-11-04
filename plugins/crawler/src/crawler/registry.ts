/**
 * 平台注册表：平台标识 → 爬取器实现；未注册平台抛 INVALID_PLATFORM。
 * The platform registry: platform id → crawler implementation; unknown
 * platforms throw INVALID_PLATFORM before any crawl begins (launcher
 * acceptance 2 — no data files are produced).
 *
 * @module @veren/crawler/crawler/registry
 */
import { invalidPlatform } from '../errors.ts'
import { PLATFORMS } from '../constants.ts'
import type { Platform } from '../types.ts'
import type { AbstractCrawler, CrawlerFactory } from './contract.ts'

/** 平台实现表 / the platform implementation table */
export type CrawlerRegistry = Readonly<Record<Platform, AbstractCrawler>>

/**
 * 由平台实现表构造工厂：查表失败立即抛错并列出全部合法值。
 * Builds the factory from a registry: a lookup miss throws immediately
 * listing all legal values.
 */
export function createCrawlerFactory(registry: Partial<CrawlerRegistry>): CrawlerFactory {
  return (platform: Platform) => {
    const crawler = registry[platform]
    if (crawler === undefined) throw invalidPlatform(platform)
    return crawler
  }
}

/** 全部合法平台标识 / all legal platform identifiers */
export const LEGAL_PLATFORMS: readonly Platform[] = PLATFORMS
