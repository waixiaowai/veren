// 文本与时间的小工具：纯函数、无宿主依赖，供渲染层复用。
// Text and time helpers: pure functions with no host dependencies, reused by
// the rendering layer.

/** 创建时间缺失时的占位文本。Placeholder text when the creation instant is missing. */
export const UNKNOWN_TIME = 'unknown-time'

/** 渲染层四要素缺失数据时的占位文本。Fallback text the renderer uses for missing facts. */
export const UNKNOWN = 'unknown'

/**
 * Creation time as a stable absolute date (ISO `YYYY-MM-DD`). No relative
 * times ("3m ago"): `createdAt` is fixed while "now" drifts, so a relative
 * rendering would change the text every step without any real fact changing.
 * 创建时间渲染为稳定的绝对日期（ISO `YYYY-MM-DD`）。不做相对时间（"3m ago"）：
 * `createdAt` 是固定的，而"当前时刻"一直在漂移——相对渲染会让文本每步都变，
 * 即使没有任何真实事实变化。
 */
export function formatCreated(createdAt: number | undefined): string {
  if (createdAt === undefined) return UNKNOWN_TIME
  return new Date(createdAt).toISOString().slice(0, 10)
}

/**
 * Derive the display fragment a session id falls back to when no title exists:
 * the id without its useless `session-` prefix, capped at the first 12 chars.
 * 派生会话 id 在缺少标题时使用的显示片段：去掉无意义的 `session-` 前缀，取前
 * 12 个字符。
 */
export const idFragment = (id: string): string => id.replace(/^session-/u, '').slice(0, 12)
