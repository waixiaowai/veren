/**
 * Canvas color arithmetic: the one place that parses resolved theme colors so
 * the canvas can mix and fade them. The palette reader hands us colors the
 * browser already resolved (`rgb()` / `rgba()`), and the canvas needs two
 * derived forms CSS would have produced with `color-mix()` / alpha: the edge
 * ink (accent mixed with the border) and the card shadow (text ink at low
 * alpha). Keeping this pure makes both derivations unit-testable without a
 * DOM, and keeps every call site on the same rounding.
 *
 * 画布颜色算术：解析已解析的主题色、供画布混色与褪色的唯一处所。调色板读取器交给
 * 我们浏览器已解析的 `rgb()` / `rgba()`，画布需要 CSS 本会用 `color-mix()` 与
 * alpha 生成的两个派生形：边墨（accent 混 border）与卡片阴影（文字墨的低 alpha）。
 * 保持纯函数让两个派生都无需 DOM 即可单测，也让所有调用点共享同一套取整。
 *
 * @module @veren/notebook-ui/client/canvas-color
 */

/** One parsed color, channels 0–255 and alpha 0–1. 一个解析后的颜色：通道 0–255，alpha 0–1。 */
export interface Rgba {
  readonly r: number
  readonly g: number
  readonly b: number
  readonly a: number
}

/** Comma- or space-separated `rgb()` / `rgba()`, optional `/` alpha. 逗号或空格分隔的 rgb()/rgba()，alpha 可带斜杠。 */
const RGB_PATTERN = /^rgba?\(\s*(-?[\d.]+)\s*[,\s]\s*(-?[\d.]+)\s*[,\s]\s*(-?[\d.]+)\s*(?:[,/]\s*(-?[\d.]+%?)\s*)?\)$/

/** Clamp one channel into the byte range. 把一个通道钳进字节范围。 */
function clampChannel(value: number): number {
  return Math.min(255, Math.max(0, Math.round(value)))
}

/** Parse the alpha tail: a number, or a percentage of 1. 解析 alpha 尾段：数字，或 1 的百分比。 */
function parseAlpha(text: string): number {
  const value = text.endsWith('%') ? Number.parseFloat(text) / 100 : Number.parseFloat(text)
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 1
}

/** Parse `#rgb[a]` / `#rrggbb[aa]` body (the `#` already stripped). 解析 `#rgb[a]` / `#rrggbb[aa]` 主体（`#` 已剥）。 */
function parseHex(body: string): Rgba | undefined {
  if (body.length !== 3 && body.length !== 4 && body.length !== 6 && body.length !== 8) return undefined
  const step = body.length <= 4 ? 1 : 2
  const channels: number[] = []
  for (let index = 0; index < body.length; index += step) {
    const chunk = body.slice(index, index + step)
    const value = Number.parseInt(chunk.length === 1 ? chunk + chunk : chunk, 16)
    if (Number.isNaN(value)) return undefined
    channels.push(value)
  }
  return {
    r: channels[0]!,
    g: channels[1]!,
    b: channels[2]!,
    a: channels[3] === undefined ? 1 : channels[3] / 255,
  }
}

/**
 * Parse one CSS color string as the browser reports it.
 * @param value - an `rgb()` / `rgba()` string, a hex literal, or `transparent`.
 * @returns the channels, or `undefined` when the syntax is outside this subset.
 *
 * 解析浏览器报告的一种 CSS 颜色串。语法超出本子集时返回 `undefined`。
 */
export function parseColor(value: string): Rgba | undefined {
  const text = value.trim().toLowerCase()
  if (text === 'transparent') return { r: 0, g: 0, b: 0, a: 0 }
  if (text.startsWith('#')) return parseHex(text.slice(1))
  const match = RGB_PATTERN.exec(text)
  if (match === null) return undefined
  const red = Number.parseFloat(match[1]!)
  const green = Number.parseFloat(match[2]!)
  const blue = Number.parseFloat(match[3]!)
  if (!Number.isFinite(red) || !Number.isFinite(green) || !Number.isFinite(blue)) return undefined
  return {
    r: clampChannel(red), g: clampChannel(green), b: clampChannel(blue),
    a: match[4] === undefined ? 1 : parseAlpha(match[4]),
  }
}

/**
 * Mix two opaque colors, the arithmetic stand-in for `color-mix()`.
 * @param base - the color at ratio 0.
 * @param overlay - the color at ratio 1.
 * @param ratio - 0–1, clamped; unparsable inputs fall back to `base`.
 * @returns an `rgb()` string the canvas accepts as a fill.
 *
 * 混合两个不透明色——`color-mix()` 的算术替身。不可解析时回退 `base`。
 */
export function mixColor(base: string, overlay: string, ratio: number): string {
  const left = parseColor(base)
  const right = parseColor(overlay)
  if (left === undefined || right === undefined) return base
  const share = Math.min(1, Math.max(0, ratio))
  const blend = (from: number, to: number): number => Math.round(from * (1 - share) + to * share)
  return `rgb(${String(blend(left.r, right.r))}, ${String(blend(left.g, right.g))}, ${String(blend(left.b, right.b))})`
}

/**
 * Re-express one color at a given alpha; the canvas' stand-in for `color-mix`
 * with `transparent`.
 * @param color - any color this module parses.
 * @param alpha - 0–1, clamped.
 * @returns an `rgba()` string, or the untouched input when unparsable.
 *
 * 把颜色改写成给定 alpha；不可解析时原样返回。
 */
export function withAlpha(color: string, alpha: number): string {
  const parsed = parseColor(color)
  if (parsed === undefined) return color
  const safe = Math.min(1, Math.max(0, alpha))
  return `rgba(${String(parsed.r)}, ${String(parsed.g)}, ${String(parsed.b)}, ${String(safe)})`
}
