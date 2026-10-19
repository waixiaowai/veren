/**
 * 平台模块表门禁：把「外壳冻结模块表」从人工同步变成可执行的检查。
 *
 * 包 `@veren/platform-modules` 是浏览器插件构建期唯一的事实源，但它必须与官方
 * `packages/client/web/src/platform.ts` 保持一致。本脚本从 DSH_CHECKOUT（默认
 * `deepseek/deepseek-harness`，可用环境变量覆盖）读取官方表，与包里的运行时数组、
 * 以及 `.d.mts` 字面量声明逐项比对：缺项、多项、重复、顺序不同都会非零退出。
 *
 * Platform-module drift gate: turns "keep the shell's frozen table in sync" from
 * a human habit into an executable check.
 *
 * The `@veren/platform-modules` package is the single build-time source of truth
 * for browser plugins, but it must match the official table in
 * `packages/client/web/src/platform.ts`. This script reads that table from
 * DSH_CHECKOUT (default `deepseek/deepseek-harness`, overridable) and compares
 * it item by item with the package's runtime array and its `.d.mts` literal
 * declaration. A missing, extra, duplicated, or reordered module exits non-zero.
 *
 * @module @veren/scripts/check-platform-modules
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** 本包构建所对的 Harness 检出目录；可用 DSH_CHECKOUT 覆盖。
 *  Harness checkout this package builds against; override with DSH_CHECKOUT. */
const CHECKOUT = process.env.DSH_CHECKOUT ?? resolve(root, 'deepseek/deepseek-harness')

const SHELL_TABLE = join(CHECKOUT, 'packages/client/web/src/platform.ts')
const PACKAGE_DIR = join(root, 'packages/platform-modules')
const PACKAGE_TABLE = join(PACKAGE_DIR, 'platform-modules.mjs')
const PACKAGE_TYPES = join(PACKAGE_DIR, 'platform-modules.d.mts')

/** 读取一个必须存在的源文件，缺失时给出可定位的错误。
 *  Read a source file that must exist, with a locatable error when it does not. */
function readSource(file, label) {
  if (!existsSync(file)) throw new Error(`${label} not found: ${file}`)
  return readFileSync(file, 'utf8')
}

/**
 * 从 marker 之后的第一个 `[...]` 中取出带引号的模块名。
 * 官方表与 `.d.mts` 都只包含字符串字面量，因此按引号取值足够精确。
 *
 * Extract the quoted module names from the first `[...]` after `marker`.
 * Both the official table and the `.d.mts` contain only string literals, so
 * reading quoted spans is precise enough.
 */
function extractArray(source, marker, file, label) {
  const start = source.indexOf(marker)
  if (start < 0) throw new Error(`${label}: cannot find ${JSON.stringify(marker)} in ${file}`)
  const open = source.indexOf('[', start + marker.length)
  const close = open < 0 ? -1 : source.indexOf(']', open + 1)
  if (open < 0 || close < 0) {
    throw new Error(`${label}: cannot find the array after ${JSON.stringify(marker)} in ${file}`)
  }
  const body = source.slice(open + 1, close)
  return [...body.matchAll(/'([^']+)'|"([^"]+)"/g)].map(match => match[1] ?? match[2])
}

/**
 * 比较两份模块表，返回全部问题（空数组表示一致）。
 * Compare two module tables and return every problem (empty means identical).
 */
function compare(actual, expected, actualLabel, expectedLabel) {
  const problems = []

  for (const name of new Set(actual)) {
    if (actual.indexOf(name) !== actual.lastIndexOf(name)) {
      problems.push(`${actualLabel} repeats ${JSON.stringify(name)}`)
    }
  }
  for (const name of expected) {
    if (!actual.includes(name)) {
      problems.push(`${actualLabel} is missing ${JSON.stringify(name)}, declared by ${expectedLabel}`)
    }
  }
  for (const name of actual) {
    if (!expected.includes(name)) {
      problems.push(`${actualLabel} has ${JSON.stringify(name)}, which ${expectedLabel} does not declare`)
    }
  }

  const sameSet = expected.every(name => actual.includes(name)) && actual.every(name => expected.includes(name))
  if (sameSet) {
    const index = actual.findIndex((name, at) => name !== expected[at])
    if (index >= 0) {
      problems.push(
        `order differs at index ${index}: ${expectedLabel} declares ${JSON.stringify(expected[index])}, `
        + `${actualLabel} declares ${JSON.stringify(actual[index])}`,
      )
    }
  }
  return problems
}

/** 执行全部门禁检查；抛出可读错误，由顶层统一转成退出码。
 *  Run every gate check; throw a readable error that the top level turns into an exit code. */
async function main() {
  const shellSource = readSource(SHELL_TABLE, 'shell table')
  const shell = extractArray(shellSource, 'export const PLATFORM_MODULES', SHELL_TABLE, 'shell table')
  if (shell.length === 0) throw new Error(`shell table yielded no module names: ${SHELL_TABLE}`)

  const runtime = (await import(pathToFileURL(PACKAGE_TABLE).href)).PLATFORM_MODULES
  if (!Array.isArray(runtime)) throw new Error(`PLATFORM_MODULES is not an array: ${PACKAGE_TABLE}`)

  const types = extractArray(
    readSource(PACKAGE_TYPES, 'type declaration'),
    'export declare const PLATFORM_MODULES',
    PACKAGE_TYPES,
    'type declaration',
  )

  const problems = [
    ...compare(runtime, shell, '@veren/platform-modules', 'packages/client/web/src/platform.ts'),
    ...compare(types, runtime, 'the .d.mts declaration', 'the runtime array'),
  ]

  if (problems.length > 0) {
    console.error(`check-platform-modules: ${String(problems.length)} problem(s)`)
    for (const problem of problems) console.error(`  - ${problem}`)
    process.exitCode = 1
    return
  }

  console.log(`check-platform-modules: ${String(runtime.length)} modules match ${SHELL_TABLE}`)
}

try {
  await main()
} catch (error) {
  console.error(`check-platform-modules: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
