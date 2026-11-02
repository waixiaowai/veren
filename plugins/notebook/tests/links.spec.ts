/**
 * The `[[title]]` grammar, tested where it lives: what counts as a link, what
 * stays literal, and how occurrences rewrite.
 *
 * These rules are the write-time contract's syntax half (invariant I3). A
 * rule that drifts here manufactures either phantom links out of code
 * snippets or silent literal text where the writer meant a link.
 *
 * `[[标题]]` 语法，就在它所在之处测试：什么算链接、什么保持字面、出现如何重写。
 *
 * 这些规则是写入时契约的语法半边（不变式 I3）。这里漂移一条，就会要么从代码片段里
 * 造出幽灵链接，要么把作者本想链接的内容吞成无声字面。
 */

import { describe, expect, it } from 'vitest'
import { extractLinks, retargetOccurrences } from '../src/links.ts'
import { distinctTargets } from '../src/graph.ts'

/** The titles one body parses to, in order. 一条正文按序解析出的标题。 */
function titlesOf(body: string): string[] {
  return extractLinks(body).map(ref => ref.title)
}

describe('link grammar / 链接语法', () => {
  it('extracts a plain link with its span', () => {
    const refs = extractLinks('before [[target title]] after')
    expect(refs).toEqual([{ title: 'target title', offset: 7, end: 23 }])
  })

  it('trims the inner text and matches it exactly', () => {
    expect(titlesOf('[[  spaced  ]]')).toEqual(['spaced'])
    // 大小写与 Unicode 一律精确：中文标题是一等地址。
    // Case and Unicode stay exact: Chinese titles are first-class addresses.
    expect(titlesOf('[[存储域迁移必须不丢行]]')).toEqual(['存储域迁移必须不丢行'])
    expect(titlesOf('[[Storage]] and [[storage]]')).toEqual(['Storage', 'storage'])
  })

  it('keeps code-like brackets literal without any escape', () => {
    // 内文带 `]`：字面，重扫也找不到第二处 `[[`。/ An inner `]`: literal; the rescan finds no second `[[`.
    expect(titlesOf('const grid = [[1,2],[3,4]]')).toEqual([])
    // 隔一位的 `[[` 仍被找到（links.ts 记录在案的宽解语义）：`[[[a]]` 解析出 `a`。
    // A `[[` opening one over is still found (the documented forgiving rule): `[[[a]]` parses to `a`.
    expect(titlesOf('[[[a]]')).toEqual(['a'])
    // 未闭合：字面。/ Unclosed: literal.
    expect(titlesOf('a [[broken thing remains text')).toEqual([])
    // 空内文：字面。/ Empty inner: literal.
    expect(titlesOf('[[]]')).toEqual([])
    // 跨行：字面。/ Across lines: literal.
    expect(titlesOf('[[first\nline]]')).toEqual([])
  })

  it('drops an escaped bracket pair and keeps the rest', () => {
    expect(titlesOf('literal \\[[not a link]] then [[real one]]')).toEqual(['real one'])
    expect(titlesOf('\\[[only escaped]]')).toEqual([])
  })

  it('collapses repeated targets in document order', () => {
    expect(distinctTargets('[[b]] [[a]] [[b]] [[a]] [[c]]')).toEqual(['b', 'a', 'c'])
  })

  it('rewrites only the matching occurrences of one title', () => {
    const body = 'see [[old]] and [[other]] plus [[old]] but \\[[old]] stays'
    const next = retargetOccurrences(body, 'old', 'new')
    expect(next).toBe('see [[new]] and [[other]] plus [[new]] but \\[[old]] stays')
    // 不匹配时原文返回：改名绝不碰无关正文。/ No match: the body returns untouched.
    expect(retargetOccurrences(body, 'missing title', 'new')).toBe(body)
  })
})
