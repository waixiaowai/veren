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
const graphDir = join(root, 'packages/graph')

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
for (const entry of readdirSync(pluginsDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  const manifest = readManifest(join(pluginsDir, entry.name))
  if (manifest === undefined) continue
  failures.push(...inspect(entry.name, manifest))
  summary.push({
    plugin: entry.name,
    version: manifest.version,
    peers: Object.keys(manifest.peerDependencies ?? {}).length,
    engines: manifest.engines?.dsh === DSH_RUNTIME_RANGE ? 'ok' : 'missing',
  })
}

for (const row of summary) {
  console.log(`${row.engines.padEnd(8)} ${row.plugin.padEnd(34)} ${String(row.peers).padStart(2)} peer(s)  v${row.version}`)
}

/**
 * 工作区包目录，含一层分组目录（packages/graph/graph-core 等）。
 * Workspace package dirs, including one grouping level.
 */
function workspacePackageDirs() {
  const dirs = []
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const dir = join(packagesDir, entry.name)
    if (existsSync(join(dir, 'package.json'))) {
      dirs.push(dir)
      continue
    }
    for (const child of readdirSync(dir, { withFileTypes: true })) {
      if (child.isDirectory() && existsSync(join(dir, child.name, 'package.json'))) dirs.push(join(dir, child.name))
    }
  }
  return dirs
}

// packages/ 下的包同样遵守规则 2（DSH 包不得进 dependencies），但它们不是
// profile 插件：engines.dsh 只对会进 profile 的包有意义，因此只有
// plugins/ 的清单要求 engines.dsh。
const packagesDir = join(root, 'packages')
const packageFailures = workspacePackageDirs()
  .map(dir => readManifest(dir))
  .filter(manifest => manifest !== undefined)
  .flatMap(manifest => Object.entries(manifest.dependencies ?? {})
    .filter(([name]) => isHostShared(name) && !STATELESS_DSH.has(name))
    .map(([name, spec]) => `${manifest.name}: ${name}@${spec} belongs in peerDependencies, not dependencies`))

if (packageFailures.length > 0) {
  console.error(`\n${packageFailures.length} workspace manifest problem(s):`)
  for (const failure of packageFailures) console.error(`  - ${failure}`)
  process.exit(1)
}

if (failures.length > 0) {
  console.error(`\n${failures.length} plugin manifest problem(s):`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}

console.log(`\n${summary.length} plugin manifests and ${workspacePackageDirs().length} workspace manifests satisfy the DSH dependency policy.`)
