/** 校验矩阵表驱动：全部规则是生料 image_gen.py 校验器的移植语义。 */
/** Validation matrix, table-driven: every rule ports the raw material's image_gen.py validator semantics. */
import { describe, expect, it } from 'vitest'
import { ImagegenError } from '../src/errors.js'
import { validateRequest, type RequestFace } from '../src/validate.js'

function face(overrides: Partial<RequestFace> = {}): RequestFace {
  return {
    model: 'gpt-image-2',
    size: 'auto',
    quality: 'low',
    outputFormat: 'png',
    ...overrides,
  }
}

function codeOf(execution: () => void): string {
  try {
    execution()
  } catch (error) {
    if (error instanceof ImagegenError) return error.code
    throw error
  }
  return 'passed'
}

describe('gpt-image-2 size window', () => {
  it.each([
    ['auto', 'passed'],
    ['1024x1024', 'passed'],
    ['2048x1152', 'passed'],
    ['3840x2160', 'passed'],
    ['3848x2160', 'IMAGEGEN_SIZE_INVALID'], // 超边长 / over max edge
    ['1000x1000', 'IMAGEGEN_SIZE_INVALID'], // 非 16px 倍数 / not a 16px multiple
    ['3840x2160x', 'IMAGEGEN_SIZE_INVALID'], // 形态非法 / malformed shape
    ['200x200', 'IMAGEGEN_SIZE_INVALID'], // 低于像素下限 / below the pixel floor
    ['4000x2100', 'IMAGEGEN_SIZE_INVALID'], // 超像素上限且超边长 / over pixel ceiling and edge
  ])('size %s → %s', (size, expected) => {
    expect(codeOf(() => validateRequest(face({ size })))).toBe(expected)
  })

  it('rejects ratio beyond 3:1', () => {
    // 3840x1216 = 3.16:1 且都在窗口内，唯独比例越界 / inside every window except the ratio
    expect(codeOf(() => validateRequest(face({ size: '3840x1216' })))).toBe('IMAGEGEN_SIZE_INVALID')
  })
})

describe('legacy model size set', () => {
  it.each([
    ['gpt-image-1.5', '1024x1024', 'passed'],
    ['gpt-image-1.5', '2048x1152', 'IMAGEGEN_SIZE_INVALID'],
    ['some-upstream-model', 'auto', 'passed'],
    ['some-upstream-model', '777x777', 'IMAGEGEN_SIZE_INVALID'],
  ])('%s size %s → %s', (model, size, expected) => {
    expect(codeOf(() => validateRequest(face({ model, size })))).toBe(expected)
  })
})

describe('gpt-image-2 option refusals', () => {
  it('refuses transparent background', () => {
    expect(codeOf(() => validateRequest(face({ background: 'transparent' })))).toBe('IMAGEGEN_TRANSPARENCY_UNSUPPORTED')
  })

  it('refuses input_fidelity', () => {
    expect(codeOf(() => validateRequest(face({ inputFidelity: 'high' })))).toBe('IMAGEGEN_OPTION_UNSUPPORTED')
  })
})

describe('shared enums', () => {
  it('refuses unknown quality', () => {
    expect(codeOf(() => validateRequest(face({ quality: 'ultra' as never })))).toBe('IMAGEGEN_QUALITY_INVALID')
  })

  it('refuses unknown output format', () => {
    expect(codeOf(() => validateRequest(face({ outputFormat: 'bmp' as never })))).toBe('IMAGEGEN_FORMAT_INVALID')
  })

  it('accepts every documented quality', () => {
    for (const quality of ['low', 'medium', 'high', 'auto'] as const) {
      expect(codeOf(() => validateRequest(face({ quality })))).toBe('passed')
    }
  })
})

describe('legacy transparency × format', () => {
  it('transparent background requires png or webp', () => {
    expect(codeOf(() => validateRequest(face({ model: 'gpt-image-1.5', background: 'transparent', outputFormat: 'jpeg' })))).toBe('IMAGEGEN_FORMAT_INVALID')
    expect(codeOf(() => validateRequest(face({ model: 'gpt-image-1.5', background: 'transparent', outputFormat: 'webp' })))).toBe('passed')
  })
})
