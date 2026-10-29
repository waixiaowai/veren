/**
 * Chroma-key 透明化：把纯色底转成 alpha。算法移植自生料 `remove_chroma_key.py`
 * 的硬键路径——通道距离容差 + 键色主导性判定 + 溢色清理 + 边框自动取键色；
 * soft-matte 羽化是 Pillow 滤波特性，v1 不移植。这是 gpt-image-2 无真透明的
 * 兜底工作流：先在纯键色底上生成，再转 alpha。
 * Chroma-key transparency: converts a solid backdrop into alpha. The algorithm
 * ports the raw material's `remove_chroma_key.py` hard-key path — channel
 * distance tolerance, key-dominance classification, spill cleanup, and border
 * auto key sampling; soft-matte feathering is a Pillow-filter feature and is
 * not ported in v1. This is the fallback workflow for gpt-image-2's missing
 * true alpha: generate on a flat key color, then convert to alpha.
 *
 * @module @veren/imagegen
 */
import type { RasterImage } from './png.js'
import { ImagegenError } from './errors.js'

/** RGB 三元组。An RGB triple. */
export interface Rgb {
  readonly r: number
  readonly g: number
  readonly b: number
}

/** 一次 chroma-key 的参数。The parameters of one chroma-key pass. */
export interface ChromaOptions {
  /** 键色；省略时从边框自动采样。The key color; sampled from the border when omitted. */
  readonly key?: Rgb
  /** 硬键容差（0–255，缺省 12）。Hard-key tolerance (0–255, default 12). */
  readonly tolerance?: number
  /** 是否清理不透明像素上的键色溢出（缺省 true）。Whether to despill key-colored opaque pixels (default true). */
  readonly spillCleanup?: boolean
}

/** 一次 chroma-key 的结果。The result of one chroma-key pass. */
export interface ChromaResult {
  readonly image: RasterImage
  /** 使用的实际键色（自动采样时有意义）。The key actually used (meaningful with auto sampling). */
  readonly key: Rgb
  /** 完全透明像素数。The count of fully transparent pixels. */
  readonly transparent: number
}

/** 主导性判定阈值：键色通道显著高于其余通道即视为键色（生料原值 16）。 */
/** Dominance threshold: a key channel clearly above the rest marks key color (raw material's value, 16). */
const DOMINANCE_THRESHOLD = 16

/** 解析 `#rrggbb` 十六进制键色；违规即稳定码 IMAGEGEN_CHROMA_INVALID。 */
/** Parses a `#rrggbb` hex key color; violations carry the stable IMAGEGEN_CHROMA_INVALID code. */
export function parseHexColor(raw: string): Rgb {
  const match = /^#?([0-9a-fA-F]{6})$/.exec(raw.trim())
  if (match === null) {
    throw new ImagegenError('IMAGEGEN_CHROMA_INVALID',
      `key color must be hex RGB like #00ff00, got ${JSON.stringify(raw)}`, { key: raw })
  }
  const hex = match[1]
  return { r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16) }
}

/** 逐通道最大距离。The per-channel maximum distance. */
function channelDistance(a: Rgb, b: Rgb): number {
  return Math.max(Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b))
}

/** 键色的高位通道（生料 `_spill_channels`）：溢色清理只动这些通道。 */
/** The key's high channels (the raw material's `_spill_channels`): spill cleanup touches only these. */
function spillChannels(key: Rgb): number[] {
  const values = [key.r, key.g, key.b]
  const max = Math.max(...values)
  if (max < 128) return []
  const channels: number[] = []
  for (let i = 0; i < 3; i += 1) {
    if (values[i] >= max - 16 && values[i] >= 128) channels.push(i)
  }
  return channels
}

/** 键色强度减其余通道最大值（生料 `_key_channel_dominance`）。 */
/** Key strength minus the strongest non-key channel (the raw material's `_key_channel_dominance`). */
function keyDominance(pixel: Rgb, key: Rgb): number {
  const spill = spillChannels(key)
  if (spill.length === 0) return 0
  const values = [pixel.r, pixel.g, pixel.b]
  const keyStrength = Math.min(...spill.map(i => values[i]))
  const nonSpill = [0, 1, 2].filter(i => !spill.includes(i))
  const nonKeyStrength = nonSpill.length > 0 ? Math.max(...nonSpill.map(i => values[i])) : 0
  return keyStrength - nonKeyStrength
}

/** 像素是否长得像键色（距离近，或键色显著主导）。Whether a pixel looks key-colored (near, or key-dominant). */
function looksKeyColored(pixel: Rgb, key: Rgb, distance: number): boolean {
  if (distance <= 32) return true
  return keyDominance(pixel, key) >= DOMINANCE_THRESHOLD
}

/** 去溢色：把溢出通道压到其余通道最大值之下（生料 `_cleanup_spill`）。 */
/** Despills: caps spill channels just under the strongest remaining channel (the raw material's `_cleanup_spill`). */
function cleanupSpill(pixel: Rgb, key: Rgb): Rgb {
  const spill = spillChannels(key)
  if (spill.length === 0) return pixel
  const values = [pixel.r, pixel.g, pixel.b]
  const nonSpill = [0, 1, 2].filter(i => !spill.includes(i))
  if (nonSpill.length === 0) return pixel
  const cap = Math.max(0, Math.max(...nonSpill.map(i => values[i])) - 1)
  for (const i of spill) {
    if (values[i] > cap) values[i] = cap
  }
  return { r: values[0], g: values[1], b: values[2] }
}

/**
 * 对整幅图执行 chroma-key：距离 ≤ 容差的像素置全透明，键色主导的像素做
 * 溢色清理；返回统计以便上游在零命中时发出结构化警告。
 * Runs chroma-key over the image: pixels within tolerance become fully
 * transparent and key-dominant pixels get despilled; the counts let callers
 * raise a structured warning when nothing matched.
 */
export function removeChromaKey(image: RasterImage, options: ChromaOptions = {}): ChromaResult {
  const key = options.key ?? sampleBorderKey(image)
  const tolerance = options.tolerance ?? 12
  const spillCleanup = options.spillCleanup ?? true
  const rgba = image.rgba
  let transparent = 0
  for (let offset = 0; offset < rgba.length; offset += 4) {
    const pixel: Rgb = { r: rgba[offset], g: rgba[offset + 1], b: rgba[offset + 2] }
    const distance = channelDistance(pixel, key)
    if (distance <= tolerance) {
      rgba[offset] = 0
      rgba[offset + 1] = 0
      rgba[offset + 2] = 0
      rgba[offset + 3] = 0
      transparent += 1
      continue
    }
    if (spillCleanup && looksKeyColored(pixel, key, distance)) {
      const cleaned = cleanupSpill(pixel, key)
      rgba[offset] = cleaned.r
      rgba[offset + 1] = cleaned.g
      rgba[offset + 2] = cleaned.b
    }
  }
  return { image: { ...image, rgba }, key, transparent }
}

/** 从四角小方块中采样像素（生料 corners 模式；导出供测试与诊断复用）。 */
/** Samples pixels from the four corner patches (the raw material's corners mode; exported for tests and diagnostics). */
export function sampleBorderKey(image: RasterImage): Rgb {
  const { width, height, rgba } = image
  const patch = Math.max(1, Math.min(width, height, 12))
  const samples: Rgb[] = []
  const corners: Array<[number, number]> = [
    [0, 0], [width - patch, 0], [0, height - patch], [width - patch, height - patch],
  ]
  for (const [left, top] of corners) {
    for (let y = top; y < top + patch; y += 1) {
      for (let x = left; x < left + patch; x += 1) {
        const offset = (y * width + x) * 4
        samples.push({ r: rgba[offset], g: rgba[offset + 1], b: rgba[offset + 2] })
      }
    }
  }
  return medianColor(samples)
}

/** 样本逐通道取中位数（生料用 statistics.median）。Per-channel median of the samples (the raw material uses statistics.median). */
function medianColor(samples: Rgb[]): Rgb {
  const channel = (pick: (s: Rgb) => number): number => {
    const sorted = samples.map(pick).sort((a, b) => a - b)
    return sorted[Math.floor(sorted.length / 2)]
  }
  return { r: channel(s => s.r), g: channel(s => s.g), b: channel(s => s.b) }
}
