/**
 * 入口点门禁的红灯自证：lib 未构建时，`check:entries` 必须当场报红——这是
 * "产物不入库"政策的安全网。产物目录（dist/lib）已从 git 移除，谁若把
 * `exports["./client"]` 指向一个没构建的 lib，这组断言会先于下一次打包红掉。
 * 门禁主体与 CLI 共用 `collectEntryProblems`，这里只喂临时 fixture，不碰真实仓库。
 *
 * Red-light self proof for the entry-point gate: when `lib` is not built,
 * `check:entries` must fail on the spot — that is the safety net of the
 * "artifacts stay out of git" policy. Artifact directories (dist/lib) are no
 * longer tracked, so anyone pointing `exports["./client"]` at an unbuilt lib
 * sees this suite go red before the next pack. The gate core and the CLI share
 * `collectEntryProblems`; these tests feed throwaway fixtures only and never
 * touch the real workspace.
 *
 * @module @veren/scripts/tests/check-entry-points
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { collectEntryProblems } from '../check-entry-points.mjs'

/** 本文件创建的全部 fixture 根，测试结束后统一删除 / every fixture root, removed after the suite. */
const fixtureRoots = []

/**
 * 造一个最小工作区：plugins/fixture 下放一份清单和若干文件。
 * Build a minimal workspace: one manifest plus a few files under plugins/fixture.
 *
 * @param {object} manifest - the package.json body / package.json 内容
 * @param {Record<string, string>} files - relative path -> file body / 相对路径 -> 文件内容
 * @returns {string} the fixture workspace root / fixture 工作区根目录
 */
function makeFixture(manifest, files) {
  const rootDir = mkdtempSync(join(tmpdir(), 'veren-entry-gate-'))
  fixtureRoots.push(rootDir)
  const packageDir = join(rootDir, 'plugins', 'fixture')
  mkdirSync(packageDir, { recursive: true })
  writeFileSync(join(packageDir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  for (const [relativePath, body] of Object.entries(files)) {
    mkdirSync(dirname(join(packageDir, relativePath)), { recursive: true })
    writeFileSync(join(packageDir, relativePath), body)
  }
  return rootDir
}

afterAll(() => {
  for (const rootDir of fixtureRoots) rmSync(rootDir, { recursive: true, force: true })
})

describe('check-entry-points gate', () => {
  it('goes red when exports["./client"] points at an unbuilt lib/client.js', () => {
    const rootDir = makeFixture(
      {
        name: 'fixture-gate',
        type: 'module',
        main: './dist/index.js',
        exports: {
          '.': './dist/index.js',
          './client': './lib/client.js',
          './package.json': './package.json',
        },
      },
      { 'dist/index.js': 'export {}\n' },
    )
    const { problems } = collectEntryProblems(rootDir)
    expect(problems.some(problem => problem.includes('"./lib/client.js"'))).toBe(true)
  })

  it('goes green once the artifact exists — the prepack contract', () => {
    const rootDir = makeFixture(
      {
        name: 'fixture-gate',
        type: 'module',
        main: './dist/index.js',
        exports: {
          '.': './dist/index.js',
          './client': './lib/client.js',
          './package.json': './package.json',
        },
      },
      { 'dist/index.js': 'export {}\n', 'lib/client.js': 'module.exports = {}\n' },
    )
    const { problems } = collectEntryProblems(rootDir)
    expect(problems).toEqual([])
  })

  it('still bans TypeScript runtime entries', () => {
    const rootDir = makeFixture(
      {
        name: 'fixture-gate',
        type: 'module',
        main: './src/index.ts',
        exports: { '.': './src/index.ts', './package.json': './package.json' },
      },
      { 'src/index.ts': 'export const ready = true\n' },
    )
    const { problems } = collectEntryProblems(rootDir)
    expect(problems.some(problem => problem.includes('must be built JavaScript, not TypeScript'))).toBe(true)
  })

  it('checks types conditions too but skips wildcard mappings', () => {
    const rootDir = makeFixture(
      {
        name: 'fixture-gate',
        type: 'module',
        main: './dist/index.js',
        exports: {
          '.': {
            types: './dist/index.d.ts',
            default: './dist/index.js',
          },
          './locale/*.json': './locale/*.json',
          './package.json': './package.json',
        },
      },
      // 只给 index.js 不给 index.d.ts：types 条件缺失必须红；locale 通配符不报
      // index.js only, no index.d.ts: a missing types condition must go red; the
      // locale wildcard must stay silent.
      { 'dist/index.js': 'export {}\n' },
    )
    const { problems } = collectEntryProblems(rootDir)
    expect(problems.some(problem => problem.includes('"./dist/index.d.ts"'))).toBe(true)
    expect(problems.some(problem => problem.includes('locale'))).toBe(false)
  })
})
