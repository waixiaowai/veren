/**
 * The canvas color arithmetic: the two derivations the canvas needs from theme
 * tokens — the edge ink (a `color-mix` stand-in) and the card shadow (an alpha
 * stand-in) — plus the parser both ride on. Kept browser-free on purpose: the
 * palette reader hands us `rgb()` strings, and this is the only place that
 * interprets them.
 *
 * 画布颜色算术：画布从主题 token 需要的两个派生——边墨（`color-mix` 替身）与卡片
 * 阴影（alpha 替身）——以及两者共用的解析器。刻意不依赖浏览器：调色板读取器交给我们
 * `rgb()` 串，而这里是唯一解释它们的地方。
 */

import { describe, expect, it } from 'vitest'
import { mixColor, parseColor, withAlpha } from '../src/client/canvas-color.ts'

describe('parseColor / 解析颜色', () => {
  it('parses the rgb() form the browser computes', () => {
    expect(parseColor('rgb(18, 52, 86)')).toEqual({ r: 18, g: 52, b: 86, a: 1 })
  })

  it('parses rgba() with a fractional alpha', () => {
    expect(parseColor('rgba(18, 52, 86, 0.25)')).toEqual({ r: 18, g: 52, b: 86, a: 0.25 })
  })

  it('parses hex in all four lengths', () => {
    expect(parseColor('#123456')).toEqual({ r: 18, g: 52, b: 86, a: 1 })
    expect(parseColor('#1234')).toEqual({ r: 17, g: 34, b: 51, a: 68 / 255 })
    expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 })
    expect(parseColor('#ffff')).toEqual({ r: 255, g: 255, b: 255, a: 1 })
  })

  it('treats transparent as a zero-alpha black', () => {
    expect(parseColor('transparent')).toEqual({ r: 0, g: 0, b: 0, a: 0 })
  })

  it('accepts percentage alpha and clamps channels', () => {
    expect(parseColor('rgb(300, -4, 12.6)')).toEqual({ r: 255, g: 0, b: 13, a: 1 })
    expect(parseColor('rgba(1, 2, 3, 50%)')).toEqual({ r: 1, g: 2, b: 3, a: 0.5 })
  })

  it('gives up on anything outside the subset', () => {
    expect(parseColor('oklch(0.7 0.1 200)')).toBeUndefined()
    expect(parseColor('#12345')).toBeUndefined()
    expect(parseColor('rgb(a, b, c)')).toBeUndefined()
  })
})

describe('mixColor / 混色', () => {
  it('returns the endpoints at ratio 0 and 1', () => {
    expect(mixColor('rgb(0, 0, 0)', 'rgb(255, 255, 255)', 0)).toBe('rgb(0, 0, 0)')
    expect(mixColor('rgb(0, 0, 0)', 'rgb(255, 255, 255)', 1)).toBe('rgb(255, 255, 255)')
  })

  it('blends channel by channel and clamps the ratio', () => {
    expect(mixColor('#000000', '#ffffff', 0.5)).toBe('rgb(128, 128, 128)')
    expect(mixColor('#000000', '#ffffff', 9)).toBe('rgb(255, 255, 255)')
    expect(mixColor('#000000', '#ffffff', -2)).toBe('rgb(0, 0, 0)')
  })

  it('falls back to the base color when either side is unparsable', () => {
    expect(mixColor('#123456', 'oklch(0.7 0.1 200)', 0.5)).toBe('#123456')
  })
})

describe('withAlpha / 透明化', () => {
  it('re-expresses a parsed color at the given alpha', () => {
    expect(withAlpha('rgb(10, 20, 30)', 0.08)).toBe('rgba(10, 20, 30, 0.08)')
  })

  it('clamps alpha into range', () => {
    expect(withAlpha('#0a141e', 2)).toBe('rgba(10, 20, 30, 1)')
    expect(withAlpha('#0a141e', -1)).toBe('rgba(10, 20, 30, 0)')
  })

  it('leaves unparsable colors untouched', () => {
    expect(withAlpha('oklch(0.7 0.1 200)', 0.5)).toBe('oklch(0.7 0.1 200)')
  })
})
