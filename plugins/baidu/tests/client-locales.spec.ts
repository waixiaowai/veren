/**
 * 面板文案审计：zh/en 覆盖同一闭集 key，值全部是非空字符串（设计 §9.9 双语
 * 纪律的机器可校验面）。
 * The panel copy audit: zh/en cover the same closed key set and every value is
 * a non-empty string (the machine-checkable face of design §9.9's bilingual
 * discipline).
 *
 * @module tests/client-locales
 */
import { describe, expect, it } from 'vitest'
import { NS, en, zh, type BaiduKey } from '../src/client/locales.ts'

describe('panel dictionaries', () => {
  it('covers exactly the same key set in zh and en', () => {
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort())
  })

  it('keeps every value a non-empty bilingual string', () => {
    for (const [key, value] of [...Object.entries(zh), ...Object.entries(en)]) {
      expect(value.length, key).toBeGreaterThan(0)
    }
  })

  it('publishes the namespace under the closed type', () => {
    const probe: BaiduKey = 'panel'
    expect(NS.length).toBeGreaterThan(0)
    expect(zh[probe].length).toBeGreaterThan(0)
  })
})
