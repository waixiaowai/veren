#!/usr/bin/env node
/**
 * 文档同步门禁（S3）：各包的 README.md / README.cn.md / domain.md 里**显式声明**
 的服务名/工具名/事件名/技能名/页面 URL，必须在对应包的 src 源码里逐字存在。
 * 单向校验（文档 → 代码）防文档漂移；查不到声明就跳过，不做反向强迫，也
 * 不做代码 → 文档（那是 model-surface 门禁的领地）。声明语法刻意保守：
 * 行首（可带 "- " 列表符）标记词 + 冒号 + 反引号或裸名字，例如：
 *   - tool: `complete_task`
 *   - event: task-center/completed
 * 其他任何行都不产生校验——宁可漏报，不可误报。
 * The docs-sync gate (S3): service/tool/event/skill/page names **explicitly
 * declared** in a package's README.md / README.cn.md / domain.md must exist
 * verbatim in that package's src sources. One-way (docs → code) to prevent doc
 * drift; documents without declarations are skipped, and there is no reverse
 * check (that is the model-surface gate's territory). The declaration syntax
 * is deliberately conservative: a line starting (optionally as a "- " bullet)
 * with a marker word + colon + a backticked or bare name, e.g.
 *   - tool: `complete_task`
 *   - event: task-center/completed
 * No other line produces a check — under-reporting beats false positives.
 *
 * 用法 / usage:
 *   node scripts/check-docs.mjs            # 漂移即非零退出 / nonzero exit on drift
 *   node scripts/check-docs.mjs --report   # 逐文档清单与判定 / per-doc lists and verdicts
 *
 * @module scripts/check-docs
 */
import { readdir, readFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const GROUPS = ['plugins', 'packages']
const DOC_NAMES = ['README.md', 'README.cn.md', 'domain.md']

/** 声明标记 → 展示名 / declaration markers → their display names */
export const MARKERS = new Map([
  ['tool', 'tool'], ['service', 'service'], ['event', 'event'], ['skill', 'skill'], ['page', 'page'],
])

/** 声明行模式：标记词 + 冒号 + 反引号或裸名字 / the declaration-line pattern: marker + colon + backticked or bare name */
const DECLARATION = /^(?:[-*]\s+)?(tool|service|event|skill|page)\s*:\s*`?([a-zA-Z0-9_/.:${}-]+)`?\s*(?:[（(].*)?$/

/**
 * 从一篇文档抽声明：[{ marker, name, line }]。围栏代码块（```）整段跳过——
 * 配置示例里的缩进 "tool:" 不是文档声明。
 * Extract declarations from one document: [{ marker, name, line }]. Fenced
 * code blocks are skipped whole — an indented "tool:" inside a config example
 * is not a document declaration.
 * @param {string} text - document text / 文档文本
 * @returns {Array<{ marker: string, name: string, line: number }>} declarations / 声明列表
 */
export function declarationsOf(text) {
  const out = []
  let fenced = false
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (/^\s*```/.test(line)) fenced = !fenced
    if (fenced) continue
    const match = DECLARATION.exec(line)
    if (match !== null) out.push({ marker: match[1], name: match[2], line: index + 1 })
  }
  return out
}

/**
 * 收集一个包 src 树的源码文本（ts/tsx，跳过产物目录）。
 * Collect the concatenated source text of a package's src tree (ts/tsx, artifact dirs skipped).
 * @param {string} srcDir - the package's src dir / 包的 src 目录
 * @returns {Promise<string>} concatenated sources / 拼接源码
 */
export async function sourcesTextOf(srcDir) {
  let entries
  try {
    entries = await readdir(srcDir, { withFileTypes: true })
  } catch {
    return ''
  }
  const chunks = []
  for (const entry of entries) {
    const path = join(srcDir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue
      chunks.push(await sourcesTextOf(path))
    } else if (entry.isFile() && /\.(?:ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      chunks.push(await readFile(path, 'utf8'))
    }
  }
  return chunks.join('\n')
}

/**
 * 扫全仓：每个包（含嵌套子包，如 im/core）的每篇文档 → 声明与判定。包的判定
 * 标准 = 目录里有 src/；只扫与 src 同层的文档。
 * Scan the workspace: every package's (nested subpackages included, like
 * im/core) every document → declarations and verdicts. A package = a directory
 * with a src/ inside; only documents at that same level are scanned.
 * @param {string} root - workspace root / 工作区根
 * @returns {Promise<Array<{ doc: string, declarations: Array, missing: Array }>>} per-doc results / 逐文档结果
 */
export async function auditDocs(root = ROOT) {
  const results = []
  for (const group of GROUPS) {
    await scanGroup(join(root, group), results)
  }
  return results
}

/** 递归扫一个组目录下的包 / recursively scan the packages under one group dir */
async function scanGroup(groupDir, results) {
  let entries
  try {
    entries = await readdir(groupDir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries.filter((item) => item.isDirectory())) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue
    const pkgDir = join(groupDir, entry.name)
    if (await isDirectory(join(pkgDir, 'src'))) {
      const sources = await sourcesTextOf(join(pkgDir, 'src'))
      for (const docName of DOC_NAMES) {
        const docPath = join(pkgDir, docName)
        let text
        try {
          text = await readFile(docPath, 'utf8')
        } catch {
          continue
        }
        const declarations = declarationsOf(text)
        const missing = declarations.filter((declaration) => !sources.includes(declaration.name))
        results.push({ doc: relative(ROOT, docPath), declarations, missing })
      }
    }
    await scanGroup(pkgDir, results)
  }
}

/** 路径是否为目录 / whether a path is a directory */
async function isDirectory(path) {
  try {
    return (await readdir(path, { withFileTypes: true })) !== undefined
  } catch {
    return false
  }
}

/** 逐文档报告 / the per-document report */
function printReport(results) {
  for (const result of results) {
    if (result.declarations.length === 0) {
      console.log(`SKIP  ${result.doc} (no declarations / 无显式声明)`)
      continue
    }
    const verdict = result.missing.length === 0 ? 'OK   ' : 'DRIFT'
    console.log(`${verdict}  ${result.doc} (${result.declarations.length} declarations / ${result.declarations.length} 条声明)`)
    for (const declaration of result.declarations) {
      const mark = result.missing.includes(declaration) ? 'MISSING' : 'found'
      console.log(`        ${declaration.marker}:${declaration.name} → ${mark} (line ${declaration.line})`)
    }
  }
}

/** 主入口 / main entry */
async function main() {
  const results = await auditDocs()
  const missing = results.flatMap((result) => result.missing.map((declaration) => ({ doc: result.doc, ...declaration })))
  if (process.argv.includes('--report')) printReport(results)
  for (const item of missing) {
    console.error(`DRIFT  ${item.doc}:${item.line}: ${item.marker} "${item.name}" declared but absent from the package's src / 声明了但源码里没有`)
  }
  if (missing.length > 0) {
    process.exitCode = 1
  } else if (!process.argv.includes('--report')) {
    const declared = results.reduce((sum, result) => sum + result.declarations.length, 0)
    console.log(`check-docs: ${results.length} docs scanned, ${declared} declarations verified / 已扫描 ${results.length} 篇文档，校验 ${declared} 条声明`)
  }
}

// 仅在直接执行时跑扫描（被自测 import 时不执行）
// Run only when executed directly (not when imported by the self-test).
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
