/**
 * Dictionary parity, tested without the browser.
 *
 * The `Record<NotebookKey, string>` annotation already fails the type check on a
 * missing key; this spec additionally pins that both dictionaries stay in step
 * at runtime and never ship an empty string.
 *
 * 不依赖浏览器的词典一致性测试。`Record<NotebookKey, string>` 注解已经会让漏键在类型检查
 * 阶段失败；这个测试再钉住两份词典在运行时同步，且不会交付空字符串。
 */

import { describe, expect, it } from 'vitest'
import { en, zh } from '../src/client/locales.ts'

describe('notebook dictionaries', () => {
  it('has the same keys in both locales', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })

  it('never ships an empty string', () => {
    for (const [key, value] of Object.entries(en)) expect(value, key).not.toBe('')
    for (const [key, value] of Object.entries(zh)) expect(value, key).not.toBe('')
  })
})
