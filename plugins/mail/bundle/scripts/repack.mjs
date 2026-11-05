/**
 * Repack the bundle tarball and its member tarballs for local installation.
 *
 * The committed manifests stay registry-clean (`workspace:^`), which is what
 * a published package needs. A test node installs from local tarballs, and
 * that node's own pnpm run has no workspace to resolve `workspace:` against.
 * Two consequences, both handled here:
 *
 * - the bundle's member dependencies point at the sibling member tarballs;
 * - `pnpm pack` has already rewritten each member's own workspace ranges to
 *   concrete versions, which the profile would chase to the registry and
 *   miss — so any member dependency on a sibling member is rewritten to its
 *   tarball, unconditionally, while everything else keeps the registry form
 *   `pnpm pack` left it in.
 *
 * This script exists for local installation only; nothing in the shipped
 * packages depends on it.
 *
 * 为本地安装重打组合包 tarball 与其成员 tarball。
 *
 * 提交进仓库的清单保持 registry 干净（`workspace:^`），这是已发布包所需的写法。测试节点从
 * 本地 tarball 安装，而该节点自己的 pnpm 运行没有可解析 `workspace:` 的工作区。于是有两件事，
 * 都在这里处理：
 *
 * - 组合包的成员依赖指向同级的成员 tarball；
 * - `pnpm pack` 已把每个成员自身的 workspace 区间改写成具体版本，profile 会拿着它去 registry
 *   扑空——因此成员对同级成员的依赖一律改写为对应 tarball，其余条目保持 `pnpm pack` 留下的
 *   registry 形态。
 *
 * 本脚本只服务于本地安装；随包交付的内容不依赖它。
 *
 * 用法 / usage: node scripts/repack.mjs <destination directory>
 *
 * GNU tar on Windows reads a drive letter as a remote host, so pass a
 * RELATIVE destination; the `file:` entries are still written absolute,
 * because pnpm resolves a relative file: spec against the dependent's
 * location (the profile), not the caller's.
 * Windows 上的 GNU tar 把盘符当成远程主机名，因此请传相对目标目录；`file:` 条目仍写成
 * 绝对路径，因为 pnpm 解析相对 file: 规格时以依赖方（profile）为基准，而不是调用方。
 *
 * @module @veren/mail-bundle/repack
 */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')
const destination = process.argv[2]
if (destination === undefined) throw new Error('usage: node scripts/repack.mjs <destination directory>')
const absoluteDestination = resolve(destination)

const manifest = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8'))
const version = manifest.version
const bundleTarball = join(destination, `${manifest.name.replace('@', '').replace('/', '-')}-${version}.tgz`)

/** The member dependency names this bundle rewrites, in declaration order. */
const members = Object.keys(manifest.dependencies ?? {})

/** Member name → its expected tarball file name. / 成员名 → 预期的 tarball 文件名。 */
const MEMBER_TARBALLS = new Map(
  members.map((member) => [member, `${member.replace('@', '').replace('/', '-')}-${version}.tgz`]),
)

/**
 * Resolve one tarball name in the destination: an exact name-version hit
 * wins, the unique-prefix match is the fallback.
 * 在目标目录解析一个 tarball 名：精确「名-版本」命中优先，唯一前缀匹配兜底。
 */
function tarballNameOf(prefix) {
  const tarballs = readdirSync(destination).filter((name) => name.startsWith(prefix) && name.endsWith('.tgz'))
  const exact = tarballs.find((name) => name === `${prefix}${version}.tgz`)
  const found = exact !== undefined ? exact : tarballs.length === 1 ? tarballs[0] : undefined
  if (found === undefined) throw new Error(`cannot resolve a tarball for '${prefix}' in ${destination}`)
  return found
}

/** The tar-safe path of one tarball: the caller's (relative) destination. / 一个 tarball 的 tar 安全路径：调用方的（相对）目标目录。 */
function tarPathOf(name) {
  return join(destination, name)
}

/** The file:-entry path of one tarball: absolute with forward slashes. / 一个 tarball 的 file: 条目路径：绝对路径加正斜杠。 */
function filePathOf(name) {
  return join(absoluteDestination, name).split('\\').join('/')
}

/**
 * Rewrite one dependency map: every member entry becomes an absolute `file:`
 * entry; other entries stay as `pnpm pack` left them.
 *
 * 改写一张依赖表：每条成员条目都变成绝对 `file:` 条目；其他条目保持 `pnpm pack` 留下的样子。
 */
function rewriteDependencies(dependencies) {
  let rewritten = 0
  for (const name of Object.keys(dependencies)) {
    if (!MEMBER_TARBALLS.has(name)) continue
    dependencies[name] = `file:${filePathOf(tarballNameOf(`${name.replace('@', '').replace('/', '-')}-`))}`
    rewritten += 1
  }
  return rewritten
}

/**
 * Rewrite one tarball in place: unpack, rewrite its dependency map, repack.
 *
 * 原地改写一个 tarball：解包、改写依赖表、重打。
 */
function rewriteTarball(tarPath) {
  const work = mkdtempSync(join(tmpdir(), 'mail-bundle-repack-'))
  try {
    execFileSync('tar', ['-xzf', tarPath, '-C', work])
    const packageDir = join(work, 'package')
    const packaged = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'))
    const rewritten = rewriteDependencies(packaged.dependencies ?? {})
    packaged.comment_dependencies = 'Member dependencies rewritten by scripts/repack.mjs for local installation; '
      + 'the committed manifest declares workspace ranges.'
    writeFileSync(join(packageDir, 'package.json'), `${JSON.stringify(packaged, undefined, 2)}\n`)
    rmSync(tarPath, { force: true })
    execFileSync('tar', ['-czf', tarPath, '-C', work, 'package'])
    return rewritten
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

/** Rewrite every member first, so the bundle's file: entries point at the rewritten tarballs. */
let total = 0
for (const member of members) {
  const name = tarballNameOf(`${member.replace('@', '').replace('/', '-')}-`)
  total += rewriteTarball(tarPathOf(name))
  process.stdout.write(`rewrote ${filePathOf(name)}\n`)
}
total += rewriteTarball(bundleTarball)
process.stdout.write(`repacked ${bundleTarball} with ${String(total)} rewritten dependency spec(s)\n`)
