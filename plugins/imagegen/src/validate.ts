/**
 * 模型能力矩阵校验：全部 API 事实移植自生料 `image_gen.py` 的校验器
 * （gpt-image-2 的 16px 倍数/3:1/像素区间，legacy 模型的固定尺寸集，
 * 透明×格式互斥，模型专属选项拒绝）。误配置在这里响亮失败，不带病出门。
 * Model capability matrix validation: every rule is an API fact ported from
 * the raw material's `image_gen.py` validators (gpt-image-2's 16px multiples /
 * 3:1 ratio / pixel window, the legacy fixed size set, transparency×format
 * exclusivity, model-specific option refusals). Misconfiguration fails loudly
 * here, never downstream.
 *
 * @module @veren/imagegen
 */
import { ImagegenError } from './errors.js'

/** gpt-image-2 的尺寸约束（生料 `_validate_gpt_image_2_size` 原值）。 */
/** The gpt-image-2 size constraints (verbatim from the raw material's `_validate_gpt_image_2_size`). */
const GPT_IMAGE_2 = 'gpt-image-2'
const GPT_IMAGE_2_MAX_EDGE = 3840
const GPT_IMAGE_2_MIN_PIXELS = 655_360
const GPT_IMAGE_2_MAX_PIXELS = 8_294_400
const GPT_IMAGE_2_MAX_RATIO = 3.0

/** legacy 模型（gpt-image-1.5/1/1-mini 及未知）唯一接受的尺寸集。 */
/** The only size set legacy models (gpt-image-1.5/1/1-mini and unknown) accept. */
const LEGACY_SIZES = ['1024x1024', '1536x1024', '1024x1536', 'auto'] as const

/** 全部模型接受的质量集。The quality set every model accepts. */
export const QUALITIES = ['low', 'medium', 'high', 'auto'] as const
export type Quality = (typeof QUALITIES)[number]

/** 支持的输出格式；jpeg 是 API 拼写。The supported output formats; jpeg is the API spelling. */
export const OUTPUT_FORMATS = ['png', 'webp', 'jpeg'] as const
export type OutputFormat = (typeof OUTPUT_FORMATS)[number]

/** 一次调用的可校验执行面（generate 与 edit 共用）。 */
/** The validatable execution face of one call (shared by generate and edit). */
export interface RequestFace {
  readonly model: string
  readonly size: string
  readonly quality: Quality
  readonly outputFormat: OutputFormat
  readonly background?: 'transparent' | 'opaque' | 'auto'
  readonly inputFidelity?: 'low' | 'high'
}

/** 解析 `WIDTHxHEIGHT`；非该形态回答 undefined。Parses `WIDTHxHEIGHT`; other shapes answer undefined. */
function parseSize(size: string): { width: number; height: number } | undefined {
  const match = /^([1-9][0-9]*)x([1-9][0-9]*)$/.exec(size)
  if (match === null) return undefined
  return { width: Number(match[1]), height: Number(match[2]) }
}

/** gpt-image-2 的尺寸窗口：边长、16px 倍数、长宽比、总像素。 */
/** The gpt-image-2 size window: edges, 16px multiples, aspect ratio, total pixels. */
function validateGptImage2Size(size: string): void {
  if (size === 'auto') return
  const parsed = parseSize(size)
  if (parsed === undefined) {
    throw new ImagegenError('IMAGEGEN_SIZE_INVALID', 'size must be auto or WIDTHxHEIGHT, e.g. 1024x1024', { size })
  }
  const { width, height } = parsed
  const maxEdge = Math.max(width, height)
  const ratio = maxEdge / Math.min(width, height)
  const pixels = width * height
  if (maxEdge > GPT_IMAGE_2_MAX_EDGE) {
    throw new ImagegenError('IMAGEGEN_SIZE_INVALID', 'gpt-image-2 max edge is 3840px', { size, maxEdge })
  }
  if (width % 16 !== 0 || height % 16 !== 0) {
    throw new ImagegenError('IMAGEGEN_SIZE_INVALID', 'gpt-image-2 width and height must be multiples of 16px', { size })
  }
  if (ratio > GPT_IMAGE_2_MAX_RATIO) {
    throw new ImagegenError('IMAGEGEN_SIZE_INVALID', 'gpt-image-2 long-to-short edge ratio must not exceed 3:1', { size, ratio })
  }
  if (pixels < GPT_IMAGE_2_MIN_PIXELS || pixels > GPT_IMAGE_2_MAX_PIXELS) {
    throw new ImagegenError('IMAGEGEN_SIZE_INVALID',
      `gpt-image-2 total pixels must be between ${GPT_IMAGE_2_MIN_PIXELS} and ${GPT_IMAGE_2_MAX_PIXELS}`, { size, pixels })
  }
}

/**
 * 一次调用的全量校验：尺寸按模型矩阵、质量枚举、格式枚举、透明×格式互斥、
 * 模型专属选项拒绝。通过即静默，违规即抛结构化错误。
 * Full validation of one call: size per the model matrix, quality and format
 * enums, transparency×format exclusivity, model-specific option refusals.
 * Passing is silent; violations throw structured errors.
 */
export function validateRequest(face: RequestFace): void {
  if (!QUALITIES.includes(face.quality)) {
    throw new ImagegenError('IMAGEGEN_QUALITY_INVALID', `quality must be one of ${QUALITIES.join(', ')}`, { quality: face.quality })
  }
  if (!OUTPUT_FORMATS.includes(face.outputFormat)) {
    throw new ImagegenError('IMAGEGEN_FORMAT_INVALID', `output format must be one of ${OUTPUT_FORMATS.join(', ')}`, { outputFormat: face.outputFormat })
  }
  if (face.model === GPT_IMAGE_2) {
    validateGptImage2Size(face.size)
    if (face.background === 'transparent') {
      throw new ImagegenError('IMAGEGEN_TRANSPARENCY_UNSUPPORTED',
        'gpt-image-2 does not support background=transparent; use the chroma-key workflow instead', { model: face.model })
    }
    if (face.inputFidelity !== undefined) {
      throw new ImagegenError('IMAGEGEN_OPTION_UNSUPPORTED',
        'input_fidelity is not supported by gpt-image-2 (image inputs always use high fidelity)', { model: face.model })
    }
    return
  }
  if (!(LEGACY_SIZES as readonly string[]).includes(face.size)) {
    throw new ImagegenError('IMAGEGEN_SIZE_INVALID', `size must be one of ${LEGACY_SIZES.join(', ')} for this model`, { size: face.size, model: face.model })
  }
  if (face.background === 'transparent' && face.outputFormat !== 'png' && face.outputFormat !== 'webp') {
    throw new ImagegenError('IMAGEGEN_FORMAT_INVALID', 'a transparent background requires png or webp output', { background: face.background, outputFormat: face.outputFormat })
  }
  if (face.inputFidelity !== undefined && face.inputFidelity !== 'low' && face.inputFidelity !== 'high') {
    throw new ImagegenError('IMAGEGEN_OPTION_UNSUPPORTED', 'input_fidelity must be low or high', { inputFidelity: face.inputFidelity })
  }
}
