/**
 * 守卫域限流（设计文档 modules/07-guard.md §7.2 与 api.md §3.16）。
 * 优先级：插件专属规则 > 框架专属规则 > 兜底规则；计数键 `IP|路径`；
 * 无 IP 失败关闭——落共享桶 `no-trusted-ip`，绝不放行；超限 429 +
 * `X-Retry-After`。存储可选 memory（进程内 Map）或 database（rateLimit 表，
 * 原子增量由存储域决策 3 保证）。
 *
 * Guard rate limiting (design modules/07-guard.md §7.2 and api.md §3.16).
 * Priority: plugin rules > framework rules > fallback; the key is `IP|path`;
 * no IP fails closed into the shared `no-trusted-ip` bucket; over-limit
 * answers 429 + `X-Retry-After`. Storage: memory (in-process Map) or
 * database (the rateLimit table; atomic increments per storage decision 3).
 *
 * @module @veren/auth-core/guard/rate-limit
 */

import type { DBAdapter } from '../storage/adapter.ts'
import type { AuthContext } from '../context/auth-context.ts'
import type { EndpointContext } from '../endpoint/endpoint-types.ts'
import type { AuthPlugin } from '../plugin/plugin-types.ts'

/** 框架专属规则（§3.16）。 / The framework's own rules (§3.16). */
const SPECIAL_RULES: Array<{ pattern: RegExp, window: number, max: number }> = [
  { pattern: /^\/(sign-in|sign-up)/, window: 10, max: 3 },
  { pattern: /^\/(change-password|change-email)/, window: 10, max: 3 },
  { pattern: /^\/(request-password-reset|send-verification-email|forget-password)/, window: 60, max: 3 },
]

/** 内存计数条目。 / One memory counter entry. */
interface MemoryEntry { count: number, windowStart: number }

/** 内存存储上限，防无界增长。 / The memory-store ceiling against unbounded growth. */
const MEMORY_CAPACITY = 100_000

/** 进程内计数表。 / The in-process counter table. */
const memoryStore = new Map<string, MemoryEntry>()

/** 客户端 IP：转发头解析（首跳）→ x-real-ip → null（失败关闭）。 / Client IP: forwarded header (first hop) → x-real-ip → null (fails closed). */
export function resolveClientIP(headers: Headers): string | null {
  const forwarded = headers.get('x-forwarded-for')
  if (forwarded !== null && forwarded !== '') return forwarded.split(',')[0]?.trim() ?? null
  const real = headers.get('x-real-ip')
  if (real !== null && real !== '') return real.trim()
  return null
}

/** 通配路径模式 → 正则（`*` 跨段）。 / Wildcard path pattern → regex (`*` spans segments). */
function patternToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
  return new RegExp(`^${escaped}$`)
}

/** 解析限流规则：插件 > 框架专属 > 兜底。 / Resolve the rule: plugin > framework > fallback. */
export function resolveRateLimitRule(ctx: EndpointContext): { key: string, window: number, max: number, source: string } {
  const path = ctx.path
  const ip = resolveClientIP(ctx.headers)
  const key = `${ip ?? 'no-trusted-ip'}|${path}`
  const fallback = { key, window: ctx.context.options.rateLimit.window, max: ctx.context.options.rateLimit.max, source: 'default' }
  for (const plugin of ctx.context.plugins as ReadonlyArray<AuthPlugin>) {
    for (const rule of plugin.rateLimit ?? []) {
      if (patternToRegExp(rule.pathPattern).test(path)) return { key, window: rule.window, max: rule.max, source: `plugin:${plugin.id}` }
    }
  }
  for (const rule of SPECIAL_RULES) {
    if (rule.pattern.test(path)) return { key, window: rule.window, max: rule.max, source: 'special' }
  }
  return fallback
}

/** 内存计数：窗口滑动重置，返回计数与窗口剩余秒。 / Memory counting: sliding-window reset; returns the count and window seconds left. */
function consumeMemory(key: string, window: number): { count: number, retryAfter: number } {
  const now = Date.now()
  const entry = memoryStore.get(key)
  if (entry === undefined || now - entry.windowStart > window * 1000) {
    if (memoryStore.size >= MEMORY_CAPACITY) memoryStore.clear()
    memoryStore.set(key, { count: 1, windowStart: now })
    return { count: 1, retryAfter: window }
  }
  entry.count += 1
  return { count: entry.count, retryAfter: Math.ceil((entry.windowStart + window * 1000 - now) / 1000) }
}

/** 数据库计数：窗口外重置行，窗口内原子自增（存储域决策 3）。 / Database counting: reset the row outside the window, atomic increment inside (storage decision 3). */
async function consumeDatabase(db: DBAdapter, key: string, window: number): Promise<{ count: number, retryAfter: number }> {
  const windowStartMs = Date.now() - window * 1000
  const existing = await db.incrementOne<{ key: string, count: number, lastRequest: number }>({
    model: 'rateLimit',
    where: [{ field: 'key', value: key }, { field: 'lastRequest', operator: 'gte', value: windowStartMs }],
    increment: { count: 1 },
    set: { lastRequest: Date.now() },
  })
  if (existing !== null) return { count: existing.count, retryAfter: window }
  const row = { key, count: 1, lastRequest: Date.now() }
  const created = await db.create<{ key: string, count: number, lastRequest: number }>({ model: 'rateLimit', data: row, forceAllowId: false }).catch(() => null)
  if (created !== null) return { count: 1, retryAfter: window }
  const retry = await db.findOne<{ count: number }>({ model: 'rateLimit', where: [{ field: 'key', value: key }] })
  return { count: retry?.count ?? 1, retryAfter: window }
}

/** 429 响应：固定文案 + X-Retry-After。 / The 429 response: fixed copy + X-Retry-After. */
export function tooManyRequestsResponse(retryAfter: number): Response {
  return new Response(JSON.stringify({ message: 'Too many requests. Please try again later.' }), {
    status: 429,
    headers: { 'content-type': 'application/json', 'x-retry-after': String(Math.max(1, retryAfter)) },
  })
}

/**
 * 限流消费：命中返回 429 响应，否则 null（放行）。
 * / Consume one rate unit: a hit answers the 429 response, otherwise null
 * (pass-through).
 */
export async function consumeRateLimit(ctx: EndpointContext): Promise<Response | null> {
  if (!ctx.context.options.rateLimit.enabled) return null
  const rule = resolveRateLimitRule(ctx)
  const verdict = ctx.context.options.rateLimit.storage === 'database'
    ? await consumeDatabase(ctx.context.adapter, rule.key, rule.window)
    : consumeMemory(rule.key, rule.window)
  if (verdict.count > rule.max) return tooManyRequestsResponse(verdict.retryAfter)
  return null
}

/** 测试与运维入口：清空进程内计数。 / The test/ops entry: clear the in-process counters. */
export function resetRateLimitStore(): void {
  memoryStore.clear()
}

/** AuthContext 引用保持（database 存储走 adapter）。 / Keep the AuthContext reference (database storage goes through the adapter). */
export type { AuthContext }
