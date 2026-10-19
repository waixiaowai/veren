/**
 * `forum` dictionary parity.
 *
 * The key union is typed, so a missing translation already fails the type
 * check; this spec pins the runtime facts the page relies on — identical key
 * sets and no empty copy — so a placeholder string can never render as nothing.
 *
 * `forum` 词典一致性。
 *
 * 键联合有类型约束，漏译在类型检查阶段就会失败；这个测试钉住页面依赖的运行时事实——
 * 键集合一致、没有空文案——因此占位字符串永远不会渲染成空白。
 */

import { describe, expect, it } from 'vitest'
import { en, NS, zh } from '../src/client/locales.ts'

describe('forum dictionaries / 论坛词典', () => {
  it('owns the forum namespace', () => {
    expect(NS).toBe('forum')
  })

  it('has the same keys in both locales', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort())
  })

  it('never ships an empty string', () => {
    for (const [key, value] of Object.entries(zh)) expect(value, `zh:${key}`).not.toBe('')
    for (const [key, value] of Object.entries(en)) expect(value, `en:${key}`).not.toBe('')
  })

  it('never leaves a key placeholder in the copy', () => {
    for (const [key, value] of Object.entries(zh)) {
      expect(value, key).not.toContain('undefined')
      expect(value, key).not.toContain('{{')
    }
  })
})
