/**
 * Repack the configuration-only bundle tarball so its member dependency
 * points at the sibling member tarball instead of the npm registry.
 *
 * The committed manifest stays registry-clean (`workspace:^`), which is what
 * a published bundle needs. A test node installs from local tarballs, and
 * that node's own pnpm run has no workspace to resolve `workspace:^`
 * against, so the tarball — a throwaway artifact, not a source file — is
 * rewritten to a `file:` entry before the profile consumes it.
 *
 * This script exists for local installation only; nothing in the shipped
 * package depends on it.
 *
 * 重打配置型组合包的 tarball，让成员依赖指向同级的成员 tarball 而不是
 * npm registry。
 *
 * 提交进仓库的清单保持 registry 干净（`workspace:^`），这是已发布组合包
 * 所需的写法。测试节点从本地 tarball 安装，而该节点自己的 pnpm 运行没有
 * 可供解析 `workspace:^` 的工作区，因此在 profile 消费它之前把 tarball——
 * 一次性产物，不是源码文件——改写为 `file:` 条目。
 *
 * 本脚本只服务于本地安装；随包交付的内容不依赖它。
 *
 * @module @veren/crawler-bundle/repack
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const destination = process.argv[2]
if (destination === undefined) throw new Error('usage: node scripts/repack.mjs <destination directory>')

const manifest = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8'))
const version = manifest.version
const tarball = join(destination, `${manifest.name.replace('@', '').replace('/', '-')}-${version}.tgz`)
// GNU tar on Windows reads a drive letter as a remote host: tar operations
// use the (relative) destination as passed, while the file: entries carry
// the absolute path, because pnpm resolves a relative file: spec against
// the dependent's location (the profile), not the caller's.
// Windows 的 GNU tar 把盘符当成远程主机名：tar 操作用调用方传入的（相对）
// 目标目录，而 file: 条目写绝对路径——pnpm 解析相对 file: 规格时以依赖方
// （profile）为基准，而不是调用方。
const absoluteDestination = resolve(destination)

/** The member dependency names this bundle rewrites, in declaration order. */
const members = Object.keys(manifest.dependencies ?? {})

/**
 * Resolve one member's tarball in the destination: an exact name-version hit
 * wins, the unique-prefix match is the fallback. The returned path stays in
 * the caller's (relative) form — tar-safe; entries build their own absolute
 * form from it.
 * 在目标目录解析成员 tarball：精确「名-版本」命中优先，唯一前缀匹配兜底。
 * 返回路径保持调用方的（相对）形态——tar 安全；file: 条目由它自行拼绝对路径。
 */
function memberTarballOf(member) {
  const prefix = `${member.replace('@', '').replace('/', '-')}-`
  const tarballs = readdirSync(destination).filter((name) => name.startsWith(prefix) && name.endsWith('.tgz'))
  const exact = tarballs.find((name) => name === `${prefix}${version}.tgz`)
  if (exact !== undefined) return exact
  if (tarballs.length === 1) return tarballs[0]
  throw new Error(`cannot resolve member tarball for ${member} in ${destination}`)
}

const work = mkdtempSync(join(tmpdir(), 'crawler-bundle-repack-'))
try {
  // Unpack, rewrite the member entries that have local tarballs to file:,
  // repack in place. Framework bundles (e.g. @veren/app-host-bundle) keep
  // their registry spec — the profile resolves them from @veren registry.
  // 解包、把有本地 tarball 的成员改写为 file:、原地重打。框架组合包
  // （如 @veren/app-host-bundle）保留 registry 规格——profile 从 @veren
  // registry 解析它们。
  execFileSync('tar', ['-xzf', tarball, '-C', work])
  const packageDir = join(work, 'package')
  const packaged = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'))
  let rewritten = 0
  for (const member of members) {
    try {
      const name = memberTarballOf(member)
      packaged.dependencies[member] = `file:${join(absoluteDestination, name).replaceAll('\\', '/')}`
      rewritten += 1
    } catch {
      // 该成员没有本地 tarball；保留 registry 规格 / no local tarball; keep the registry spec
    }
  }
  packaged.comment_dependencies = 'Members with local tarballs rewritten by scripts/repack.mjs for local installation; '
    + 'the committed manifest declares workspace ranges.'
  writeFileSync(join(packageDir, 'package.json'), `${JSON.stringify(packaged, undefined, 2)}\n`)
  rmSync(tarball, { force: true })
  execFileSync('tar', ['-czf', tarball, '-C', work, 'package'], { stdio: 'inherit' })
  process.stdout.write(`repacked ${tarball} with ${String(rewritten)} member tarball(s)\n`)
} finally {
  rmSync(work, { recursive: true, force: true })
}
