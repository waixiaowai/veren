/**
 * 安装形态加载验证：把打包产物按"装进 profile 后"的样子放进系统临时目录的假
 * `node_modules`，再用**普通 node**（无 tsx、无路径别名）按包名 import 入口。
 *
 * 这是 `scripts/check-entry-points.mjs`（静态门禁）的动态另一半：
 * - 静态门禁拦 `main` 指向 `.ts`、`files` 漏掉 dist；
 * - 本脚本证明 tarball 在真实加载语义下可用：`files` 白名单、exports 解析、
 *   dist 内部的相对导入、以及**运行时依赖是否全部声明在 dependencies/
 *   peerDependencies**（devDependencies 在安装形态里不存在，故意不链接——
 *   dist 里混进一个 dev-only 的运行时导入会在这里当场爆掉）。
 *
 * 依赖供给模拟宿主：peer 由"宿主"（假根）供给，@veren/* 兄弟包直接链回工作区
 * 源目录（其入口同样是 dist 产物）。本脚本只读工作区、只写系统临时目录，
 * 不触碰任何 DSH profile。
 *
 * Install-form load check: place each packed tarball into a fake `node_modules`
 * under the system temp directory exactly as a profile install would, then
 * `import()` the entry **with plain node** (no tsx, no path aliases) by bare
 * package name.
 *
 * This is the dynamic half of `scripts/check-entry-points.mjs` (the static
 * gate): the gate rejects a `.ts` main or a `files` list missing dist; this
 * script proves the tarball works under real loading semantics — the `files`
 * whitelist, exports resolution, relative imports inside dist, and that every
 * runtime import is declared under dependencies/peerDependencies
 * (devDependencies do not exist in the installed form and are deliberately not
 * linked, so a dev-only runtime import inside dist explodes right here).
 *
 * The fake root plays the host: it supplies peers, and `@veren/*` siblings are
 * junction-linked back to their workspace directories (whose entries are dist
 * artifacts too). The script only reads the workspace and only writes the
 * system temp directory; no DSH profile is touched.
 *
 * Usage / 用法:
 *   node scripts/verify-packed-entries.mjs [packageDir ...]
 *   （缺省验证四个刚补齐的包 / defaults to the four newly finished packages）
 *
 * @module @veren/scripts/verify-packed-entries
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

/** 缺省验证对象：本次补齐 dist 入口的四个包 / the packages this run finished. */
const DEFAULT_TARGETS = [
  'plugins/page-registry',
  'plugins/task-center',
  'plugins/task-workbench',
  'plugins/person-agent-app',
]

const targets = process.argv.slice(2).length > 0 ? process.argv.slice(2) : DEFAULT_TARGETS

const fakeRoot = mkdtempSync(join(tmpdir(), 'veren-install-check-'))
const modulesDir = join(fakeRoot, 'node_modules')
mkdirSync(modulesDir)

/** 链接过的包名集合，避免重复 / names already linked into the fake root. */
const linked = new Set()

/** pnpm 的 tarball 文件名 / pnpm's tarball file name. */
function tarballName(name, version) {
  return `${name.replace('@', '').replace('/', '-')}-${version}.tgz`
}

/**
 * 从某个目录出发解析包名对应的真实包根（穿过 pnpm 的符号链接）。
 * Resolve a package name to its real package root, starting from `fromDir`
 * (resolution follows pnpm's symlinks, so the result is the physical package).
 *
 * @param {string} name - package name to resolve / 待解析包名
 * @param {string} fromDir - directory whose node_modules answers first / 起始解析目录
 * @returns {string} absolute package root / 包根绝对路径
 */
function resolvePackageRoot(name, fromDir) {
  const require = createRequire(join(fromDir, 'package.json'))
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
 * 把一个运行时依赖链进假根：@veren/* 指向工作区兄弟目录，其余指向解析到的实体包。
 * Link one runtime dependency into the fake root: @veren/* back to its
 * workspace directory, anything else to the resolved physical package.
 *
 * @param {string} name - dependency name / 依赖名
 * @param {string} fromDir - directory used to resolve it / 解析起始目录
 */
function linkRuntimeDependency(name, fromDir) {
  if (linked.has(name)) return
  const linkPath = join(modulesDir, name)
  // 目标包自身已按安装形态展开在位时直接复用——它比工作区目录更接近真实安装。
  // When the target itself is already unfolded at this path, reuse it: it is
  // even closer to a real install than the workspace directory.
  if (existsSync(linkPath)) {
    linked.add(name)
    return
  }
  const target = name.startsWith('@veren/')
    ? resolve(root, resolveWorkspaceSibling(name, fromDir))
    : resolvePackageRoot(name, fromDir)
  mkdirSync(dirname(linkPath), { recursive: true })
  symlinkSync(target, linkPath, 'junction')
  linked.add(name)
}

/**
 * 找 @veren/* 兄弟包的工作区目录：优先从当前包的 node_modules 解析（workspace
 * 链接直接给出答案），失败再从仓库根解析。
 * Locate a @veren/* sibling's workspace directory: resolve through the current
 * package's node_modules first (the workspace link answers directly), then
 * fall back to the repository root.
 *
 * @param {string} name - sibling package name / 兄弟包名
 * @param {string} fromDir - directory used to resolve it / 解析起始目录
 * @returns {string} path relative to the repo root / 相对仓库根的路径
 */
function resolveWorkspaceSibling(name, fromDir) {
  for (const base of [fromDir, root]) {
    try {
      const require = createRequire(join(base, 'package.json'))
      const manifestFile = require.resolve(`${name}/package.json`)
      return relativeToRoot(dirname(manifestFile))
    } catch {
      // 换下一个起点再试 / try the next resolution base
    }
  }
  throw new Error(`${name}: sibling not resolvable from ${fromDir} or repo root`)
}

/** Make a path relative to the repo root with forward slashes. 相对仓库根的正斜杠路径。 */
function relativeToRoot(dir) {
  return dir.slice(root.length + 1).replaceAll('\\', '/')
}

/**
 * 打包并按安装形态展开：`pnpm pack`（触发 prepack 构建），tarball 解到假
 * node_modules 的包名目录下。
 * Pack and unfold in install form: `pnpm pack` (runs the prepack build), then
 * extract the tarball into the fake node_modules under the package name.
 *
 * @param {string} directory - package dir relative to the repo root / 相对仓库根的包目录
 * @returns {object} the packed manifest / 打包后的清单
 */
function installPackedPackage(directory) {
  const cwd = join(root, directory)
  const manifest = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'))
  // 单字符串命令 + shell：Windows 上 pnpm 是 .cmd 垫片，必须走 shell；
  // 参数拼进字符串也避开 DEP0190（args 数组 + shell 已被弃用）。
  // Single-string command + shell: pnpm is a .cmd shim on Windows and needs the
  // shell; inlining the argument also avoids DEP0190 (args array + shell is
  // deprecated).
  execFileSync(`pnpm pack --pack-destination "${fakeRoot}"`, { cwd, stdio: 'pipe', shell: true })
  const tarball = join(fakeRoot, tarballName(manifest.name, manifest.version))
  // 直接带 --strip-components 展开到位，避免先解到临时目录再改名（Windows 上
  // 刚解压的目录句柄常被杀软短暂占用，rename 会随机 EPERM）。
  // Extract in place with --strip-components instead of extract-then-rename:
  // freshly extracted directories are briefly locked by antivirus on Windows
  // and the rename randomly fails with EPERM.
  const installed = join(modulesDir, manifest.name)
  mkdirSync(installed, { recursive: true })
  try {
    execFileSync('tar', ['--strip-components=1', '-xzf', tarball, '-C', installed], { stdio: 'pipe' })
    linked.add(manifest.name)
    return JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8'))
  } finally {
    rmSync(tarball, { force: true })
  }
}

/**
 * 用普通 node 按包名 import 入口，返回导出的键名列表。
 * Import the entry by bare package name with plain node; return export keys.
 *
 * @param {string} name - package name to import / 待导入包名
 * @returns {string[]} exported keys / 导出的键名
 */
function loadWithPlainNode(name) {
  const script = [
    `const mod = await import(${JSON.stringify(name)})`,
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
for (const directory of targets) {
  const label = directory.replaceAll('\\', '/')
  try {
    const manifest = installPackedPackage(directory)
    const runtimeSections = ['dependencies', 'peerDependencies', 'optionalDependencies']
    for (const section of runtimeSections) {
      for (const name of Object.keys(manifest[section] ?? {})) {
        linkRuntimeDependency(name, join(root, directory))
      }
    }
    const keys = loadWithPlainNode(manifest.name)
    if (keys.length === 0) throw new Error('entry module exports nothing')
    if (manifest.dsh !== undefined && typeof manifest.dsh === 'object') {
      const require = createRequire(join(modulesDir, manifest.name, 'package.json'))
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
    process.stdout.write(`ok       ${manifest.name}@${manifest.version} (${label}) exports: ${keys.join(', ')}\n`)
  } catch (error) {
    failures.push(`${label}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

rmSync(fakeRoot, { recursive: true, force: true })

if (failures.length > 0) {
  process.stderr.write(`\n${failures.length} package(s) failed the install-form load check:\n`)
  for (const failure of failures) process.stderr.write(`  - ${failure}\n`)
  process.exit(1)
}
process.stdout.write(`\n${targets.length} package(s) load from their packed install form under plain node.\n`)
