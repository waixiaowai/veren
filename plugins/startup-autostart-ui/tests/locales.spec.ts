/**
 * `startup.panel` dictionary parity.
 *
 * The key set is typed, so a missing English key already fails the type check;
 * this spec additionally pins the runtime facts the panel relies on — identical
 * key sets, no empty copy, and identical placeholders in both languages, so a
 * translated sentence cannot drop the value it interpolates.
 *
 * `startup.panel` 词典一致性。
 *
 * 键集合有类型约束，漏掉英文键在类型检查阶段就会失败；这个测试再钉住面板依赖的运行时
 * 事实——键集合一致、没有空文案、两种语言的占位符一致，翻译过的句子不能丢掉它要插值的值。
 */

import { describe, expect, it } from 'vitest'
import { en, NS, zh } from '../src/client/locales.ts'

/** The `{name}`-style placeholders in one string. 一个字符串里的 `{name}` 风格占位符。 */
function placeholders(copy: string): string[] {
  return [...copy.matchAll(/\{(\w+)\}/g)].map(match => match[1] ?? '').sort()
}

describe('startup panel dictionaries / 启动项面板词典', () => {
  it('owns the startup.panel namespace', () => {
    expect(NS).toBe('startup.panel')
  })

  it('has the same keys in both locales', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })

  it('never ships an empty string', () => {
    for (const [key, value] of Object.entries(zh)) expect(value, `zh:${key}`).not.toBe('')
    for (const [key, value] of Object.entries(en)) expect(value, `en:${key}`).not.toBe('')
  })

  it('keeps the same placeholders in both languages', () => {
    for (const key of Object.keys(zh) as Array<keyof typeof zh>) {
      expect(placeholders(en[key]), key).toEqual(placeholders(zh[key]))
    }
  })

  it('never leaves a raw key or a stray brace in the copy', () => {
    for (const [key, value] of Object.entries(zh)) {
      expect(value, key).not.toContain('undefined')
      expect(value, key).not.toContain('{{')
    }
  })
})
