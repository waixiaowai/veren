/**
 * Guard: no build output may sit next to the sources.
 *
 * `tsc` runs that ignore the project config (an ad-hoc `tsc src/*.ts`, or an
 * editor's "compile on save") drop `.js`, `.js.map`, `.d.ts` and `.d.ts.map`
 * beside the `.ts` files. Those are generated: the shippable artifact is what
 * the package's own `build` script emits into `dist/` (or `lib/`), and nothing
 * imports the copies in `src/`. The `.gitignore` patterns keep them out of
 * version control; this script is the loud half of the same contract, so a
 * regression fails `pnpm check` instead of quietly reappearing on disk.
 *
 * Detection is deliberately narrow, so hand-written JavaScript is never a false
 * positive:
 *
 * 1. Any `*.js.map` / `*.d.ts.map` under a `src/` tree is a violation — nobody
 *    hand-writes a source map.
 * 2. A `.js` or `.d.ts` is a violation only when a same-named `.ts` / `.tsx`
 *    sits beside it, which is what "compiled from that source" means. Ambient
 *    declarations with no source twin (e.g. `src/client/css.d.ts`) and the
 *    hand-written plugin `.js` kept outside `src/` (scripts/, ui/, web/client/,
 *    tests/) are therefore left alone.
 *
 * 守卫：构建产物不得与源码并排。
 *
 * 忽略工程配置的 `tsc`（临时 `tsc src/*.ts`，或编辑器"保存即编译"）会把
 * `.js`、`.js.map`、`.d.ts`、`.d.ts.map` 丢在 `.ts` 旁边。它们是生成物：可交付
 * 产物是各包 `build` 脚本写进 `dist/`（或 `lib/`）的那份，且没有任何代码 import
 * `src/` 里的副本。`.gitignore` 负责把它们挡在版本控制之外，本脚本是同一契约的
 * 响亮那一半——复发时让 `pnpm check` 失败，而不是悄悄重新出现在磁盘上。
 *
 * 判定刻意收窄，手写 JavaScript 不会被误报：
 *
 * 1. `src/` 树下任何 `*.js.map` / `*.d.ts.map` 即违规——没人手写 source map。
 * 2. `.js` / `.d.ts` 只有在旁边有同名 `.ts` / `.tsx` 时才算违规，这正是"由该
 *    源码编译而来"的含义。因此没有源码孪生的 ambient 声明
 *    （如 `src/client/css.d.ts`）以及 `src/` 之外的手写插件 `.js`
 *    （scripts/、ui/、web/client/、tests/）都不会被报。
 *
 * Usage / 用法: node scripts/check-src-artifacts.mjs
 *
 * @module @veren/scripts/check-src-artifacts
 */

import { existsSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..')

/** Trees that ship first-party sources. 需要检查的一方源码树。 */
const SEARCH_ROOTS = ['plugins', 'packages', 'apps']

/** Source-map suffixes; always generated. source map 后缀，必然是生成物。 */
const MAP_SUFFIXES = ['.js.map', '.d.ts.map']

/** Emitted suffixes that need a same-named `.ts` / `.tsx` twin to be a violation. */
const EMITTED_SUFFIXES = ['.d.ts', '.js']

/** Collect every directory named `src` under a tree, skipping installed deps. */
function collectSrcDirs(dir, found) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return found
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === 'node_modules' || entry.name === '.git') continue
    const full = join(dir, entry.name)
    if (entry.name === 'src') found.push(full)
    else collectSrcDirs(full, found)
  }
  return found
}

/** Every file under `dir`, recursively. 递归列出文件。 */
function collectFiles(dir, found = []) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return found
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') collectFiles(full, found)
    } else {
      found.push(full)
    }
  }
  return found
}

/** Stem of an emitted file, e.g. `a/b/index.js` -> `a/b/index`. 去掉产物后缀。 */
function stemOf(file, suffix) {
  return file.slice(0, -suffix.length)
}

/** Why a file counts as stray build output, or null when it is fine. */
function offenseOf(file) {
  if (MAP_SUFFIXES.some(suffix => file.endsWith(suffix))) {
    return 'generated source map / 生成的 source map'
  }

  const suffix = EMITTED_SUFFIXES.find(candidate => file.endsWith(candidate))
  if (!suffix) return null
  const stem = stemOf(file, suffix)
  const twin = existsSync(`${stem}.ts`) || existsSync(`${stem}.tsx`)
  return twin ? 'emitted next to its .ts source / 与 .ts 源并排的编译产物' : null
}

const offenders = []
for (const searchRoot of SEARCH_ROOTS) {
  for (const srcDir of collectSrcDirs(join(root, searchRoot), [])) {
    for (const file of collectFiles(srcDir)) {
      const reason = offenseOf(file)
      if (reason) offenders.push({ path: relative(root, file).replaceAll('\\', '/'), reason })
    }
  }
}

if (offenders.length > 0) {
  process.stderr.write('build output found next to sources / 源码旁发现构建产物:\n')
  for (const offender of offenders) {
    process.stderr.write(`  ${offender.path}  (${offender.reason})\n`)
  }
  process.stderr.write(
    `\n${offenders.length} stray file(s). Delete them and build into dist instead / ` +
      `共 ${offenders.length} 个残留文件；请删除它们，产物应输出到 dist。\n`,
  )
  process.exit(1)
}

process.stdout.write('src-artifacts: no build output next to sources / 源码旁无构建产物残留\n')
