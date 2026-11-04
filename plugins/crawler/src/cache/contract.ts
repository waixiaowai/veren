/**
 * 缓存抽象契约与工厂（design/modules/cache.md §2）。
 * The cache abstraction contract and factory (design cache.md §2).
 *
 * 消费方（代理池 IP 缓存、手机号验证码缓存）只面向本抽象，后端选择归工厂。
 * Consumers (the proxy IP cache, the phone-code cache) face only this
 * abstraction; backend selection belongs to the factory.
 *
 * @module @veren/crawler/cache/contract
 */
import { CrawlerError } from '../errors.ts'
import { MemoryCache } from './memory-cache.ts'

/** 缓存类型闭集 / the closed cache-type set */
export type CacheType = 'memory' | 'redis'

/**
 * 缓存抽象：取值、带过期时间写值、按模式匹配取键。
 * The cache abstraction: get, set-with-expiry, and pattern-matched keys.
 */
export interface AbstractCache {
  /** 取值，过期或缺失返回 null / get, null on expiry or miss */
  get(key: string): Promise<unknown | null>
  /** 带过期时间写值（毫秒）/ set with an expiry in ms */
  set(key: string, value: unknown, expireTime: number): Promise<void>
  /** 按模式匹配取键（`*` 子串）/ pattern-matched keys (`*` substring) */
  keys(pattern: string): Promise<string[]>
}

/**
 * 缓存工厂：按类型创建后端。redis 后端待外部客户端依赖落地，
 * 当前 fail loud——不产生半初始化实例（验收 3）。
 * The cache factory: creates a backend per type. The redis backend awaits
 * an external client dependency and fails loudly for now — no
 * half-initialized instance (acceptance 3).
 */
export function createCache(type: CacheType): AbstractCache {
  if (type === 'memory') return new MemoryCache()
  throw new CrawlerError('INVALID_CACHE_TYPE', '不支持的缓存类型: redis（外部后端待接入）', { type })
}
