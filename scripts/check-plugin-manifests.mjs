/**
 * 插件清单门禁：把“DSH 依赖怎么声明”从人工记忆变成可执行的检查。
 *
 * 规则（与 DSH 官方插件发布指南一致）：
 * 1. 每个插件/组合包都声明 `engines.dsh`，它是唯一的版本契约；DSH 启动与安装
 *    只会读 `engines.dsh` 或 `@deepseek-ai/dsh*` 的 peerDependencies。
 * 2. 需要与宿主共享实例的包（cordis 与所有 dsh-* 运行时包）只能出现在
 *    `peerDependencies`，并在 `devDependencies` 里放同版本副本供类型检查与测试。
 *    写进 `dependencies` 会让 profile 安装第二份实例。
 * 3. `dependencies` 只允许无状态 dsh 工具包（brand/util-values/util-crypto）、
 *    `schemastery`（官方指定的运行时校验器）、第三方包与 @veren/* 包。
 * 4. 每个 peer 必须有 devDependencies 镜像，且 dsh peer 使用统一区间。
 *
 * Plugin-manifest gate: turns "how to declare a DSH dependency" from human
 * memory into an executable check.
 *
 * Rules (matching the official DSH plugin-publishing guide):
 * 1. Every plugin/bundle declares `engines.dsh`; it is the single version
 *    contract, because DSH reads only `engines.dsh` or `@deepseek-ai/dsh*`
 *    peerDependencies at install and startup.
 * 2. Packages that must share one instance with the host (cordis and every
 *    runtime dsh-* package) belong in `peerDependencies`, mirrored at the same
 *    version in `devDependencies` for type checking and tests. A `dependencies`
 *    entry makes the profile install a second instance.
 * 3. `dependencies` may hold only stateless dsh utilities
 *    (brand/util-values/util-crypto), `schemastery` (the sanctioned runtime
 *    validator), third-party packages, and @veren/* packages.
 * 4. Every peer needs a devDependencies mirror, and dsh peers use one range.
 *
 * @module @veren/scripts/check-plugin-manifests
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { collectInstanceProblems } from './check-dsh-instances.mjs'

/** 所有插件与组合包使用的唯一 DSH 版本区间 / the one DSH runtime range every plugin declares. */
export const DSH_RUNTIME_RANGE = '>=0.2.1-rc.2 <0.3.0'

/** 允许进 dependencies 的无状态 dsh 包 / stateless dsh packages allowed under dependencies. */
const STATELESS_DSH = new Set([
  '@deepseek-ai/dsh-brand',
  '@deepseek-ai/dsh-util-values',
  '@deepseek-ai/dsh-util-crypto',
])

/**
 * 本仓库自己发布的 `@deepseek-ai/dsh-graph-*` 也带 dsh- 前缀，但它们不是 DSH 运行时包，
 * 只是自己的组合成员；DSH 的兼容性检查会按名字把它们误当运行时要求，因此每个 graph 包
 * 必须声明 engines.dsh 让 peer 区间不再参与判定。
 *
 * Our own `@deepseek-ai/dsh-graph-*` packages also carry the dsh- prefix but are not DSH
 * runtime packages, only bundle members. DSH's compatibility check would misread their
 * peer ranges as runtime requirements, so every graph package must declare engines.dsh.
 */
const OWN_DSH_PREFIX = '@deepseek-ai/dsh-graph-'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pluginsDir = join(root, 'plugins')
const packagesDir = join(root, 'packages')

/** 读取一个目录下的 package.json，没有则返回 undefined / read a manifest, or undefined. */
function readManifest(dir) {
  const file = join(dir, 'package.json')
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : undefined
}

/** 判断一个依赖名是否需要与宿主共享实例 / whether a name must share the host instance. */
function isHostShared(name) {
  if (name.startsWith(OWN_DSH_PREFIX)) return false
  return name === '@deepseek-ai/cordis' || name.startsWith('@deepseek-ai/dsh-')
}

/** 收集一个插件的清单违规 / collect one plugin's manifest violations. */
function inspect(dirName, manifest) {
  const problems = []
  const dependencies = manifest.dependencies ?? {}
  const peers = manifest.peerDependencies ?? {}
  const dev = manifest.devDependencies ?? {}

  if (manifest.engines?.dsh !== DSH_RUNTIME_RANGE) {
    problems.push(`engines.dsh must be "${DSH_RUNTIME_RANGE}" (got ${JSON.stringify(manifest.engines?.dsh)})`)
  }
  for (const [name, spec] of Object.entries(dependencies)) {
    if (isHostShared(name) && !STATELESS_DSH.has(name)) {
      problems.push(`${name}@${spec} belongs in peerDependencies, not dependencies`)
    }
  }
  for (const [name, range] of Object.entries(peers)) {
    if (name.startsWith('@veren/')) continue
    if (!(name in dev)) problems.push(`peer ${name} has no devDependencies mirror`)
    if (isHostShared(name) && range !== DSH_RUNTIME_RANGE && name !== '@deepseek-ai/cordis') {
      problems.push(`peer ${name} must use "${DSH_RUNTIME_RANGE}" (got ${range})`)
    }
  }
  if (manifest.dsh?.bundle !== undefined && manifest.engines?.dsh !== DSH_RUNTIME_RANGE) {
    problems.push('a bundle needs engines.dsh so profile startup can refuse it')
  }
  return problems.map(problem => `${dirName}: ${problem}`)
}

const failures = []
const summary = []

/**
 * 工作区里实际存在的包名集合 / the set of package names the workspace really contains.
 *
 * 一个组合包依赖的成员若不存在，`pnpm install` 会直接失败，而门禁此前看不见：
 * 清单本身完全合规，只有解析依赖时才暴露。本集合让门禁在提交前就报出来。
 *
 * A bundle depending on a member that does not exist breaks `pnpm install`
 * outright, and no declaration rule catches it: the manifest is entirely
 * compliant and the failure only appears when the dependencies resolve. This
 * set makes the gate report it before the commit.
 */
const workspaceNames = new Set()

/**
 * 递归收集 plugins/ 下的包目录，跳过 node_modules。
 * plugins/ 下的分组目录可以再嵌套一层（admin/contract、admin/providers/x），
 * 只扫一层会让新插件静默逃过门禁——这正是本脚本存在的原因，所以它必须随目录
 * 结构变化而更新。改用 pnpm-workspace.yaml 的 globs 做这件事，最稳妥。
 *
 * Recursively collect package dirs under plugins/, skipping node_modules.
 * A group directory may nest one more level (admin/contract,
 * admin/providers/x); scanning only one level lets a new plugin pass the gate
 * silently, which defeats the gate's purpose. Deriving the set from
 * pnpm-workspace.yaml's globs keeps it correct as the tree grows.
 *
 * @param {string} base - directory to scan.
 * @param {number} [depth] - recursion limit, guarding against a symlink cycle.
 * @returns {string[]} POSIX-style relative package dirs.
 */
function pluginPackageDirs(base, depth = 0) {
  if (depth > 3) return []
  const dirs = []
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'node_modules') continue
    const dir = join(base, entry.name)
    if (existsSync(join(dir, 'package.json'))) dirs.push(entry.name)
    else dirs.push(...pluginPackageDirs(dir, depth + 1).map(child => `${entry.name}/${child}`))
  }
  return dirs
}

for (const dirName of pluginPackageDirs(pluginsDir)) {
  const manifest = readManifest(join(pluginsDir, dirName))
  if (manifest === undefined) continue
  failures.push(...inspect(dirName, manifest))
  summary.push({
    plugin: dirName,
    version: manifest.version,
    peers: Object.keys(manifest.peerDependencies ?? {}).length,
    engines: manifest.engines?.dsh === DSH_RUNTIME_RANGE ? 'ok' : 'missing',
  })
}

/**
 * 收集工作区里全部包名，供组合包成员存在性检查使用。
 * Collect every workspace package name, for the bundle-member existence check.
 *
 * @returns {Set<string>} the names / 包名集合
 */
function collectWorkspaceNames() {
  const names = new Set()
  const seen = new Set()
  const add = (dir) => {
    if (seen.has(dir)) return
    seen.add(dir)
    const manifest = readManifest(dir)
    if (manifest?.name !== undefined) names.add(manifest.name)
  }
  for (const dirName of pluginPackageDirs(pluginsDir)) add(join(pluginsDir, dirName))
  for (const dir of workspacePackageDirs()) add(dir)
  return names
}

/**
 * 一个 @veren/* 依赖必须指向工作区里真实存在的包，否则 pnpm install 直接失败。
 * A @veren/* dependency must name a package the workspace actually contains,
 * or `pnpm install` fails outright.
 *
 * @param {string} dirName - plugin dir, for the message / 插件目录，用于报错
 * @param {object} manifest - the plugin manifest / 插件清单
 * @returns {string[]} violation messages / 违规信息
 */
function inspectMembers(dirName, manifest) {
  return Object.keys(manifest.dependencies ?? {})
    .filter(name => name.startsWith('@veren/') && !workspaceNames.has(name))
    .map(name => `${dirName}: dependency ${name} is not in this workspace; pnpm install would fail`)
}

/**
 * 递归收集 packages/ 下的包目录，与 plugins/ 同一把尺子：分组目录可能再嵌套一层，
 * 只扫一层同样会让新包静默逃过门禁。
 * Collect package dirs under packages/ recursively, with the same rule as
 * plugins/: a group directory may nest one more level, and a one-level scan
 * would let a new package pass the gate silently.
 */
function workspacePackageDirs() {
  const dirs = []
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'node_modules') continue
    const dir = join(packagesDir, entry.name)
    if (existsSync(join(dir, 'package.json'))) dirs.push(dir)
    else for (const child of pluginPackageDirs(dir, 1)) dirs.push(join(dir, child))
  }
  return dirs
}

// Set.prototype.add takes one argument, so a spread would keep only the first
// name; iterate instead.
// Set.prototype.add 只接受一个参数，展开只会留下第一个名字；改为逐个加入。
for (const name of collectWorkspaceNames()) workspaceNames.add(name)
console.log(`workspace package names: ${workspaceNames.size}`)

for (const dirName of pluginPackageDirs(pluginsDir)) {
  const manifest = readManifest(join(pluginsDir, dirName))
  if (manifest !== undefined) failures.push(...inspectMembers(dirName, manifest))
}

for (const row of summary) {
  console.log(`${row.engines.padEnd(8)} ${row.plugin.padEnd(34)} ${String(row.peers).padStart(2)} peer(s)  v${row.version}`)
}

// packages/ 下的包同样遵守规则 2（DSH 包不得进 dependencies），但它们不是
// profile 插件：engines.dsh 只对会进 profile 的包有意义，因此只有
// plugins/ 的清单要求 engines.dsh。
const packageFailures = workspacePackageDirs()
  .map(dir => readManifest(dir))
  .filter(manifest => manifest !== undefined)
  .flatMap(manifest => Object.entries(manifest.dependencies ?? {})
    .filter(([name]) => isHostShared(name) && !STATELESS_DSH.has(name))
    .map(([name, spec]) => `${manifest.name}: ${name}@${spec} belongs in peerDependencies, not dependencies`))

// 清单之外再查解析结果：同一个宿主共享包被解析成多版本/多物理路径时，
// brand 类型按模块路径分裂，报错却看不出是"装了两份"（详见 check-dsh-instances.mjs）。
// Beyond manifests, check the resolution: one host-shared package resolving to
// several versions or physical paths splits brand symbols per module path while
// the error hides the root cause (see check-dsh-instances.mjs).
const allFailures = [...failures, ...packageFailures, ...collectInstanceProblems()]
if (allFailures.length > 0) {
  console.error(`\n${allFailures.length} manifest problem(s):`)
  for (const failure of allFailures) console.error(`  - ${failure}`)
  process.exit(1)
}

console.log(`\n${summary.length} plugin manifests and ${workspacePackageDirs().length} workspace manifests satisfy the DSH dependency policy.`)
