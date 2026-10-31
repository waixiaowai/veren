/**
 * Packed-tarball primitives shared by the packaging/verification scripts.
 *
 * Every helper here encodes a Windows-hardened invariant that used to live
 * duplicated across pack-local-plugins.mjs / verify-dist-tgz.mjs /
 * verify-packed-entries.mjs:
 * - pin the system bsdtar: GNU tar resolved from a Git Bash PATH treats
 *   `C:\...` as a remote host ("Cannot connect to C: resolve failed");
 * - `-C` must come before the member patterns;
 * - a tarball written moments ago must go through a retry-copy before an
 *   immediate read (pnpm pack's child may exit while the write is still
 *   flushing).
 *
 * 打包/校验脚本共享的 tarball 原语。
 *
 * 这里沉淀的每一条都是曾在三份脚本里重复的 Windows 加固不变量：
 * - 固定用系统自带 bsdtar：Git Bash PATH 解析出的 GNU tar 会把 `C:\...` 当
 *   远程主机（"Cannot connect to C: resolve failed"）；
 * - `-C` 必须写在成员模式之前；
 * - 刚写出的 tarball 要先经带重试的复制再读（pnpm pack 的子进程退出时写入
 *   可能仍在回写）。
 *
 * @module @veren/scripts/lib/packed-tarball
 */

import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

/**
 * Windows 上 PATH 里的 GNU tar（Git Bash）会把 `C:\...` 绝对路径当远程主机
 * （"Cannot connect to C:"）——固定用系统自带的 bsdtar（能处理盘符路径）。
 * On Windows the PATH-resolved GNU tar (Git Bash) treats `C:\...` as a remote
 * host ("Cannot connect to C:") — pin the bundled bsdtar, which handles drive
 * paths fine.
 *
 * @returns {string} bsdtar command or absolute path / bsdtar 命令或绝对路径
 */
export function tarBin() {
  return process.platform === 'win32'
    ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
    : 'tar'
}

/**
 * pnpm 的 tarball 文件名 / pnpm's tarball file name.
 *
 * @param {string} name - package name / 包名
 * @param {string} version - package version / 包版本
 * @returns {string} tarball file name / tarball 文件名
 */
export function tarballName(name, version) {
  return `${name.replace('@', '').replace('/', '-')}-${version}.tgz`
}

/**
 * 同步休眠：供"写完立刻读"的重试循环使用（脚本顶层无法 await）。
 * Synchronous sleep: powers retry loops that must block the caller (top-level
 * scripts cannot await).
 *
 * @param {number} ms - milliseconds to wait / 等待毫秒数
 */
export function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/**
 * 带重试的文件复制：Windows 上刚产出的文件可能短暂读不全，重试兜底。
 * File copy with retries: a freshly written file on Windows can be unreadable
 * for a moment; retry instead of failing.
 *
 * @param {string} source - file to copy / 源文件
 * @param {string} destination - copy target / 目标文件
 * @param {number} [attempts=5] - remaining attempts / 剩余尝试次数
 */
export function copyFileWithRetry(source, destination, attempts = 5) {
  try {
    copyFileSync(source, destination)
  } catch (error) {
    if (attempts <= 1) throw error
    sleepSync(500)
    copyFileWithRetry(source, destination, attempts - 1)
  }
}

/**
 * 解包 tarball 到目标目录（bsdtar 固定；bsdtar 的 `-C` 必须在成员模式之前）。
 * Extract a tarball into a directory (pinned bsdtar; bsdtar requires `-C`
 * before the member patterns).
 *
 * @param {string} tarball - packed tarball / 打包产物
 * @param {string} destination - extraction target directory / 解包目标目录
 * @param {{strip?: number}} [options] - `strip`: leading path components to drop / 剥掉的前导路径层数
 */
export function extractTarball(tarball, destination, { strip } = {}) {
  const args = ['-xzf', tarball, '-C', destination]
  if (strip !== undefined) args.push(`--strip-components=${strip}`)
  execFileSync(tarBin(), args, { stdio: 'pipe' })
}

/**
 * 只解出 tarball 里的 package/package.json 并解析 / extract only
 * package/package.json and parse it.
 *
 * @param {string} tarball - packed tarball / 打包产物
 * @returns {object} the packed manifest / 打包后的清单
 */
export function readPackedManifest(tarball) {
  const work = mkdtempSync(join(tmpdir(), 'veren-packed-manifest-'))
  try {
    execFileSync(tarBin(), ['-xzf', tarball, '-C', work, 'package/package.json'], { stdio: 'pipe' })
    return JSON.parse(readFileSync(join(work, 'package', 'package.json'), 'utf8'))
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

/**
 * 清单声明的全部运行时入口：main 与 exports["."]（字符串或 default 形态）。
 * Every runtime entry a manifest declares: main and exports["."] (string or
 * default form).
 *
 * @param {object} manifest - package manifest / 包清单
 * @returns {string[]} entry paths relative to the package root / 相对包根的入口路径
 */
export function entryPaths(manifest) {
  const entries = []
  if (typeof manifest.main === 'string') entries.push(manifest.main)
  const dot = manifest.exports?.['.']
  if (typeof dot === 'string') entries.push(dot)
  else if (typeof dot?.default === 'string') entries.push(dot.default)
  return entries
}

/**
 * 主入口（entryPaths 的第一个）；没有则返回 null（配置型组合包）。
 * The primary entry (first of entryPaths); null for configuration-only bundles.
 *
 * @param {object} manifest - package manifest / 包清单
 * @returns {string | null} entry path relative to the package root / 相对包根的入口路径
 */
export function entryOf(manifest) {
  return entryPaths(manifest)[0] ?? null
}

/**
 * 从某目录出发解析包名对应的真实包根：解析穿过 pnpm 链接后，沿目录树上溯到
 * 持有 package.json 的实体包根。
 * Resolve a package name to its physical package root from a base directory:
 * resolution follows pnpm's links, then walk up the tree to the owning
 * package.json.
 *
 * @param {string} name - dependency name / 依赖名
 * @param {string} fromDir - directory whose package.json anchors resolution / 解析锚点目录
 * @returns {string} absolute package root / 包根绝对路径
 */
export function resolvePackageRoot(name, fromDir) {
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
 * 用普通 node（无 tsx、无路径别名）按导入说明符加载入口，返回排序后的导出
 * 键名列表。
 * Import a specifier with plain node (no tsx, no path aliases); return the
 * sorted list of exported keys.
 *
 * @param {string} specifier - import specifier / 导入说明符
 * @param {string} cwd - resolution base directory / 解析基准目录
 * @returns {string[]} exported keys / 导出的键名
 */
export function loadWithPlainNode(specifier, cwd) {
  const script = [
    `const mod = await import(${JSON.stringify(specifier)})`,
    'process.stdout.write(JSON.stringify(Object.keys(mod).sort()))',
  ].join('\n')
  const stdout = execFileSync(
    process.execPath,
    ['--input-type=module', '--eval', script],
    { cwd, stdio: ['ignore', 'pipe', 'pipe'] },
  ).toString('utf8')
  return JSON.parse(stdout)
}

/**
 * 断言入口是合法插件形态：Plugin.Object（apply 函数 + name 字符串）或
 * Plugin.Constructor（default 导出的 Service 子类）。
 * Assert the entry is a legal plugin shape: Plugin.Object (an apply function
 * with a string name) or Plugin.Constructor (a default-exported Service
 * subclass).
 *
 * @param {object} source - the imported entry module / 导入的入口模块
 */
export function assertPluginShape(source) {
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
