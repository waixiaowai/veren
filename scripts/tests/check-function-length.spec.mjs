import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { MAX_FUNCTION_LINES, scanFile } from '../check-function-length.mjs'

/**
 * 函数长度门禁的自测：函数体超过 30 行要被标记，JSDoc 与签名行不计入。
 * Self-test for the function-length gate: bodies over 30 lines must be
 * flagged, while JSDoc and the signature line do not count.
 */
describe('check-function-length', () => {
  /** 每个用例独立临时目录，测完清理 / per-case temp dir, removed after each test */
  let work
  afterEach(() => {
    if (work !== undefined) rmSync(work, { recursive: true, force: true })
  })

  /** 落盘一个源文件供 scanFile / write one source file for scanFile */
  const writeSource = (name, lines) => {
    work = mkdtempSync(join(tmpdir(), 'veren-func-len-'))
    const file = join(work, name)
    writeFileSync(file, lines.join('\n'), 'utf8')
    return file
  }

  it('超过上限的具名函数被标记，行数为体跨度', async () => {
    const lines = ['export function big() {', ...Array.from({ length: 35 }, () => '  step()'), '}']
    const hits = await scanFile(writeSource('big.ts', lines))
    expect(hits).toEqual([{ line: 1, name: 'big', lines: 35 }])
    expect(hits[0].lines).toBeGreaterThan(MAX_FUNCTION_LINES)
  })

  it('体长恰在上限内（含多行 JSDoc 与签名）不误报', async () => {
    const lines = [
      '/**',
      ' * 十行文档不应计入体长。',
      ' * Ten doc lines must not count into the body length.',
      ' */',
      'export function ok() {',
      ...Array.from({ length: MAX_FUNCTION_LINES - 1 }, () => '  step()'),
      '}',
    ]
    expect(await scanFile(writeSource('ok.ts', lines))).toEqual([])
  })

  it('类方法、构造器与箭头函数一样受检', async () => {
    const lines = [
      'export class S {',
      '  constructor() {',
      ...Array.from({ length: 33 }, () => '    this.step()'),
      '  }',
      '  run = () => {',
      ...Array.from({ length: 31 }, () => '    this.step()'),
      '  }',
      '}',
    ]
    const hits = await scanFile(writeSource('shape.ts', lines))
    expect(hits.map((hit) => [hit.name, hit.lines])).toEqual([['constructor', 33], ['run', 31]])
  })
})
