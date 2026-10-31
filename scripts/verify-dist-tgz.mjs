/**
 * 交付产物级安装形态验证：把 `dist-tgz/` 里打好的 tarball 按"装进 profile 后"
 * 的样子展开进系统临时目录的假 `node_modules`，再用**普通 node**（无 tsx、无
 * 路径别名）按包名 import。
 *
 * 与 `scripts/verify-packed-entries.mjs` 的分工：那个脚本从源码目录现打包，
 * @veren/* 兄弟包链回工作区，且不能处理没有 `.` 导出的配置型组合包；本脚本
 * 只吃**已经打好的 tarball 产物**，额外覆盖三件交付期才暴露的事：
 * 1. 组合包的成员依赖必须是 registry 可解析的区间（`^x.y.z`），**不允许**
 *    `file:`/`workspace:`——成员已由 `market/release.mjs` 按拓扑序发布，
 *    产物因此能分发给任何机器；`--offline` 时反过来校验兄弟 `file:` tarball；
 * 2. 组合包按 `dsh.bundle.patch` 声明校验 patch 文件在包内；
 * 3. 入口解析证明：`require.resolve` 命中的是 dist 产物，而不是 src 源码。
 *
 * tar 解包一律走共享库 `scripts/lib/packed-tarball.mjs`（固定系统 bsdtar——
 * Git Bash PATH 里的 GNU tar 会把 `C:\...` 当远程主机）。
 *
 * 依赖供给模拟宿主：tarball 覆盖不了的 peer/第三方依赖从仓库根解析后链入假根
 * （仓库 `shamefully-hoist` 保证树内存在的包都在根 node_modules 可解析）。
 * 本脚本只读工作区与 tarball、只写系统临时目录，不触碰任何 DSH profile。
 *
 * Deliverable-grade install-form verification: unfold packed tarballs from
 * `dist-tgz/` into a fake `node_modules` under the system temp directory
 * exactly as a profile install would, then `import()` by bare package name
 * **with plain node** (no tsx, no path aliases).
 *
 * Division of labor with `scripts/verify-packed-entries.mjs`: that script
 * packs fresh from source directories, links @veren/* siblings back to the
 * workspace, and cannot handle configuration-only bundles without a `.`
 * export; this one consumes **already packed tarballs** and additionally
 * covers three delivery-time facts:
 * 1. a bundle's member dependencies must be registry-resolvable ranges
 *    (`^x.y.z`), **never** `file:`/`workspace:` — members are published in
 *    dependency order by `market/release.mjs`, so the artifact is installable
 *    on any machine; `--offline` checks the sibling `file:` tarballs instead;
 * 2. a bundle's `dsh.bundle.patch` file must be present inside the package;
 * 3. entry-resolution proof: `require.resolve` must hit the dist artifact,
 *    not the src source.
 *
 * All tar extraction goes through the shared library
 * `scripts/lib/packed-tarball.mjs` (pinned system bsdtar — GNU tar resolved
 * from a Git Bash PATH treats `C:\...` as a remote host).
 *
 * The fake root plays the host: peers and third-party deps not covered by the
 * given tarballs are resolved from the repository root and linked in (the
 * repo's `shamefully-hoist` guarantees anything in the tree resolves at the
 * root node_modules). The script only reads the workspace and tarballs and
 * only writes the system temp directory; no DSH profile is touched.
 *
 * Usage / 用法:
 *   node scripts/verify-dist-tgz.mjs [--offline] <tarball> [tarball...]
 *
 * @module @veren/scripts/verify-dist-tgz
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  assertPluginShape,
  entryOf,
  extractTarball,
  loadWithPlainNode,
  readPackedManifest,
  resolvePackageRoot,
} from './lib/packed-tarball.mjs'
import { manifestProblems } from './lib/dist-tgz-contract.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const tarballs = process.argv.slice(2).filter(argument => argument !== '--offline')
if (tarballs.length === 0) {
  process.stderr.write('usage: node scripts/verify-dist-tgz.mjs [--offline] <tarball> [tarball...]\n')
  process.exit(2)
}

/** 校验口径：默认要求 registry 区间；`--offline` 要求兄弟 file: tarball / expected dependency form. */
const OFFLINE = process.argv.includes('--offline')

const fakeRoot = mkdtempSync(join(tmpdir(), 'veren-dist-tgz-check-'))
const modulesDir = join(fakeRoot, 'node_modules')
mkdirSync(modulesDir)

/** 已展开的清单，包名 -> 安装形态目录 / extracted manifests, name -> installed dir. */
const installed = new Map()

/** 链接进假根的依赖名集合 / dependency names already linked into the fake root. */
const linked = new Set()

/** 校验中发现的问题 / problems found across all tarballs. */
const failures = []

/**
 * 按安装形态展开一个 tarball：直接 --strip-components 解到假 node_modules 的
 * 包名目录下（避开 Windows 上刚解压目录被杀软短暂占用导致的 rename EPERM）。
 * Unfold one tarball in install form: extract with --strip-components straight
 * into the fake node_modules under the package name (avoids the Windows
 * rename-EPERM race on freshly extracted directories).
 *
 * @param {string} tarball - packed tarball / 打包产物
 * @returns {{ manifest: object, dir: string }} manifest and install dir / 清单与安装目录
 */
function unfold(tarball) {
  const manifest = readPackedManifest(tarball)
  const dir = join(modulesDir, manifest.name)
  mkdirSync(dir, { recursive: true })
  extractTarball(tarball, dir, { strip: 1 })
  installed.set(manifest.name, { manifest, dir })
  return installed.get(manifest.name)
}

/**
 * 把一个运行时依赖链进假根：已被 tarball 覆盖的包直接复用，@veren/* 解析回
 * 工作区物理目录，其余解析到仓库里的物理实体包。
 * Link one runtime dependency into the fake root: reuse packages already
 * unfolded from tarballs, resolve @veren/* back to their workspace physical
 * directory, and anything else to its physical package in the repo.
 *
 * @param {string} name - dependency name / 依赖名
 */
function linkRuntimeDependency(name) {
  if (linked.has(name) || installed.has(name)) return
  const linkPath = join(modulesDir, name)
  if (existsSync(linkPath)) {
    linked.add(name)
    return
  }
  const target = resolvePackageRoot(name, root)
  mkdirSync(dirname(linkPath), { recursive: true })
  symlinkSync(target, linkPath, 'junction')
  linked.add(name)
}

/**
 * 收集清单声明的一个运行时依赖段里的包名 / collect the names of one runtime dependency section.
 *
 * @param {object} manifest - package manifest / 包清单
 * @returns {string[]} dependency names / 依赖名列表
 */
function runtimeNames(manifest) {
  const names = []
  for (const section of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    names.push(...Object.keys(manifest[section] ?? {}))
  }
  return names
}

/**
 * 验证一个配置型组合包：exports["./package.json"] 必须解析到假根内的安装副本
 * （ESM 导入 JSON 需要 import attribute，这里不必真读）。
 * Verify one configuration-only bundle: exports["./package.json"] must resolve
 * to the installed copy inside the fake root (an ESM JSON import would need an
 * import attribute; reading it is unnecessary).
 *
 * @param {object} manifest - installed manifest / 安装形态清单
 * @param {string} dir - installed directory / 安装目录
 */
function verifyConfigBundle(manifest, dir) {
  const require = createRequire(join(dir, 'package.json'))
  const resolved = require.resolve(`${manifest.name}/package.json`).replaceAll('\\', '/')
  if (!resolved.startsWith(modulesDir.replaceAll('\\', '/'))) {
    throw new Error(`./package.json resolved outside the installed copy: ${resolved}`)
  }
  process.stdout.write(`ok       ${manifest.name}@${manifest.version} (config bundle) deps ${OFFLINE ? 'rewritten to sibling tarballs' : 'resolve from the registry'}\n`)
}

/**
 * 验证一个带运行时入口的包：普通 node 能加载、require.resolve 命中 dist、
 * 插件形态合法。
 * Verify one package with a runtime entry: plain node can load it,
 * require.resolve hits a dist artifact, and the plugin shape is legal.
 *
 * @param {object} manifest - installed manifest / 安装形态清单
 * @param {string} dir - installed directory / 安装目录
 */
function verifyRuntimePackage(manifest, dir) {
  const keys = loadWithPlainNode(manifest.name, fakeRoot)
  if (keys.length === 0) throw new Error('entry module exports nothing')
  const require = createRequire(join(dir, 'package.json'))
  const resolvedEntry = require.resolve(manifest.name).replaceAll('\\', '/')
  if (!resolvedEntry.includes('/dist/')) {
    throw new Error(`require.resolve hit ${resolvedEntry}, not a dist artifact`)
  }
  if (manifest.dsh !== undefined && manifest.dsh.bundle === undefined) {
    assertPluginShape(require(manifest.name))
  }
  process.stdout.write(`ok       ${manifest.name}@${manifest.version} entry ${resolvedEntry.slice(modulesDir.length + 1)} exports: ${keys.join(', ')}\n`)
}

/**
 * 验证单个 tarball：展开 → 清单断言 → 链依赖 → 按形态验证。
 * Verify one tarball: unfold, assert the manifest, link dependencies, verify
 * by package shape.
 *
 * @param {string} tarballPath - resolved tarball path / 解析后的 tarball 路径
 */
function verifyTarball(tarballPath) {
  const { manifest, dir } = unfold(tarballPath)
  for (const problem of manifestProblems(manifest, dir, OFFLINE)) {
    failures.push(`${manifest.name}: ${problem}`)
  }
  for (const name of runtimeNames(manifest)) linkRuntimeDependency(name)
  if (entryOf(manifest) === null) verifyConfigBundle(manifest, dir)
  else verifyRuntimePackage(manifest, dir)
}

for (const tarball of tarballs) {
  const path = resolve(tarball)
  if (!existsSync(path)) {
    failures.push(`${tarball}: no such tarball`)
    continue
  }
  try {
    verifyTarball(path)
  } catch (error) {
    failures.push(`${tarball}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

rmSync(fakeRoot, { recursive: true, force: true })

if (failures.length > 0) {
  process.stderr.write(`\n${failures.length} problem(s) in the packed deliverables:\n`)
  for (const failure of failures) process.stderr.write(`  - ${failure}\n`)
  process.exit(1)
}
process.stdout.write(`\n${tarballs.length} tarball(s) load from their install form under plain node.\n`)
