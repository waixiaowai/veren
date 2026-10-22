#!/usr/bin/env node
/**
 * 页面组件 API 门禁：页面声明（`: PageFC`）所在的文件里，禁止直接调用
 * `ctx.effect` / `ctx.on` / `ctx.tools.register`——它们是 Cordis Context 的固有
 * 成员，在页面里调用会得到创建者 fiber 的语义，而不是页面记账语义。页面必须走
 * `ctx.page.effect` / `ctx.page.on` / `ctx.page.tool`。
 * Page-component API gate: in a file that declares a page (`: PageFC`), direct
 * calls to `ctx.effect` / `ctx.on` / `ctx.tools.register` are forbidden — those
 * are Cordis Context's inherent members, and inside a page they bind to the
 * creator fiber instead of the page bookkeeping. Pages must use
 * `ctx.page.effect` / `ctx.page.on` / `ctx.page.tool`.
 *
 * 只扫描 `plugins/<pkg>/src` 与 `packages/<pkg>/src`（不扫 tests/dist）：
 * 测试夹具可以直接造 ctx，页面生产代码才是契约面。
 * Scans only `plugins/<pkg>/src` and `packages/<pkg>/src` (not tests/dist):
 * fixtures may build raw ctxs; the production page code is the contract.
 * @module scripts/check-page-api
 */
import { readdir, readFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const SCAN_GROUPS = ['plugins', 'packages']
/** 页面文件标记：类型标注 `: PageFC`（含泛型、赋值、只读字段形态） */
const PAGE_DECLARATION = /:\s*PageFC(?:<|\s*=|\s*;|\s*,|\s*$)/m
const FORBIDDEN = [
  { pattern: /\bctx\.effect\s*\(/, api: 'ctx.page.effect' },
  { pattern: /\bctx\.on\s*\(/, api: 'ctx.page.on' },
  { pattern: /\bctx\.tools\.register\s*\(/, api: 'ctx.page.tool' },
]

/**
 * 在源码文本里找页面文件中的禁用调用。
 * Find forbidden calls in a page source text.
 * @param {string} source - 源码文本 / source text
 * @returns {Array<{ line: number; api: string; text: string }>} 命中 / hits
 */
export function findForbiddenPageCalls(source) {
  if (!PAGE_DECLARATION.test(source)) return []
  const hits = []
  const lines = source.split(/\r?\n/)
  for (const [index, line] of lines.entries()) {
    const match = FORBIDDEN.find(({ pattern }) => pattern.test(line))
    if (match !== undefined) hits.push({ line: index + 1, api: match.api, text: line.trim() })
  }
  return hits
}

/**
 * 递归收集某个 `src` 下的 ts/tsx。
 * Collect ts/tsx files under one `src`.
 * @param {string} dir - 目录 / directory
 * @returns {Promise<string[]>} 文件路径 / file paths
 */
async function sourceFiles(dir) {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
  const files = []
  for (const entry of entries) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue
      files.push(...await sourceFiles(path))
    } else if (entry.isFile() && /\.(?:ts|tsx)$/.test(entry.name)) {
      files.push(path)
    }
  }
  return files
}

/** 扫描全部工作区并打印违规；有命中时退出码 1 / scan and exit 1 on hits */
async function main() {
  const failures = []
  for (const group of SCAN_GROUPS) {
    let packages
    try {
      packages = await readdir(join(ROOT, group), { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of packages) {
      if (!entry.isDirectory()) continue
      for (const file of await sourceFiles(join(ROOT, group, entry.name, 'src'))) {
        const hits = findForbiddenPageCalls(await readFile(file, 'utf8'))
        for (const hit of hits) failures.push({ file, ...hit })
      }
    }
  }
  if (failures.length === 0) {
    console.log('check-page-api: page files use ctx.page.* only / 页面文件只用 ctx.page.*')
    return
  }
  for (const failure of failures) {
    console.error(`${relative(ROOT, failure.file)}:${failure.line}: use ${failure.api} instead of ${failure.text}`)
  }
  process.exitCode = 1
}

// 仅在直接执行时跑扫描（被自测 import 时不执行）
// Run the scan only when executed directly (not when imported by the self-test).
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
