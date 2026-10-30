/**
 * 双语字典键位齐平：en 必须覆盖 zh 的每个键（文案归属权在 locale，键集不齐
 * = 某语言漏文案）。
 * Bilingual key parity: en must cover every zh key (copy ownership lives in
 * the locale; a missing key is a missing sentence in one language).
 */
import { describe, expect, it } from 'vitest'
import { NS, en, zh } from '../src/client/locales.ts'

describe('locales / 双语字典', () => {
  it('en 与 zh 键集齐平且无空串', () => {
    const zhKeys = Object.keys(zh).sort()
    const enKeys = Object.keys(en).sort()
    expect(enKeys).toEqual(zhKeys)
    for (const key of zhKeys) {
      expect((en as Record<string, string>)[key], `en[${key}]`).not.toBe('')
      expect(zh[key], `zh[${key}]`).not.toBe('')
    }
  })

  it('命名空间名与 slot key 同源', () => {
    expect(NS).toBe('workbuddy-auth')
  })
})
