/**
 * 内存缓存后端：进程内字典 + 过期时间戳，取值即时判断 + 后台周期清理
 * （design/modules/cache.md §3）。
 * The memory cache backend: an in-process dictionary with expiry
 * timestamps; instant expiry checks on read plus a periodic background
 * sweep (design cache.md §3).
 *
 * 进程退出即清空，不承诺跨进程持久。
 * Nothing survives the process; cross-process persistence is not promised.
 *
 * @module @veren/crawler/cache/memory-cache
 */
import type { AbstractCache } from './contract.ts'

/** 缓存条目：值 + 过期时刻（Unix 毫秒）/ one entry: value plus expiry instant (unix ms) */
interface CacheEntry {
  value: unknown
  expiresAtMs: number
}

/** 默认清理周期毫秒 / the default sweep interval in ms */
export const SWEEP_INTERVAL_MS = 60_000

/**
 * 内存缓存后端。
 * The memory cache backend.
 */
export class MemoryCache implements AbstractCache {
  private readonly entries = new Map<string, CacheEntry>()
  private sweepTimer: ReturnType<typeof setInterval> | null = null

  /** 取值：即时过期判断（双保险之一）/ get with an instant expiry check (first of the two guards) */
  async get(key: string): Promise<unknown | null> {
    const entry = this.entries.get(key)
    if (entry === undefined) return null
    if (Date.now() >= entry.expiresAtMs) {
      this.entries.delete(key)
      return null
    }
    return entry.value
  }

  /** 带过期时间写值 / set with an expiry time */
  async set(key: string, value: unknown, expireTime: number): Promise<void> {
    this.entries.set(key, { value, expiresAtMs: Date.now() + expireTime })
  }

  /** 按模式取键：`*` 子串匹配 / keys by pattern: `*` substring match */
  async keys(pattern: string): Promise<string[]> {
    const parts = pattern.split('*').filter((part) => part.length > 0)
    const matched: string[] = []
    for (const key of this.entries.keys()) {
      if (parts.every((part) => key.includes(part))) matched.push(key)
    }
    return matched.sort()
  }

  /** 启动后台周期清理 / start the periodic background sweep */
  startSweep(intervalMs: number = SWEEP_INTERVAL_MS): void {
    if (this.sweepTimer !== null) return
    this.sweepTimer = setInterval(() => this.sweepExpired(), intervalMs)
    this.sweepTimer.unref?.()
  }

  /** 清理过期项：内存占用不随时间无限增长（验收 4）/ sweep expired entries: memory does not grow unbounded (acceptance 4) */
  sweepExpired(): number {
    const now = Date.now()
    let removed = 0
    for (const [key, entry] of this.entries) {
      if (now >= entry.expiresAtMs) {
        this.entries.delete(key)
        removed += 1
      }
    }
    return removed
  }

  /** 停止后台清理（卸载清理）/ stop the sweep timer (unload cleanup) */
  stopSweep(): void {
    if (this.sweepTimer !== null) {
      clearInterval(this.sweepTimer)
      this.sweepTimer = null
    }
  }
}
