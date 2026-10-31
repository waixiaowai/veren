/**
 * Pack the repository's first-party plugins into tarballs.
 *
 * Default (registry mode) runs plain `pnpm pack`: pnpm rewrites every
 * `workspace:` range into the package's current version, and
 * `market/release.mjs` publishes that version to https://npm.veren.top/, so a
 * packed manifest installs from the registry alone. The script asserts the
 * packed manifest declares no `file:` and no leftover `workspace:` dependency
 * on a first-party package, so the registry-clean property cannot silently
 * regress.
 *
 * `--offline` keeps the no-network smoke path: it rewrites every first-party
 * dependency of the packed manifest to the sibling tarball in the same output
 * directory. Offline tarballs are for local smoke tests only; never
 * distribute them.
 *
 * 把仓库自研插件打成 tarball。
 *
 * 默认（registry 模式）就是原生 `pnpm pack`：pnpm 把 `workspace:` 区间改写为包
 * 当前版本，而该版本由 `market/release.mjs` 发布到 https://npm.veren.top/，
 * 打包产物因此只靠 registry 即可安装。脚本断言打包后清单对第一方包的依赖既
 * 不是 `file:` 也不是残留的 `workspace:`，防止"registry 干净"这一性质悄悄退化。
 *
 * `--offline` 保留无网冒烟路径：把打包后清单里的第一方依赖改写为同目录的兄弟
 * tarball。offline 产物只供本机冒烟测试，不得分发。
 *
 * Usage / 用法:
 *   node scripts/pack-local-plugins.mjs [--out <dir>] [--offline]
 *
 * @module @veren/scripts/pack-local-plugins
 */

import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  copyFileWithRetry,
  entryPaths,
  extractTarball,
  readPackedManifest,
  tarballName,
  tarBin,
} from './lib/packed-tarball.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Package directory -> package name / 包目录 -> 包名 */
const PACKAGES = [
  ['packages/core', '@veren/core'],
  ['packages/kysely-dsh-dialect', '@veren/kysely-dsh-dialect'],
  ['packages/prompt-core', '@veren/prompt-core'],
  ['packages/prompt-host-messages', '@veren/prompt-host-messages'],
  ['packages/prompt-page', '@veren/prompt-page'],
  ['plugins/app-registry', '@veren/app-registry'],
  ['plugins/app-host', '@veren/app-host'],
  ['plugins/app-host-ui', '@veren/app-host-ui'],
  ['plugins/app-host-bundle', '@veren/app-host-bundle'],
  ['plugins/page-registry', '@veren/page-registry'],
  ['plugins/task-center', '@veren/task-center'],
  ['plugins/task-workbench', '@veren/task-workbench'],
  ['plugins/device-id', '@veren/device-id'],
  ['plugins/device-id-win', '@veren/device-id-win'],
  ['plugins/device-id-mac', '@veren/device-id-mac'],
  ['plugins/device-id-linux', '@veren/device-id-linux'],
  ['plugins/forum', '@veren/forum'],
  ['plugins/forum-app', '@veren/forum-app'],
  ['plugins/forum-ui', '@veren/forum-ui'],
  ['plugins/forum-bundle', '@veren/forum-bundle'],
  ['plugins/notebook', '@veren/notebook'],
  ['plugins/notebook-app', '@veren/notebook-app'],
  ['plugins/notebook-ui', '@veren/notebook-ui'],
  ['plugins/notebook-bundle', '@veren/notebook-bundle'],
  ['plugins/startup-autostart', '@veren/startup-autostart'],
  ['plugins/startup-autostart-skill', '@veren/startup-autostart-skill'],
  ['plugins/startup-autostart-tool', '@veren/startup-autostart-tool'],
  ['plugins/startup-autostart-ui', '@veren/startup-autostart-ui'],
  ['plugins/startup-autostart-recovery', '@veren/startup-autostart-recovery'],
  ['plugins/startup-autostart-bundle', '@veren/startup-autostart-bundle'],
  ['plugins/auth', '@veren/web-login-gate'],
  ['plugins/session-fork-enhanced', '@imeep/dsh-session-fork-enhanced'],
  ['plugins/cms-bridge', '@veren/cms-bridge'],
  ['plugins/sub2api-admin', '@veren/sub2api-admin'],
  ['plugins/sub2api-admin-bundle', '@veren/sub2api-admin-bundle'],
  // Person Agent stack: packed so @veren/person-agent-bundle installs from the
  // same local tarball set as the other bundles. The tool builder packages ride
  // through the app as peer/dev dependencies but still need their own tarballs.
  // 管家栈：打包进同一套本地 tarball，让 @veren/person-agent-bundle 与其他组合包
  // 一致安装。工具构建器包经应用的 peer/dev 依赖随行，但 tarball 仍需各自产出。
  ['plugins/person-agent-app', '@veren/person-agent-app'],
  ['plugins/person-agent-bundle', '@veren/person-agent-bundle'],
  ['plugins/person-agent-tool-session', '@veren/person-agent-tool-session'],
  ['plugins/person-agent-tool-workspace', '@veren/person-agent-tool-workspace'],
]

/** Parse `--out <dir>` / 解析 `--out <目录>` */
function outputDirectory() {
  const index = process.argv.indexOf('--out')
  const configured = index === -1 ? undefined : process.argv[index + 1]
  return resolve(configured ?? join(root, '.tmp-plugin-packs'))
}

/** Whether `--offline` was requested / 是否要求 offline（file: 兄弟改写）模式 */
function offlineRequested() {
  return process.argv.includes('--offline')
}

/**
 * 入口仍指向 src、由进行中的其他会话收尾的包；它们的 tarball 依然带 src 入口，
 * 打包时只警告不放行新包。清单与 scripts/check-entry-points.mjs 保持一致。
 * 当前为空：所有待发布包的 tarball 都带构建产物入口。
 *
 * Packages whose entry still points at src, to be finished by their owning
 * sessions; their tarballs still carry a src entry, so packing warns instead of
 * failing. Keep this list in sync with scripts/check-entry-points.mjs.
 * Currently empty: every packagable tarball now carries a built-artifact entry.
 *
 * @type {Set<string>}
 */
const PENDING_SRC_ENTRY = new Set([])

/**
 * 验证 tarball 里真实带着入口文件：`files` 写漏 dist 时 pnpm pack 会静默产出
 * 一个装上即崩的空壳包，这里在打包当场报错。
 *
 * Verify the tarball really contains its entry files: a wrong `files` glob makes
 * `pnpm pack` silently produce a shell that crashes on activation, so fail right
 * here at pack time.
 *
 * @param {string} tarball - packed tarball / 打包产物
 * @param {string} name - package name / 包名
 */
function assertPackedEntries(tarball, name) {
  const work = mkdtempSync(join(tmpdir(), 'veren-pack-verify-'))
  try {
    // Windows 上 pnpm pack 的子进程退出后写入可能仍在回写，紧随其后的 tar 读取
    // 偶发 "unexpected end of file"。先把 tarball 复制到临时目录（带重试），再从
    // 本地副本解包——避开 tar 与写入方的竞态。
    // On Windows pnpm pack's child process may exit while the write is still
    // flushing; an immediate tar read can hit "unexpected end of file". Copy the
    // tarball into the temp dir first (with retries), then untar the local copy —
    // keeping tar out of the race with the writer.
    const localCopy = join(work, 'pack.tgz')
    copyFileWithRetry(tarball, localCopy)
    extractTarball(localCopy, work)
    const manifest = JSON.parse(readFileSync(join(work, 'package', 'package.json'), 'utf8'))
    const entries = entryPaths(manifest)
    if (entries.length === 0) return
    if (PENDING_SRC_ENTRY.has(manifest.name)) {
      process.stdout.write(`warning: ${manifest.name} still packs a src entry (owned by in-flight work); it will not load from node_modules\n`)
      return
    }
    for (const entry of entries) {
      const file = join(work, 'package', entry.replaceAll('./', ''))
      if (!existsSync(file)) {
        throw new Error(`${name}: packed tarball has no entry file "${entry}" — fix "files" or run the package build`)
      }
    }
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

/**
 * 清掉输出目录里的旧 tarball：新产物一旦换版本号，旧文件若不删就会与新版并存，
 * "两套口径"正是从这种目录里长出来的。
 *
 * Delete stale tarballs from the output directory: once versions change, keeping
 * the old files means two generations of artifacts sitting side by side — the
 * exact mixed-state this script exists to prevent.
 *
 * @param {string} outDir - output directory / 输出目录
 */
function clearPackedTarballs(outDir) {
  const stale = readdirSync(outDir).filter(file => file.endsWith('.tgz'))
  for (const file of stale) unlinkSync(join(outDir, file))
  if (stale.length > 0) process.stdout.write(`cleared ${stale.length} stale tarball(s) from ${outDir}\n`)
}

/**
 * registry 模式断言：打包后清单里第一方依赖必须是 registry 可解析的区间，
 * `file:`/`workspace:`/`link:` 一律报错——这是防止再次退化成 file: 的那道闸。
 *
 * Registry-mode assertion: a packed manifest's first-party dependencies must be
 * registry-resolvable ranges; `file:`/`workspace:`/`link:` all fail — this is
 * the gate that keeps the old file: regression from coming back.
 *
 * @param {string} tarball - packed tarball / 打包产物
 * @param {Set<string>} firstParty - first-party package names / 第一方包名集合
 */
function assertRegistryDependencies(tarball, firstParty) {
  const manifest = readPackedManifest(tarball)
  const problems = []
  for (const section of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const [name, spec] of Object.entries(manifest[section] ?? {})) {
      if (!firstParty.has(name)) continue
      if (/^(file|workspace|link):/.test(spec)) {
        problems.push(`${manifest.name}: ${section} ${name} is "${spec}" — publish members via market/release.mjs, never ship file: links`)
      }
    }
  }
  if (problems.length > 0) throw new Error(`\n${problems.join('\n')}`)
}

/**
 * offline 模式：把打包后清单的第一方依赖改写为兄弟 tarball / rewrite the packed
 * manifest's first-party dependencies to sibling tarballs (offline mode only).
 *
 * @param {string} tarball - packed tarball to rewrite / 待改写的 tarball
 * @param {string} outDir - directory holding every tarball / 存放全部 tarball 的目录
 * @param {Map<string, string>} siblings - package name -> sibling tarball / 包名 -> 兄弟 tarball
 * @returns {boolean} whether anything changed / 是否有改动
 */
function rewriteDependencies(tarball, outDir, siblings) {
  const work = mkdtempSync(join(tmpdir(), 'veren-pack-'))
  try {
    extractTarball(tarball, work)
    const manifestFile = join(work, 'package', 'package.json')
    const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'))
    let changed = false
    for (const section of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
      for (const [name] of Object.entries(manifest[section] ?? {})) {
        if (!siblings.has(name)) continue
        const sibling = siblings.get(name)
        manifest[section][name] = `file:${join(outDir, sibling).replaceAll('\\', '/')}`
        changed = true
      }
    }
    if (changed) {
      manifest.comment_dependencies = 'Rewritten by scripts/pack-local-plugins.mjs --offline for local smoke tests; '
        + 'the committed manifest declares registry ranges.'
      writeFileSync(manifestFile, `${JSON.stringify(manifest, undefined, 2)}\n`)
      rmSync(tarball, { force: true })
      execFileSync(tarBin(), ['-czf', tarball, '-C', work, 'package'], { stdio: 'inherit' })
    }
    return changed
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

/**
 * 打一个包并按模式断言 / pack one package and assert per mode.
 *
 * @param {string} directory - package dir relative to the repo root / 相对仓库根的包目录
 * @param {string} name - expected package name / 期望包名
 * @param {{ outDir: string, offline: boolean, siblings: Map<string, string>, firstParty: Set<string> }} plan - run plan / 执行计划
 */
function packOne(directory, name, { outDir, offline, siblings, firstParty }) {
  const cwd = join(root, directory)
  const manifest = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'))
  if (manifest.name !== name) throw new Error(`${directory}: expected ${name}, found ${manifest.name}`)
  const tarball = join(outDir, tarballName(name, manifest.version))
  rmSync(tarball, { force: true })
  // 单字符串命令 + shell：Windows 上 pnpm 是 .cmd 垫片，必须走 shell；参数拼进
  // 字符串也避开 DEP0190（args 数组 + shell 已被弃用）。
  // Single-string command + shell: pnpm is a .cmd shim on Windows and needs the
  // shell; inlining the argument also avoids DEP0190 (args array + shell is
  // deprecated).
  execFileSync(`pnpm pack --pack-destination "${outDir}"`, { cwd, stdio: 'inherit', shell: true })
  if (!existsSync(tarball)) throw new Error(`${name}: pnpm pack produced no ${tarball}`)
  assertPackedEntries(tarball, name)
  if (offline) rewriteDependencies(tarball, outDir, siblings)
  else assertRegistryDependencies(tarball, firstParty)
  process.stdout.write(`packed ${name}@${manifest.version}${offline ? ' (offline siblings)' : ' (registry deps)'}\n`)
}

const outDir = outputDirectory()
mkdirSync(outDir, { recursive: true })
clearPackedTarballs(outDir)

const offline = offlineRequested()
const firstParty = new Set(PACKAGES.map(([, name]) => name))
process.stdout.write(`packing in ${offline ? 'offline (file: siblings for local smoke tests)' : 'registry (pnpm native)'} mode\n`)

/** Package name -> its tarball file name, read from the source manifests. 包名 -> tarball 文件名。 */
const siblings = new Map()
for (const [directory, name] of PACKAGES) {
  const manifest = JSON.parse(readFileSync(join(root, directory, 'package.json'), 'utf8'))
  siblings.set(name, tarballName(name, manifest.version))
}

for (const [directory, name] of PACKAGES) packOne(directory, name, { outDir, offline, siblings, firstParty })

process.stdout.write(`\n${PACKAGES.length} plugin tarballs in ${outDir}\n`)
