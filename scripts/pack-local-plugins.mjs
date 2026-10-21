/**
 * Pack the repository's first-party plugins into local tarballs for an isolated
 * DSH test profile.
 *
 * `pnpm pack` rewrites every `workspace:` range to the package's current
 * version, and those versions are not published on any registry. A test
 * profile installs from tarballs only, so this script rewrites every `@veren/*`
 * dependency of a packed manifest to the sibling tarball in the same output
 * directory. The committed manifests stay registry-clean.
 *
 * 把仓库自研插件打成供隔离 DSH 测试 profile 使用的本地 tarball。
 *
 * `pnpm pack` 会把所有 `workspace:` 区间改写成包当前版本，而这些版本并未发布到
 * 任何 registry。测试 profile 只从 tarball 安装，因此本脚本把打包后清单里的
 * 每个 `@veren/*` 依赖改写为同目录下的兄弟 tarball。提交的清单保持 registry 干净。
 *
 * Usage / 用法:
 *   node scripts/pack-local-plugins.mjs [--out <dir>]
 *
 * @module @veren/scripts/pack-local-plugins
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

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
  // same local tarball set as the other bundles.
  // 管家栈：打包进同一套本地 tarball，让 @veren/person-agent-bundle 与其他组合包一致安装。
  ['plugins/person-agent-app', '@veren/person-agent-app'],
  ['plugins/person-agent-bundle', '@veren/person-agent-bundle'],
  ['plugins/person-agent-dynamic-context', '@veren/person-agent-dynamic-context'],
  ['plugins/person-agent-preset', '@veren/person-agent-preset'],
  ['plugins/person-agent-reanchor', '@veren/person-agent-reanchor'],
  ['plugins/person-agent-tool-session', '@veren/person-agent-tool-session'],
  ['plugins/person-agent-tool-workspace', '@veren/person-agent-tool-workspace'],
]

/** Parse `--out <dir>` / 解析 `--out <目录>` */
function outputDirectory() {
  const index = process.argv.indexOf('--out')
  const configured = index === -1 ? undefined : process.argv[index + 1]
  return resolve(configured ?? join(root, '.tmp-plugin-packs'))
}

/**
 * 入口仍指向 src、由进行中的其他会话收尾的包；它们的 tarball 依然带 src 入口，
 * 打包时只警告不放行新包。清单与 scripts/check-entry-points.mjs 保持一致。
 *
 * Packages whose entry still points at src, to be finished by their owning
 * sessions; their tarballs still carry a src entry, so packing warns instead of
 * failing. Keep this list in sync with scripts/check-entry-points.mjs.
 *
 * @type {Set<string>}
 */
const PENDING_SRC_ENTRY = new Set([
  '@veren/page-registry',
  '@veren/task-center',
  '@veren/task-workbench',
  '@veren/person-agent-app',
])

/**
 * 收集打包后清单声明的运行时入口 / collect the runtime entries of a packed manifest.
 *
 * @param {object} manifest - the packed manifest / 打包后的清单
 * @returns {string[]} entry paths relative to the package root / 相对包根的入口路径
 */
function packedEntries(manifest) {
  const entries = []
  if (typeof manifest.main === 'string') entries.push(manifest.main)
  const dot = manifest.exports?.['.']
  if (typeof dot === 'string') entries.push(dot)
  else if (typeof dot?.default === 'string') entries.push(dot.default)
  return entries
}

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
    execFileSync('tar', ['-xzf', tarball, '-C', work], { stdio: 'inherit' })
    const manifest = JSON.parse(readFileSync(join(work, 'package', 'package.json'), 'utf8'))
    const entries = packedEntries(manifest)
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

/** Turn a package name and version into pnpm's tarball file name / 生成 pnpm 的 tarball 文件名 */
function tarballName(name, version) {
  return `${name.replace('@', '').replace('/', '-')}-${version}.tgz`
}

/**
 * Rewrite one packed manifest's `@veren/*` dependencies to sibling tarballs.
 * 把单个打包后清单的 `@veren/*` 依赖改写为兄弟 tarball。
 *
 * @param {string} tarball - packed tarball to rewrite / 待改写的 tarball
 * @param {string} outDir - directory holding every tarball / 存放全部 tarball 的目录
 * @param {Map<string, string>} siblings - package name -> sibling tarball / 包名 -> 兄弟 tarball
 * @returns {boolean} whether anything changed / 是否有改动
 */
function rewriteDependencies(tarball, outDir, siblings) {
  const work = mkdtempSync(join(tmpdir(), 'veren-pack-'))
  try {
    execFileSync('tar', ['-xzf', tarball, '-C', work], { stdio: 'inherit' })
    const manifestFile = join(work, 'package', 'package.json')
    const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'))
    let changed = false
    for (const section of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
      for (const [name] of Object.entries(manifest[section] ?? {})) {
        if (!name.startsWith('@veren/')) continue
        const sibling = siblings.get(name)
        if (sibling === undefined) {
          throw new Error(`${manifest.name}: ${name} is not part of this pack set`)
        }
        manifest[section][name] = `file:${join(outDir, sibling).replaceAll('\\', '/')}`
        changed = true
      }
    }
    if (changed) {
      manifest.comment_dependencies = 'Rewritten by scripts/pack-local-plugins.mjs for local tarball installation; '
        + 'the committed manifest declares workspace ranges.'
      writeFileSync(manifestFile, `${JSON.stringify(manifest, undefined, 2)}\n`)
      rmSync(tarball, { force: true })
      execFileSync('tar', ['-czf', tarball, '-C', work, 'package'], { stdio: 'inherit' })
    }
    return changed
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

const outDir = outputDirectory()
mkdirSync(outDir, { recursive: true })

/** Package name -> its tarball file name, read from the source manifests. */
const siblings = new Map()
for (const [directory, name] of PACKAGES) {
  const manifest = JSON.parse(readFileSync(join(root, directory, 'package.json'), 'utf8'))
  siblings.set(name, tarballName(name, manifest.version))
}

for (const [directory, name] of PACKAGES) {
  const cwd = join(root, directory)
  const manifest = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'))
  if (manifest.name !== name) throw new Error(`${directory}: expected ${name}, found ${manifest.name}`)
  const tarball = join(outDir, tarballName(name, manifest.version))
  rmSync(tarball, { force: true })
  execFileSync('pnpm', ['pack', '--pack-destination', outDir], { cwd, stdio: 'inherit', shell: true })
  if (!existsSync(tarball)) throw new Error(`${name}: pnpm pack produced no ${tarball}`)
  assertPackedEntries(tarball, name)
  const changed = rewriteDependencies(tarball, outDir, siblings)
  process.stdout.write(`packed ${name}@${manifest.version}${changed ? ' (local deps rewritten)' : ''}\n`)
}

process.stdout.write(`\n${PACKAGES.length} plugin tarballs in ${outDir}\n`)
