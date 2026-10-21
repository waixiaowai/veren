/**
 * DSH 单实例门禁：保证每个与宿主共享实例的包在**解析后**只有一份物理副本。
 *
 * 背景：`check:plugins` 只看清单声明（dependencies/peer/dev 的位置与区间），
 * 看不见解析结果。本仓库踩过的坑是同一份 `@deepseek-ai/dsh-tools` 在磁盘上
 * 出现多条物理路径（hoisted 安装把它复制到根顶层真实目录，同时各包 node_modules
 * 里又有指向 .pnpm 不同条目的链接）。`ToolExecutionToken` 这类 brand 类型用唯一
 * symbol 打标，symbol 按模块路径区分——两条路径就是两个 symbol，同名类型互不
 * 兼容，报错却长得像普通类型不匹配，几乎无法从报错本身看出是"装了两份"。
 *
 * 规则（对 `@deepseek-ai/cordis` 与所有 `@deepseek-ai/dsh-*` 生效；graph 前缀
 * 是本仓库自己的包，不在其列）：
 * 1. 解析位置必须是唯一物理路径：根 node_modules 与每个工作区包 node_modules 里
 *    该名字经 realpath 归并后只能有一个——多个即失败，逐路径列出是谁链接的；
 * 2. 解析到的版本必须唯一：同一名字被解析成多个版本即失败，逐版本点名；
 * 3. 声明点名：dsh-* 只允许统一窗口（peer）与统一精确版本（dev 镜像），其他
 *    声明即失败——是这些声明把解析拉出单实例的，必须先改声明。cordis 不在此列：
 *    根 overrides 已把它钉到 ^4.0.5，规则 1/2 直接验证解析结果，比约束写法更准。
 *
 * DSH single-instance gate: every package that must share the host's instance
 * must resolve to exactly one physical copy.
 *
 * Background: `check:plugins` only reads manifest declarations; it cannot see
 * the resolution result. The trap this repo hit: one `@deepseek-ai/dsh-tools`
 * existed at several physical paths at once (hoisted installs copy it to a real
 * directory at the workspace root while package-level node_modules keep links
 * into different .pnpm entries). Brand types such as `ToolExecutionToken` carry
 * a unique symbol, and symbols are keyed by module path — two paths are two
 * symbols, so same-named types stop being assignable while the error itself
 * reads like an ordinary type mismatch.
 *
 * Rules (for `@deepseek-ai/cordis` and every `@deepseek-ai/dsh-*`; the graph-
 * prefix belongs to this repo and is excluded):
 * 1. One physical path: the root node_modules copy and every workspace
 *    package's node_modules copy must collapse to a single realpath — several
 *    paths fail, each one attributed to the link that produced it;
 * 2. One resolved version: more than one version fails, each one named;
 * 3. Declaration naming: dsh-* may only declare the one peer window or the one
 *    exact dev mirror — anything else fails, because those declarations are
 *    what pull resolution apart. cordis is exempt: the root overrides pin it
 *    to ^4.0.5 and rules 1/2 verify the outcome instead.
 *
 * @module @veren/scripts/check-dsh-instances
 */

import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** dsh peer 的唯一规范区间 / the one sanctioned range for dsh peers. */
export const DSH_RUNTIME_RANGE = '>=0.2.1-rc.2 <0.3.0'

/** dsh dev 镜像的唯一规范精确版本 / the one sanctioned exact dev version. */
export const DSH_DEV_VERSION = '0.2.1-rc.2'

/** 本仓库自己的 dsh 前缀，不属于宿主运行时 / our own dsh- prefix, not host runtime. */
const OWN_DSH_PREFIX = '@deepseek-ai/dsh-graph-'

/**
 * 一个名字是否必须与宿主共享实例（与 check-plugin-manifests 同一把尺）。
 * Whether a name must share the host instance (same rule as check-plugin-manifests).
 *
 * @param {string} name - package name / 包名
 * @returns {boolean}
 */
export function isHostShared(name) {
  if (!name.startsWith('@deepseek-ai/')) return false
  if (name.startsWith(OWN_DSH_PREFIX)) return false
  return name === '@deepseek-ai/cordis' || name.startsWith('@deepseek-ai/dsh-')
}

/**
 * 一个声明区间是否规范。dsh-* 只认统一窗口与统一精确 dev 副本；cordis 交给
 * 根 overrides 兜底，规则 1/2 验证解析结果。
 * Whether a declared range is sanctioned. dsh-* may only use the one window or
 * the one exact dev version; cordis is left to the root overrides and rules
 * 1/2 verify the outcome.
 *
 * @param {string} name - package name / 包名
 * @param {string} range - declared range / 声明区间
 * @returns {boolean}
 */
export function isSanctionedRange(name, range) {
  if (name === '@deepseek-ai/cordis') return true
  return range === DSH_RUNTIME_RANGE || range === DSH_DEV_VERSION
}

/**
 * 递归收集含 package.json 的工作区包目录，跳过 node_modules。
 * Recursively collect workspace package dirs containing a manifest, skipping node_modules.
 *
 * @param {string} base - directory to scan / 待扫描目录
 * @param {number} [depth] - recursion limit against symlink cycles / 防符号环的递归上限
 * @returns {string[]} absolute package dirs / 包目录绝对路径
 */
function packageDirs(base, depth = 0) {
  if (depth > 4 || !existsSync(base)) return []
  const dirs = []
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'node_modules') continue
    const dir = join(base, entry.name)
    if (existsSync(join(dir, 'package.json'))) dirs.push(dir)
    else dirs.push(...packageDirs(dir, depth + 1))
  }
  return dirs
}

/**
 * 读取清单，目录没有则返回 undefined。Read a manifest, or undefined when absent.
 *
 * @param {string} dir - package directory / 包目录
 * @returns {object | undefined}
 */
function readManifest(dir) {
  const file = join(dir, 'package.json')
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : undefined
}

/**
 * 工作区里所有"消费者"目录：根与每个工作区包，用于找 node_modules 下的副本。
 * Every consumer directory in the workspace: the root plus each package.
 *
 * @returns {string[]} absolute dirs / 绝对目录
 */
function consumerDirs() {
  const dirs = [root]
  for (const base of ['plugins', 'packages', 'apps']) {
    dirs.push(...packageDirs(join(root, base)))
  }
  return dirs
}

/**
 * 收集宿主共享包名的全集与全部"名字 -> 声明"记录。
 * Collect every host-shared name plus all "name -> declaration" records.
 *
 * @returns {{ names: Set<string>, declarations: Array<{ pkg: string, section: string, name: string, range: string }> }}
 */
function collectDeclarations() {
  const names = new Set()
  const declarations = []
  for (const dir of consumerDirs()) {
    const manifest = readManifest(dir)
    if (manifest === undefined) continue
    const pkg = typeof manifest.name === 'string' ? manifest.name : relative(root, dir)
    for (const section of ['dependencies', 'peerDependencies', 'devDependencies', 'optionalDependencies']) {
      for (const [name, range] of Object.entries(manifest[section] ?? {})) {
        if (!isHostShared(name)) continue
        names.add(name)
        declarations.push({ pkg, section, name, range })
      }
    }
  }
  return { names, declarations }
}

/**
 * 读取一个物理包目录的版本。Read the version of one physical package dir.
 *
 * @param {string} dir - physical package dir / 物理包目录
 * @returns {string | undefined}
 */
function dirVersion(dir) {
  const file = join(dir, 'package.json')
  if (!existsSync(file)) return undefined
  return JSON.parse(readFileSync(file, 'utf8')).version
}

/**
 * 找出一个名字在所有消费方 node_modules 里的物理解析位置（realpath 归并）。
 * Collect the physical resolution of one name across every consumer's
 * node_modules, merged by realpath.
 *
 * @param {string} name - package name / 包名
 * @param {string[]} consumers - consumer dirs / 消费方目录
 * @returns {Map<string, string[]>} realpath -> the paths that point at it / 物理路径 -> 指向它的位置
 */
function physicalLocations(name, consumers) {
  const locations = new Map()
  for (const dir of consumers) {
    const link = join(dir, 'node_modules', ...name.split('/'))
    if (!existsSync(link)) continue
    let physical
    try {
      physical = realpathSync(link)
    } catch {
      physical = link
    }
    const key = relative(root, physical)
    const from = relative(root, link)
    if (!locations.has(key)) locations.set(key, [])
    locations.get(key).push(from)
  }
  return locations
}

/**
 * 单实例检查主体：返回违规描述数组，空数组即通过。
 * The check body: return violation descriptions, empty means pass.
 *
 * @returns {string[]}
 */
export function collectInstanceProblems() {
  const problems = []
  const { names, declarations } = collectDeclarations()
  const consumers = consumerDirs()

  // 规则 3 先行：不合规的声明是分叉源头，先点名。
  // Rule 3 first: out-of-policy declarations are what fork the resolution.
  for (const { pkg, section, name, range } of declarations) {
    if (!isSanctionedRange(name, range)) {
      problems.push(`${pkg} (${section}): ${name}@${range} is outside the sanctioned declarations (peer ${DSH_RUNTIME_RANGE} / dev ${DSH_DEV_VERSION})`)
    }
  }

  for (const name of names) {
    const locations = physicalLocations(name, consumers)
    if (locations.size <= 1) continue

    const rows = [...locations.entries()].map(([physical, links]) => {
      const version = dirVersion(join(root, physical))
      return { physical, version: version ?? 'unknown', links }
    })

    // 规则 2：多版本点名。
    // Rule 2: name every version.
    const versions = new Set(rows.map(row => row.version))
    if (versions.size > 1) {
      const lines = rows
        .map(row => `    ${row.version} at ${row.physical}\n      used by: ${row.links.join(', ')}`)
        .join('\n')
      problems.push(`${name} resolves to ${versions.size} versions (${[...versions].join(', ')}) — every importer must share one instance:\n${lines}`)
    }

    // 规则 1：同版本也必须是同一物理路径。
    // Rule 1: even one version must be one physical path.
    const lines = rows
      .map(row => `    ${row.version} at ${row.physical}\n      used by: ${row.links.join(', ')}`)
      .join('\n')
    problems.push(
      `${name} resolves to ${locations.size} physical copies — brand symbols are keyed by module path, so same-named types stop being assignable:\n${lines}\n    hint: one copy per name needs a single linker layout (node-linker=isolated); several .pnpm entries for one version mean the peers resolve differently per importer.`,
    )
  }
  return problems
}

/** 独立运行入口：node scripts/check-dsh-instances.mjs / standalone CLI entry. */
if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const found = collectInstanceProblems()
  if (found.length > 0) {
    process.stderr.write(`\n${found.length} DSH instance problem(s):\n`)
    for (const problem of found) process.stderr.write(`  - ${problem}\n`)
    process.stderr.write('\nOne host-shared package must resolve to exactly one physical copy; fix the declarations first.\n')
    process.exit(1)
  }
  process.stdout.write('every host-shared DSH package resolves to a single physical instance\n')
}
