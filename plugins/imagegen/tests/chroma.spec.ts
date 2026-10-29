/** Chroma-key alpha 探针：键色像素必须变成真透明，去溢色不得伤主体。 */
/** Chroma-key alpha probe: key pixels must become truly transparent; despill must not hurt the subject. */
import { describe, expect, it } from 'vitest'
import { parseHexColor, removeChromaKey, sampleBorderKey } from '../src/chroma.js'
import { makeRaster } from './png.spec.js'

/** 造一张纯色图（自动取键的可解析夹具）。Builds a uniform image (a decodable fixture for auto key sampling). */
function uniformRaster(width: number, height: number, r: number, g: number, b: number) {
  const rgba = new Uint8Array(width * height * 4)
  for (let offset = 0; offset < rgba.length; offset += 4) {
    rgba[offset] = r
    rgba[offset + 1] = g
    rgba[offset + 2] = b
    rgba[offset + 3] = 255
  }
  return { width, height, rgba }
}

describe('parseHexColor', () => {
  it('accepts #rrggbb and bare hex', () => {
    expect(parseHexColor('#00ff00')).toEqual({ r: 0, g: 255, b: 0 })
    expect(parseHexColor('FF00FF')).toEqual({ r: 255, g: 0, b: 255 })
  })

  it('refuses non-hex input', () => {
    expect(() => parseHexColor('green')).toThrow(/hex RGB/)
  })
})

describe('removeChromaKey', () => {
  it('makes key pixels fully transparent (alpha probe)', () => {
    const raster = makeRaster(16, 16) // 对角线是纯红键色 / the diagonal is the pure red key
    const result = removeChromaKey(raster, { key: { r: 255, g: 0, b: 0 }, tolerance: 12 })
    expect(result.transparent).toBe(16)
    const offset = (5 * 16 + 5) * 4
    expect([result.image.rgba[offset], result.image.rgba[offset + 1], result.image.rgba[offset + 2], result.image.rgba[offset + 3]])
      .toEqual([0, 0, 0, 0])
  })

  it('keeps non-key pixels opaque and unspilled', () => {
    const raster = makeRaster(16, 16)
    const result = removeChromaKey(raster, { key: { r: 255, g: 0, b: 0 }, tolerance: 12 })
    const offset = (0 * 16 + 1) * 4 // 非对角线像素 / a non-diagonal pixel
    expect(result.image.rgba[offset + 3]).toBe(255)
    expect(result.transparent).toBe(16)
  })

  it('reports zero matches so callers can warn', () => {
    const raster = makeRaster(8, 8)
    const result = removeChromaKey(raster, { key: { r: 0, g: 255, b: 0 }, tolerance: 12 })
    expect(result.transparent).toBe(0)
  })

  it('auto-samples the key from corners', () => {
    const raster = uniformRaster(32, 32, 10, 200, 30)
    expect(sampleBorderKey(raster)).toEqual({ r: 10, g: 200, b: 30 })
  })
})
