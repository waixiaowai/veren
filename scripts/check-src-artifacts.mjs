/**
 * Guard: build hygiene for first-party packages. Three checks fail `pnpm check`
 * loudly instead of letting a regression reach a shipped package.
 *
 * 1. No build output next to sources. `tsc` runs that ignore the project config
 *    (ad-hoc `tsc src/*.ts`, editor "compile on save") drop `.js` / `.js.map` /
 *    `.d.ts` / `.d.ts.map` beside the `.ts` files; the shippable artifact is
 *    what the package's own `build` emits into `dist/` (or `lib/`). Detection
 *    is deliberately narrow so hand-written JavaScript is never a false
 *    positive: a `.js`/`.d.ts` offends only with a same-named `.ts`/`.tsx` twin
 *    beside it, maps always offend, ambient declarations without a twin (e.g.
 *    `src/client/css.d.ts`) are left alone.
 *
 * 2. No stale artifacts in `dist/`. `tsc` never cleans `dist/`, so sources
 *    deleted by a refactor keep shipping (real case: `dist/staging.js` packed
 *    after `src/staging.ts` was deleted). Every emitted file under `dist/` must
 *    have a same-relative-path source twin under `src/`; copied assets (css,
 *    json, ...) are not emitted code and are skipped. The allowlist only covers
 *    frozen lanes this audit may not modify — each entry is real residue whose
 *    deletion belongs to its owning lane.
 *
 * 3. First-party runtime imports must be real `dependencies`. A runtime import
 *    of a `@veren/*` package only declared as `peerDependencies` (or undeclared)
 *    breaks on real profiles: pnpm v10 does not install peers, so the module
 *    load fails right after install. Matching is statement-level: type-only
 *    references (`import type` / `export type` / `typeof import`) and comments
 *    stay out of scope, sub-path specifiers (`@veren/x/jsx-runtime`) resolve to
 *    the bare package name, and emitted `dist/*.js` is checked as ground truth
 *    because everything it imports is runtime by construction.
 *
 * 守卫：第一方包的构建卫生。三项检查，任何复发都让 `pnpm check` 大声失败，
 * 而不是悄悄溜进发布包。1) 构建产物不得与源码并排：忽略工程配置的 tsc 会把
 * 产物丢在 `.ts` 旁边，可交付产物是各包 `build` 写进 `dist/`（或 `lib/`）的
 * 那份；判定刻意收窄——`.js`/`.d.ts` 只有旁边有同名 `.ts`/`.tsx` 孪生才算
 * 违规，source map 必违规，没有孪生的 ambient 声明不报。2) `dist/` 不得有
 * 陈旧产物：tsc 从不清理 `dist/`，重构删掉的源码会继续随包发布（真实案例：
 * `src/staging.ts` 已删而 `dist/staging.js` 被打进包）；`dist/` 下每个产物
 * 必须在 `src/` 有同相对路径的源码孪生，拷贝进来的资源不是编译产物，跳过；
 * 白名单只覆盖本轮无权修改的冻结泳道，删除责任在属主泳道。3) 第一方运行时
 * import 必须是真正的 `dependencies`：只挂 peer（pnpm v10 默认不装 peer）或
 * 未声明的 `@veren/*` 运行时引用，装到真实 profile 即模块加载失败；语句级
 * 匹配排除类型only 与注释，子路径说明符归并到裸包名；`dist/*.js` 按事实
 * 标准一并检查——它里面的一切 import 都是运行时的。
 *
 * Usage / 用法: node scripts/check-src-artifacts.mjs
 *
 * @module @veren/scripts/check-src-artifacts
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..')

/** Trees that ship first-party sources. 需要检查的一方源码树。 */
const SEARCH_ROOTS = ['plugins', 'packages', 'apps']

/** Source-map suffixes; always generated. source map 后缀，必然是生成物。 */
const MAP_SUFFIXES = ['.js.map', '.d.ts.map']

/** Emitted suffixes that need a same-named `.ts` / `.tsx` twin to be a violation. */
const EMITTED_SUFFIXES = ['.d.ts', '.js']

/** Suffixes counted as emitted artifacts inside `dist/`. 计入 dist 产物的后缀。 */
const ARTIFACT_SUFFIX_RE = /\.(?:js|mjs|cjs|d\.ts|js\.map|d\.ts\.map)$/

/** Source suffixes accepted as a twin for a dist artifact. 可作 dist 孪生的源码后缀。 */
const SRC_TWIN_SUFFIXES = ['.ts', '.tsx', '.mts', '.cts']

/**
 * Allowlisted stale `dist/` artifacts (repo-relative): each sits in a frozen
 * lane this audit must not modify — real residue, deletion owed by its lane.
 * 白名单（仓库相对路径）：冻结泳道内的真实残留，删除责任在属主泳道。
 */
const STALE_DIST_ALLOWLIST = new Set([
  // prompt-page / forum-app / person-agent-app: the full emitted quartet 产物四件套
  ...['packages/prompt-page/dist/mount.', 'plugins/forum-app/dist/app-tools.', 'plugins/person-agent-app/dist/views.']
    .flatMap(stem => ['js', 'js.map', 'd.ts', 'd.ts.map'].map(ext => `${stem}${ext}`)),
  'plugins/app-host/dist/page-sync.js', // deleted sources / 已删源码
  'plugins/app-host/dist/staging.js',
])

/** Directory entries or [] when unreadable. 读取目录项，不可读时返回空。 */
function readEntries(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
}

/** Collect every directory named `src` under a tree, skipping installed deps. */
function collectSrcDirs(dir, found) {
  for (const entry of readEntries(dir)) {
    if (!entry.isDirectory() || entry.name === 'node_modules' || entry.name === '.git') continue
    const full = join(dir, entry.name)
    if (entry.name === 'src') found.push(full)
    else collectSrcDirs(full, found)
  }
  return found
}

/** Every file under `dir`, recursively. 递归列出文件。 */
function collectFiles(dir, found = []) {
  for (const entry of readEntries(dir)) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') collectFiles(full, found)
    } else {
      found.push(full)
    }
  }
  return found
}

/** Every directory holding a package.json, recursively; build trees skipped. */
function collectPackageDirs(dir, found = []) {
  for (const entry of readEntries(dir)) {
    if (!entry.isDirectory()) continue
    if (['node_modules', '.git', 'dist', 'lib', 'target', '.dsh-build'].includes(entry.name)) continue
    const full = join(dir, entry.name)
    if (existsSync(join(full, 'package.json'))) found.push(full)
    collectPackageDirs(full, found)
  }
  return found
}

/** Repo-relative path with forward slashes. 仓库相对路径（正斜杠）。 */
function repoPath(file) {
  return relative(root, file).replaceAll('\\', '/')
}

/** Why a file counts as stray build output, or null when it is fine. */
function offenseOf(file) {
  if (MAP_SUFFIXES.some(suffix => file.endsWith(suffix))) {
    return 'generated source map / 生成的 source map'
  }
  const suffix = EMITTED_SUFFIXES.find(candidate => file.endsWith(candidate))
  if (!suffix) return null
  const stem = file.slice(0, -suffix.length) // emitted stem 去掉产物后缀
  const twin = existsSync(`${stem}.ts`) || existsSync(`${stem}.tsx`)
  return twin ? 'emitted next to its .ts source / 与 .ts 源并排的编译产物' : null
}

/** Strip comments while respecting string/template literals. 按字符串状态剥离注释。 */
function stripComments(code) {
  let out = ''
  let mode = 'code' // code | line | block | ' | " | `
  for (let i = 0; i < code.length; i += 1) {
    const c = code[i]
    const n = code[i + 1]
    if (mode === 'code') {
      if (c === '/' && n === '/') { mode = 'line'; i += 1 } else if (c === '/' && n === '*') { mode = 'block'; i += 1 } else {
        if (c === "'" || c === '"' || c === '`') mode = c
        out += c
      }
    } else if (mode === 'line') {
      if (c === '\n') { mode = 'code'; out += c }
    } else if (mode === 'block') {
      if (c === '*' && n === '/') { mode = 'code'; i += 1 }
    } else if (c === '\\') { out += c + (n ?? ''); i += 1 } else if (c === mode) { mode = 'code'; out += c } else { out += c }
  }
  return out
}

/** Runtime first-party import names via statement-level patterns. 语句级运行时引用。 */
function firstPartyRuntimeRefs(code) {
  const found = new Set()
  const collect = specifier => found.add(specifier.split('/').slice(0, 2).join('/')) // bare name 裸包名
  const SPEC = `['"]((?:@veren/[a-z0-9][a-z0-9.-]*)(?:/[a-zA-Z0-9._/-]+)?)['"]`
  // Never cross an import/export/from keyword (repo style omits semicolons)
  // and never match a method/property keyword (`.from(`). 不跨语句、不匹配方法名。
  const SPAN = `(?:(?!\\b(?:import|export|from)\\b)[^;])*?`
  const kw = keyword => `(?<![\\w.$])${keyword}`
  const patterns = [
    [`import\\s+(?!type\\b)${SPAN}\\bfrom\\s*`, 'g'], // import { x } from '...'
    [`${kw('import')}\\s*`, 'g'], // bare side-effect import
    [`${kw('import')}\\s*\\(\\s*`, 'g'], // dynamic import
    [`${kw('require')}\\s*\\(\\s*`, 'g'], // require()
    [`${kw('export')}\\s+(?!type\\b)${SPAN}\\bfrom\\s*`, 'g'], // runtime re-export
  ]
  for (const [body, flags] of patterns) {
    for (const match of code.matchAll(new RegExp(body + SPEC, flags))) {
      if (/\btypeof\s*$/.test(code.slice(0, match.index))) continue // type-only 类型位置
      collect(match[1])
    }
  }
  return found
}

/** Check 1: nothing emitted sits beside its source. 检查一：产物不得与源码并排。 */
function checkSrcAdjacent(problems) {
  for (const searchRoot of SEARCH_ROOTS) {
    for (const srcDir of collectSrcDirs(join(root, searchRoot), [])) {
      for (const file of collectFiles(srcDir)) {
        const reason = offenseOf(file)
        if (reason) problems.push({ path: repoPath(file), reason })
      }
    }
  }
}

/** Check 2: every dist artifact has a src twin. 检查二：dist 产物必须有 src 孪生。 */
function checkStaleDist(problems, allowed) {
  for (const searchRoot of SEARCH_ROOTS) {
    for (const pkgDir of collectPackageDirs(join(root, searchRoot))) {
      const srcDir = join(pkgDir, 'src'); const distDir = join(pkgDir, 'dist')
      if (!existsSync(srcDir) || !existsSync(distDir)) continue
      for (const file of collectFiles(distDir)) {
        const relName = file.slice(distDir.length + 1).replaceAll('\\', '/')
        if (!ARTIFACT_SUFFIX_RE.test(relName)) continue // copied asset, not code
        const stem = relName.replace(ARTIFACT_SUFFIX_RE, '')
        if (SRC_TWIN_SUFFIXES.some(ext => existsSync(join(srcDir, stem + ext)))) continue
        const path = repoPath(file)
        if (STALE_DIST_ALLOWLIST.has(path)) allowed.push(path)
        else problems.push({ path, reason: 'stale dist artifact (no src twin) / 陈旧 dist 产物（无 src 孪生）' })
      }
    }
  }
}

/** Parsed package.json or null. 解析 package.json，失败返回 null。 */
function readManifest(pkgDir) {
  try {
    return JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'))
  } catch {
    return null
  }
}

/**
 * Runtime first-party imports of a package: src (statement-level) plus emitted
 * dist js (ground truth). Returns name -> sample file, self-imports dropped.
 * 包的运行时第一方引用：src 走语句级匹配，dist 编译产物按事实标准全算；
 * 返回 包名 -> 样例文件，剔除自身引用。
 */
function collectRuntimeRefs(pkgDir, ownName) {
  const refs = new Map()
  const note = (name, file) => { if (name !== ownName && !refs.has(name)) refs.set(name, file) }
  const srcDir = join(pkgDir, 'src')
  if (existsSync(srcDir)) {
    for (const file of collectFiles(srcDir)) {
      if (!/\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(file)) continue
      for (const dep of firstPartyRuntimeRefs(stripComments(readFileSync(file, 'utf8')))) note(dep, file)
    }
  }
  const distDir = join(pkgDir, 'dist')
  if (existsSync(distDir)) {
    for (const file of collectFiles(distDir)) {
      if (!/\.(?:js|mjs|cjs)$/.test(file)) continue // .d.ts is type surface / .d.ts 属类型面
      for (const dep of firstPartyRuntimeRefs(readFileSync(file, 'utf8'))) note(dep, file)
    }
  }
  return refs
}

/** Check 3: runtime first-party imports live in dependencies. 检查三：运行时引用须在 dependencies。 */
function checkFirstPartyDeps(problems) {
  for (const searchRoot of SEARCH_ROOTS) {
    for (const pkgDir of collectPackageDirs(join(root, searchRoot))) {
      const manifest = readManifest(pkgDir)
      if (!manifest || typeof manifest.name !== 'string') continue
      const deps = manifest.dependencies ?? {}
      const peer = manifest.peerDependencies ?? {}
      for (const [dep, file] of collectRuntimeRefs(pkgDir, manifest.name)) {
        if (dep in deps) continue
        problems.push({
          path: repoPath(file),
          reason: dep in peer
            ? `runtime import of ${dep} declared only as peer (pnpm v10 skips peers) / 运行时 import ${dep} 只挂在 peer（pnpm v10 不装 peer）`
            : `runtime import of ${dep} not declared in dependencies / 运行时 import ${dep} 未声明进 dependencies`,
        })
      }
    }
  }
}

const problems = [], allowed = []
checkSrcAdjacent(problems)
checkStaleDist(problems, allowed)
checkFirstPartyDeps(problems)

if (problems.length > 0) {
  process.stderr.write('build-hygiene guard found violations / 构建卫生守卫发现违规:\n')
  process.stderr.write(problems.map(problem => `  ${problem.path}\n    ${problem.reason}\n`).join(''))
  process.stderr.write(
    `\n${problems.length} violation(s). Fix the sources or manifests listed above / ` +
      `共 ${problems.length} 项违规；请修复上列源码或 manifest。\n`,
  )
  process.exit(1)
}

if (allowed.length > 0) {
  process.stdout.write(
    `src-artifacts: ${allowed.length} allowlisted stale dist file(s) await their frozen lane / ${allowed.length} 个白名单内陈旧 dist 产物待属主泳道清理\n`,
  )
}

process.stdout.write('src-artifacts: clean / 构建卫生检查通过：源码旁无产物、dist 无陈旧残留、第一方依赖契约完好\n')
