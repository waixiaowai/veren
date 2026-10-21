/**
 * 交付产物级安装形态验证：把 `dist-tgz/` 里打好的 tarball 按"装进 profile 后"
 * 的样子展开进系统临时目录的假 `node_modules`，再用**普通 node**（无 tsx、无
 * 路径别名）按包名 import。
 *
 * 与 `scripts/verify-packed-entries.mjs` 的分工：那个脚本从源码目录现打包，
 * @veren/* 兄弟包链回工作区，且不能处理没有 `.` 导出的配置型组合包；本脚本
 * 只吃**已经打好的 tarball 产物**，额外覆盖三件交付期才暴露的事：
 * 1. 组合包的成员依赖必须已被改写成 `file:` 且目标文件真实存在（`workspace:^`
 *    原样出厂会让安装方去 registry 找一个不存在的版本）；
 * 2. 组合包按 `dsh.bundle.patch` 声明校验 patch 文件在包内；
 * 3. 入口解析证明：`require.resolve` 命中的是 dist 产物，而不是 src 源码。
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
 * 1. a bundle's member dependencies must have been rewritten to `file:` and
 *    the targets must really exist (a shipped `workspace:^` sends the
 *    installer to a registry version that does not exist);
 * 2. a bundle's `dsh.bundle.patch` file must be present inside the package;
 * 3. entry-resolution proof: `require.resolve` must hit the dist artifact,
 *    not the src source.
 *
 * The fake root plays the host: peers and third-party deps not covered by the
 * given tarballs are resolved from the repository root and linked in (the
 * repo's `shamefully-hoist` guarantees anything in the tree resolves at the
 * root node_modules). The script only reads the workspace and tarballs and
 * only writes the system temp directory; no DSH profile is touched.
 *
 * Usage / 用法:
 *   node scripts/verify-dist-tgz.mjs <tarball> [tarball...]
 *
 * @module @veren/scripts/verify-dist-tgz
 */

import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const tarballs = process.argv.slice(2)
if (tarballs.length === 0) {
  process.stderr.write('usage: node scripts/verify-dist-tgz.mjs <tarball> [tarball...]\n')
  process.exit(2)
}

const fakeRoot = mkdtempSync(join(tmpdir(), 'veren-dist-tgz-check-'))
const modulesDir = join(fakeRoot, 'node_modules')
mkdirSync(modulesDir)

/** 已展开的清单，包名 -> 安装形态目录 / extracted manifests, name -> installed dir. */
const installed = new Map()

/** 链接进假根的依赖名集合 / dependency names already linked into the fake root. */
const linked = new Set()

/** pnpm 的 tarball 内固定前缀 / pnpm's fixed tarball inner prefix. */
function readPackedManifest(tarball) {
  const work = mkdtempSync(join(tmpdir(), 'veren-dist-tgz-read-'))
  try {
    // bsdtar 的 -C 必须写在成员模式之前，写在后面会被当成归档成员名。
    // bsdtar requires -C before the member patterns; after them it reads -C
    // and the directory as member names.
    execFileSync('tar', ['-xzf', tarball, '-C', work, 'package/package.json'], { stdio: 'pipe' })
    return JSON.parse(readFileSync(join(work, 'package', 'package.json'), 'utf8'))
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

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
  execFileSync('tar', ['--strip-components=1', '-xzf', tarball, '-C', dir], { stdio: 'pipe' })
  installed.set(manifest.name, { manifest, dir })
  return installed.get(manifest.name)
}

/**
 * 从仓库根解析一个包的真实包根（穿过链接，取物理目录）。
 * Resolve a package name to its physical package root from the repo root
 * (resolution follows links, so the result is the physical directory).
 *
 * @param {string} name - dependency name / 依赖名
 * @returns {string} absolute package root / 包根绝对路径
 */
function resolvePhysicalRoot(name) {
  const require = createRequire(join(root, 'package.json'))
  const entryFile = require.resolve(name)
  let dir = dirname(entryFile)
  while (!existsSync(join(dir, 'package.json'))) {
    const parent = dirname(dir)
    if (parent === dir) throw new Error(`no package.json above ${entryFile}`)
    dir = parent
  }
  return dir
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
  const target = resolvePhysicalRoot(name)
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
 * 入口（main 或 exports["."]）；没有则返回 null（配置型组合包）。
 * The runtime entry (main or exports["."]); null for configuration-only bundles.
 *
 * @param {object} manifest - package manifest / 包清单
 * @returns {string | null} entry path relative to the package root / 相对包根的入口路径
 */
function entryOf(manifest) {
  if (typeof manifest.main === 'string') return manifest.main
  const dot = manifest.exports?.['.']
  if (typeof dot === 'string') return dot
  if (typeof dot?.default === 'string') return dot.default
  return null
}

/**
 * 断言清单自身的交付事实：入口落在 dist、组合包 patch 在包内、组合包成员依赖
 * 已改写为 file: 且目标存在。返回问题列表。
 * Assert the manifest's delivery facts: the entry lives under dist, a bundle's
 * patch file is inside the package, and a bundle's member deps are rewritten
 * to existing file: targets. Returns the problem list.
 *
 * @param {object} manifest - the installed manifest / 安装形态清单
 * @param {string} dir - installed package directory / 安装目录
 * @returns {string[]} problems / 问题列表
 */
function manifestProblems(manifest, dir) {
  const problems = []
  const entry = entryOf(manifest)
  if (entry === null) {
    const patch = manifest.dsh?.bundle?.patch
    if (typeof patch !== 'string') {
      problems.push('no runtime entry and no dsh.bundle.patch — nothing for a profile to load')
    } else if (!existsSync(join(dir, patch.replaceAll('./', '')))) {
      problems.push(`dsh.bundle.patch file "${patch}" is missing from the package`)
    }
    for (const section of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
      for (const [name, spec] of Object.entries(manifest[section] ?? {})) {
        if (!name.startsWith('@veren/')) continue
        if (!spec.startsWith('file:')) {
          problems.push(`${section} ${name} is "${spec}", not a file: rewrite — the installer would hit the registry`)
          continue
        }
        if (!existsSync(spec.slice('file:'.length))) {
          problems.push(`${section} ${name} points at a missing tarball: ${spec}`)
        }
      }
    }
    return problems
  }
  const entryFile = join(dir, entry.replaceAll('./', ''))
  if (!existsSync(entryFile)) {
    problems.push(`entry "${entry}" is missing from the package`)
  } else if (!entryFile.replaceAll('\\', '/').includes('/dist/')) {
    problems.push(`entry "${entry}" resolves outside dist — src cannot load from node_modules`)
  }
  return problems
}

/**
 * 用普通 node 按包名 import，返回导出的键名列表 / import by bare package name with plain node; return export keys.
 *
 * @param {string} specifier - import specifier / 导入说明符
 * @returns {string[]} exported keys / 导出的键名
 */
function loadWithPlainNode(specifier) {
  const script = [
    `const mod = await import(${JSON.stringify(specifier)})`,
    'process.stdout.write(JSON.stringify(Object.keys(mod).sort()))',
  ].join('\n')
  const stdout = execFileSync(
    process.execPath,
    ['--input-type=module', '--eval', script],
    { cwd: fakeRoot, stdio: ['ignore', 'pipe', 'pipe'] },
  ).toString('utf8')
  return JSON.parse(stdout)
}

const failures = []
for (const tarball of tarballs) {
  const path = resolve(tarball)
  if (!existsSync(path)) {
    failures.push(`${tarball}: no such tarball`)
    continue
  }
  try {
    const { manifest, dir } = unfold(path)
    for (const problem of manifestProblems(manifest, dir)) {
      failures.push(`${manifest.name}: ${problem}`)
    }
    for (const name of runtimeNames(manifest)) linkRuntimeDependency(name)
    if (entryOf(manifest) === null) {
      // 配置型组合包：无运行时入口，用 exports["./package.json"] 的解析证明
      // 包可被按名解析（ESM 导入 JSON 需要 import attribute，这里不必真读）。
      // Configuration-only bundle: no runtime entry; resolving
      // exports["./package.json"] proves the package resolves by name (an ESM
      // JSON import would need an import attribute; reading it is unnecessary).
      const require = createRequire(join(dir, 'package.json'))
      const resolved = require.resolve(`${manifest.name}/package.json`).replaceAll('\\', '/')
      if (!resolved.startsWith(modulesDir.replaceAll('\\', '/'))) {
        throw new Error(`./package.json resolved outside the installed copy: ${resolved}`)
      }
      process.stdout.write(`ok       ${manifest.name}@${manifest.version} (config bundle) deps rewritten to sibling tarballs\n`)
      continue
    }
    const keys = loadWithPlainNode(manifest.name)
    if (keys.length === 0) throw new Error('entry module exports nothing')
    const require = createRequire(join(dir, 'package.json'))
    const resolvedEntry = require.resolve(manifest.name).replaceAll('\\', '/')
    if (!resolvedEntry.includes('/dist/')) {
      throw new Error(`require.resolve hit ${resolvedEntry}, not a dist artifact`)
    }
    if (manifest.dsh !== undefined && manifest.dsh.bundle === undefined) {
      const source = require(manifest.name)
      // 两种合法插件形态：Plugin.Object（apply 函数）与
      // Plugin.Constructor（default 导出 Service 子类）。
      // Both legal plugin shapes: Plugin.Object (an apply function) and
      // Plugin.Constructor (a default-exported Service subclass).
      const objectShape = typeof source.apply === 'function' && typeof source.name === 'string'
      const classShape = typeof source.default === 'function'
      if (!objectShape && !classShape) {
        throw new Error('plugin entry is neither Plugin.Object (apply+name) nor Plugin.Constructor (default class)')
      }
    }
    process.stdout.write(`ok       ${manifest.name}@${manifest.version} entry ${resolvedEntry.slice(modulesDir.length + 1)} exports: ${keys.join(', ')}\n`)
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
