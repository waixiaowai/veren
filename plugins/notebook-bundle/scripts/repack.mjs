/**
 * Repack a configuration-only bundle tarball so its member dependencies point
 * at the sibling member tarballs instead of the npm registry.
 *
 * The committed manifest stays registry-clean (`workspace:^`), which is what a
 * published bundle needs. A test node installs from local tarballs, and that
 * node's own pnpm run has no workspace to resolve `workspace:^` against, so the
 * tarball — a throwaway artifact, not a source file — is rewritten to `file:`
 * entries before the profile consumes it.
 *
 * This script exists for local installation only; nothing in the shipped
 * package depends on it.
 *
 * 重打配置型组合包的 tarball，让它的成员依赖指向同级的成员 tarball 而不是 npm registry。
 *
 * 提交进仓库的清单保持 registry 干净（`workspace:^`），这是已发布组合包所需要的。测试节点
 * 从本地 tarball 安装，而该节点自己的 pnpm 运行没有可供解析 `workspace:^` 的工作区，因此在
 * profile 消费它之前把 tarball——一次性的产物，不是源文件——改写为 `file:` 条目。
 *
 * 本脚本只服务于本地安装；随包交付的内容不依赖它。
 *
 * @module @veren/forum-bundle/repack
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const destination = process.argv[2]
if (destination === undefined) throw new Error('usage: node scripts/repack.mjs <destination directory>')

const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const version = manifest.version
const tarball = join(destination, `${manifest.name.replace('@', '').replace('/', '-')}-${version}.tgz`)

/** The member dependency names this bundle rewrites, in declaration order. */
const members = Object.keys(manifest.dependencies ?? {})

/**
 * Resolve one member's tarball in the destination by its OWN version — members
 * run their own release lines (e.g. @veren/app-host-bundle is not bumped with
 * this family), so the filename never assumed the bundle's version.
 * 按成员自己的版本在目标目录解析 tarball——成员各走各的版本线
 * （如 @veren/app-host-bundle 不随本家族升位），文件名不能假设与 bundle 同版本。
 */
function memberTarballOf(member) {
  const prefix = `${member.replace('@', '').replace('/', '-')}-`
  const hits = readdirSync(destination).filter((name) => name.startsWith(prefix) && name.endsWith('.tgz'))
  if (hits.length !== 1) {
    throw new Error(`expected exactly one ${prefix}*.tgz in ${destination}, found ${String(hits.length)} — pack every member into the destination first`)
  }
  return join(destination, hits[0])
}

const work = mkdtempSync(join(tmpdir(), 'forum-bundle-pack-'))
// GNU tar on Windows: `C:\…` reads as a remote host spec (colon = hostname) and
// backslashes get eaten as escapes — feed it forward-slash paths plus
// --force-local; both are harmless elsewhere.
// Windows 上的 GNU tar：`C:\…` 被读成远程主机（冒号=主机名），反斜杠又被当转义
// 吃掉——喂正斜杠路径加 --force-local；两者在其他平台无害。
const tarFlags = process.platform === 'win32' ? ['--force-local'] : []
const toTarPath = (value) => value.replaceAll('\\', '/')
try {
  // npm tarballs keep every entry under a leading `package/` directory, and pnpm
  // requires that layout when it reads the tarball back.
  mkdirSync(join(work, 'package'), { recursive: true })
  execFileSync('tar', [...tarFlags, '-xzf', toTarPath(tarball), '-C', toTarPath(work)], { stdio: 'inherit' })
  const packaged = JSON.parse(readFileSync(join(work, 'package', 'package.json'), 'utf8'))
  for (const member of members) {
    packaged.dependencies[member] = `file:${memberTarballOf(member).replaceAll('\\', '/')}`
  }
  packaged.comment_dependencies = 'Rewritten by scripts/repack.mjs for local tarball installation; '
    + 'the committed manifest declares workspace ranges.'
  writeFileSync(join(work, 'package', 'package.json'), `${JSON.stringify(packaged, undefined, 2)}\n`)
  rmSync(tarball)
  execFileSync('tar', [...tarFlags, '-czf', toTarPath(tarball), '-C', toTarPath(work), 'package'], { stdio: 'inherit' })
  process.stdout.write(`repacked ${basename(tarball)} with ${String(members.length)} member tarball(s)\n`)
} finally {
  rmSync(work, { recursive: true, force: true })
}

/** Keep the destination directory alive for callers that pass a new one. */
mkdirSync(destination, { recursive: true })
