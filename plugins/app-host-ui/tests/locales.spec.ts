/**
 * The dictionaries are complete, bilingual, and key-aligned: a missing key on
 * either side is a defect the GUI would render as a raw key.
 *
 * 双语词典必须完整且键对齐：任何一侧缺键，GUI 都会把裸键渲染出来。
 */
import { describe, expect, it } from 'vitest'
import { en, NS, zh, type AppPickerKey } from '../src/client/locales.ts'

describe('app-host-ui locales', () => {
  it('covers the same key set in both locales under one namespace', () => {
    expect(NS).toBe('app-host-ui')
    const zhKeys = Object.keys(zh).sort()
    const enKeys = Object.keys(en).sort()
    expect(zhKeys).toEqual(enKeys)
    const expected: readonly AppPickerKey[] = [
      'picker', 'pickerAria', 'loading', 'failed', 'retry', 'noApps',
      'entryMissing', 'appDisabled', 'appBroken', 'opening', 'openFailed', 'selectedApp',
    ]
    expect(zhKeys).toEqual([...expected].sort())
  })

  it('renders no empty copy', () => {
    for (const value of Object.values(zh)) expect(value.length).toBeGreaterThan(0)
    for (const value of Object.values(en)) expect(value.length).toBeGreaterThan(0)
  })
})
