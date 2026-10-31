/**
 * Function-length gate: every function/method body in workspace source must
 * stay within `MAX_FUNCTION_LINES` lines (AGENTS.md hard rule: 单函数/方法
 * 30 行以内). Long bodies are where single-responsibility and readability
 * actually die, and they regress silently — so the rule lives as a gate, not
 * as per-review diligence.
 *
 * Counting rule: the line span of the function BODY only — leading JSDoc and
 * the signature line are excluded, so a well-documented function is not
 * penalized for its documentation.
 *
 * 函数长度门禁：工作区源码里每个函数/方法体不得超过 `MAX_FUNCTION_LINES`
 * 行（AGENTS.md 硬规则：单函数/方法 30 行以内）。超长函数体是单一职责与可
 * 读性真正的失守处，且会悄悄恶化——所以这条规则做成门禁，而不是靠 review
 * 自觉。
 *
 * 计数口径：只数函数体的行跨度——头部 JSDoc 与签名行不计入，文档写得好的
 * 函数不会因文档被罚。
 *
 * Usage / 用法:
 *   node scripts/check-function-length.mjs
 *
 * @module @veren/scripts/check-function-length
 */

import { readdir, readFile } from 'node:fs/promises'
import { extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const SCAN_GROUPS = ['plugins', 'packages', 'apps']

/** 产物目录名，任何层级出现都整枝跳过 / artifact dir names, pruned wherever they appear */
const ARTIFACT_DIRS = new Set(['node_modules', 'dist', 'build', 'lib', 'out'])

/** 函数体行数上限 / maximum function-body line count */
export const MAX_FUNCTION_LINES = 30

/**
 * 节点是否为带函数体的函数形态（签名/重载没有 body，天然跳过）。
 * Whether the node is a function-like form carrying a body (signatures and
 * overloads have none and are skipped naturally).
 *
 * @param {ts.Node} node - AST node to test / 待测 AST 节点
 * @returns {boolean} whether it is a function-like with a body / 是否为带体函数
 */
function isBodyFunction(node) {
  return (ts.isFunctionDeclaration(node)
    || ts.isMethodDeclaration(node)
    || ts.isConstructorDeclaration(node)
    || ts.isGetAccessorDeclaration(node)
    || ts.isSetAccessorDeclaration(node)
    || ts.isArrowFunction(node)
    || ts.isFunctionExpression(node))
    && node.body !== undefined
}

/**
 * 取函数的展示名：具名函数/方法用名，其余标 `<anonymous>`。
 * The function's display name: named functions and methods use their name,
 * everything else is `<anonymous>`.
 *
 * @param {ts.Node} node - function-like node / 函数形态节点
 * @param {ts.SourceFile} sourceFile - owning source file / 所属源文件
 * @returns {string} display name / 展示名
 */
function functionName(node, sourceFile) {
  if (node.kind === ts.SyntaxKind.Constructor) return 'constructor'
  const name = node.name ?? node.parent?.name
  if (name !== undefined && name !== null && ts.isIdentifier(name)) return name.text
  const assigned = node.parent
  if (assigned !== undefined && ts.isPropertyAssignment(assigned) && ts.isIdentifier(assigned.name)) {
    return assigned.name.text
  }
  if (assigned !== undefined && ts.isVariableDeclaration(assigned) && ts.isIdentifier(assigned.name)) {
    return assigned.name.text
  }
  return '<anonymous>'
}

/**
 * 函数体行数：块体按首语句到末语句的含头尾跨度计（大括号所在行不计），表达
 * 式体按表达式自身的行跨度计。
 * The body's line count: a block counts the inclusive span from its first to
 * its last statement (brace lines excluded); an expression body counts its own
 * line span.
 *
 * @param {ts.Node} node - function-like node with a body / 带体函数节点
 * @param {ts.SourceFile} sourceFile - owning source file / 所属源文件
 * @returns {number} body line count / 函数体行数
 */
function bodyLines(node, sourceFile) {
  const body = node.body
  if (!ts.isBlock(body)) {
    const start = sourceFile.getLineAndCharacterOfPosition(body.getStart(sourceFile))
    const end = sourceFile.getLineAndCharacterOfPosition(body.getEnd())
    return end.line - start.line + 1
  }
  const statements = body.statements
  if (statements.length === 0) return 0
  const start = sourceFile.getLineAndCharacterOfPosition(statements[0].getStart(sourceFile))
  const last = statements[statements.length - 1]
  const end = sourceFile.getLineAndCharacterOfPosition(last.getEnd())
  return end.line - start.line + 1
}

/**
 * 扫描一个源文件，返回超长函数命中 / scan one file and return overlong hits.
 *
 * @param {string} file - file path / 文件路径
 * @returns {Promise<Array<{ line: number, name: string, lines: number }>>} hits / 命中
 */
export async function scanFile(file) {
  const sourceText = await readFile(file, 'utf8')
  const kind = extname(file) === '.tsx' || file.endsWith('.jsx')
    ? ts.ScriptKind.TSX
    : ts.ScriptKind.TS
  const sourceFile = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true, kind)
  const hits = []
  const visit = (node) => {
    if (isBodyFunction(node)) {
      const lines = bodyLines(node, sourceFile)
      if (lines > MAX_FUNCTION_LINES) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
        hits.push({ line: line + 1, name: functionName(node, sourceFile), lines })
      }
    }
    node.forEachChild(visit)
  }
  visit(sourceFile)
  return hits
}

/**
 * 收集一个目录树下名为 `src` 的目录里的 ts/tsx 源（跳过 node_modules、dist 与
 * `.d.ts`）。
 * Collect ts/tsx sources under every `src` directory in the tree (skipping
 * node_modules, dist and `.d.ts`).
 *
 * @param {string} dir - directory to walk / 待遍历目录
 * @returns {Promise<string[]>} source file paths / 源文件路径
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
      if (ARTIFACT_DIRS.has(entry.name)) continue
      if (entry.name === 'src') {
        files.push(...await collectTsFiles(path))
      } else {
        files.push(...await sourceFiles(path))
      }
    }
  }
  return files
}

/**
 * 递归收集一个 `src` 目录下的全部 ts/tsx 文件 / recursively collect ts/tsx
 * files under one `src` directory.
 *
 * @param {string} dir - src directory / src 目录
 * @returns {Promise<string[]>} source file paths / 源文件路径
 */
async function collectTsFiles(dir) {
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
      if (ARTIFACT_DIRS.has(entry.name)) continue
      files.push(...await collectTsFiles(path))
    } else if (entry.isFile() && /\.(?:ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      files.push(path)
    }
  }
  return files
}

/** 打印超长函数并按命中数决定退出码 / print hits and set the exit code */
async function main() {
  const failures = []
  for (const group of SCAN_GROUPS) {
    for (const file of await sourceFiles(join(ROOT, group))) {
      for (const hit of await scanFile(file)) {
        failures.push({ file: relative(ROOT, file), ...hit })
      }
    }
  }
  if (failures.length === 0) {
    console.log(`check-function-length: every function body is <= ${MAX_FUNCTION_LINES} lines / 所有函数体不超过 ${MAX_FUNCTION_LINES} 行`)
    return
  }
  for (const failure of failures) {
    console.error(`${failure.file}:${failure.line}: ${failure.name} spans ${failure.lines} lines (> ${MAX_FUNCTION_LINES})`)
  }
  console.error(`\n${failures.length} overlong function(s); split by responsibility / 共 ${failures.length} 个超长函数，请按职责拆分`)
  process.exitCode = 1
}

// 仅在直接执行时跑扫描（被自测 import 时不执行）
// Run the scan only when executed directly (not when imported by the self-test).
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main()
}
