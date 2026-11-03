/**
 * The canvas palette: theme tokens resolved once into plain colors the canvas
 * can paint with. A canvas has no CSS inheritance, so every `--nb-*` alias the
 * stylesheet would have resolved for DOM cards must be read out of the live
 * document instead. The probe element below sits inside the page (where the
 * aliases exist), carries `var(--nb-*)` in a painted property, and the browser
 * resolves the whole chain — including any `color-mix()` — before we read the
 * computed value. A `MutationObserver` on `body[data-ds-dark-theme]` and on the
 * root attributes rebuilds the palette when the shell switches themes.
 *
 * 画布调色板：把主题 token 一次解析成画布能直接涂的纯色。画布没有 CSS 继承，样式表
 * 本会为 DOM 卡片解析的每个 `--nb-*` 别名，必须从活的文档里读出来。下面的探针元素
 * 位于页面内（别名在那里存在），把 `var(--nb-*)` 放进一个会被绘制的属性，浏览器便
 * 在读取计算值之前解析整条链——包括任何 `color-mix()`。挂在
 * `body[data-ds-dark-theme]` 与根属性上的 `MutationObserver` 在外壳换主题时重建
 * 调色板。
 *
 * @module @veren/notebook-ui/client/canvas-theme
 */

import { useEffect, useState } from 'react'
import { mixColor, withAlpha } from './canvas-color.ts'

/** Every color and font a canvas card or edge paints with. 画布卡片与边绘制所用的全部颜色与字体。 */
export interface CanvasPalette {
  readonly surface: string
  readonly sunken: string
  readonly text: string
  readonly secondary: string
  readonly muted: string
  readonly border: string
  readonly borderSoft: string
  readonly accent: string
  readonly danger: string
  readonly success: string
  readonly fleetingFill: string
  readonly edge: string
  readonly shadow: string
  readonly fontFamily: string
}

/** A fallback stack for the rare page that resolves an empty font. 页面解析出空字体时的兜底字体栈。 */
const FALLBACK_FONT = 'system-ui, -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif'

/** The probe's painted property carries the token; `color` resolves the value. 探针的绘制属性携带 token；`color` 解析出值。 */
function readToken(probe: HTMLElement, token: string): string {
  probe.style.color = ''
  probe.style.color = `var(${token})`
  return getComputedStyle(probe).color
}

/** Read a `color-mix()` expression through the same probe. 用同一探针读一条 `color-mix()` 表达式。 */
function readMixed(probe: HTMLElement): string {
  probe.style.backgroundColor = 'color-mix(in srgb, var(--nb-accent-soft) 30%, var(--nb-surface))'
  const resolved = getComputedStyle(probe).backgroundColor
  probe.style.backgroundColor = ''
  return resolved
}

/** Whether two palettes paint the same; a theme observer must not churn on re-reads. 两个调色板是否等价；主题观察器不因重读而空转。 */
function samePalette(left: CanvasPalette | undefined, right: CanvasPalette): boolean {
  if (left === undefined) return false
  return (Object.keys(right) as (keyof CanvasPalette)[]).every(key => left[key] === right[key])
}

/** The raw token colors, before the two derived ones. 两个派生色之前的原始 token 颜色。 */
interface BaseTokens {
  readonly surface: string
  readonly sunken: string
  readonly text: string
  readonly secondary: string
  readonly muted: string
  readonly border: string
  readonly borderSoft: string
  readonly accent: string
  readonly accentSoft: string
  readonly danger: string
  readonly success: string
}

/** Read every raw token through the probe in one pass. 一次经探针读完全部原始 token。 */
function readTokens(probe: HTMLElement): BaseTokens {
  return {
    surface: readToken(probe, '--nb-surface'),
    sunken: readToken(probe, '--nb-sunken'),
    text: readToken(probe, '--nb-text'),
    secondary: readToken(probe, '--nb-secondary'),
    muted: readToken(probe, '--nb-muted'),
    border: readToken(probe, '--nb-border'),
    borderSoft: readToken(probe, '--nb-border-soft'),
    accent: readToken(probe, '--nb-accent'),
    accentSoft: readToken(probe, '--nb-accent-soft'),
    danger: readToken(probe, '--nb-danger'),
    success: readToken(probe, '--nb-success'),
  }
}

/**
 * Resolve the page's canvas palette from the live theme.
 * @param host - an element inside `.notebook-page`, where the `--nb-*` aliases live.
 * @returns every color and the font family the canvas should paint with.
 *
 * 从活主题解析页面画布调色板。`host` 必须是 `.notebook-page` 内的元素——`--nb-*`
 * 别名住在那里。
 */
export function readPalette(host: HTMLElement): CanvasPalette {
  const probe = host.ownerDocument.createElement('span')
  probe.style.display = 'none'
  probe.setAttribute('aria-hidden', 'true')
  host.append(probe)
  try {
    const { accentSoft, ...colors } = readTokens(probe)
    const mixedFill = readMixed(probe)
    return {
      ...colors,
      fleetingFill: mixedFill === '' ? mixColor(colors.surface, accentSoft, 0.3) : mixedFill,
      edge: mixColor(colors.border, colors.accent, 0.62),
      shadow: withAlpha(colors.text, 0.08),
      fontFamily: getComputedStyle(host).fontFamily || FALLBACK_FONT,
    }
  } finally {
    probe.remove()
  }
}

/**
 * Keep one palette in sync with the live theme.
 * @param ref - the canvas host element (inside `.notebook-page`).
 * @returns `undefined` until the host is mounted; then the current palette.
 *
 * 让一份调色板跟随活主题。`ref` 是画布宿主元素（在 `.notebook-page` 内）；挂载前
 * 返回 `undefined`，之后返回当前调色板。
 */
export function useCanvasPalette(ref: { readonly current: HTMLElement | null }): CanvasPalette | undefined {
  const [palette, setPalette] = useState<CanvasPalette | undefined>(undefined)
  useEffect(() => {
    const host = ref.current
    if (host === null) return
    const update = (): void => {
      const next = readPalette(host)
      setPalette(current => (samePalette(current, next) ? current : next))
    }
    update()
    const observer = new MutationObserver(update)
    observer.observe(document.body, { attributes: true })
    observer.observe(document.documentElement, { attributes: true })
    const media = globalThis.matchMedia?.('(prefers-color-scheme: dark)')
    media?.addEventListener('change', update)
    return () => {
      observer.disconnect()
      media?.removeEventListener('change', update)
    }
  }, [ref])
  return palette
}
