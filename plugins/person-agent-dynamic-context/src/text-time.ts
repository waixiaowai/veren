// 文本与时间的小工具：纯函数、无宿主依赖，供渲染层复用。
// Text and time helpers: pure functions with no host dependencies, reused by
// the rendering layer.

/** 创建时间缺失时的占位文本。Placeholder text when the creation instant is missing. */
export const UNKNOWN_TIME = 'unknown-time'

/** 渲染层四要素缺失数据时的占位文本。Fallback text the renderer uses for missing facts. */
export const UNKNOWN = 'unknown'

/** 一小时的毫秒数。One hour in milliseconds. */
export const ONE_HOUR_MS = 60 * 60 * 1000

/** 一分钟的毫秒数。One minute in milliseconds. */
const ONE_MINUTE_MS = 60 * 1000

/**
 * Compact creation time: relative within an hour, otherwise the date.
 * 紧凑创建时间：一小时内用相对值，否则用日期。
 */
export function formatCreated(createdAt: number | undefined, now: number): string {
  if (createdAt === undefined) return UNKNOWN_TIME
  const elapsedMs = now - createdAt
  if (elapsedMs < ONE_HOUR_MS) {
    const minutes = Math.floor(elapsedMs / ONE_MINUTE_MS)
    return minutes < 1 ? 'just now' : `${minutes}m ago`
  }
  return new Date(createdAt).toISOString().slice(0, 10)
}

/**
 * Derive the display fragment a session id falls back to when no title exists:
 * the id without its useless `session-` prefix, capped at the first 12 chars.
 * 派生会话 id 在缺少标题时使用的显示片段：去掉无意义的 `session-` 前缀，取前
 * 12 个字符。
 */
export const idFragment = (id: string): string => id.replace(/^session-/u, '').slice(0, 12)
