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
 * Resolve one member's tarball in the destination. Family names share a prefix
 * (`veren-notebook-` also matches `-app`/`-ui`), so an exact `name-version`
 * hit wins first and the unique-prefix match is only the fallback for members
 * on their own version lines (e.g. @veren/app-host-bundle).
 * 在目标目录解析成员 tarball。家族名共享前缀（`veren-notebook-` 同时命中
 * `-app`/`-ui`），因此先取 `名字-版本` 精确命中；唯一前缀匹配只留给走自己版本
 * 线的成员（如 @veren/app-host-bundle）。
 */
function memberTarballOf(member) {
  const prefix = `${member.replace('@', '').replace('/', '-')}-`
  const tarballs = readdirSync(destination).filter((name) => name.startsWith(prefix) && name.endsWith('.tgz'))
  const exact = tarballs.find((name) => name === `${prefix}${version}.tgz`)
  const hits = exact === undefined ? tarballs : [exact]
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

/**
 * Rewrite one tarball's family deps to `file:` sibling entries and repack it.
 * `pnpm pack` turns members' `workspace:^` into semver ranges, and an
 * unreleased rc resolves nowhere — every tarball that names a sibling present
 * in the destination must point at that sibling's tarball before the profile
 * consumes it.
 * 把一个 tarball 的家族内依赖改写为 `file:` 同级条目并重新打包。`pnpm pack` 会把
 * 成员的 `workspace:^` 变成 semver 区间，而未发布的 rc 无处解析——凡在目标目录里
 * 点名同级成员的 tarball，被 profile 消费前都必须指向该成员的 tarball。
 */
function rewriteTarball(path, depNames) {
  const work = mkdtempSync(join(tmpdir(), 'notebook-bundle-repack-'))
  try {
    // npm tarballs keep every entry under a leading `package/` directory, and
    // pnpm requires that layout when it reads the tarball back.
    mkdirSync(join(work, 'package'), { recursive: true })
    execFileSync('tar', [...tarFlags, '-xzf', toTarPath(path), '-C', toTarPath(work)], { stdio: 'inherit' })
    const manifestPath = join(work, 'package', 'package.json')
    const packaged = JSON.parse(readFileSync(manifestPath, 'utf8'))
    let rewritten = 0
    for (const name of depNames) {
      if (packaged.dependencies?.[name] === undefined) continue
      packaged.dependencies[name] = `file:${memberTarballOf(name).replaceAll('\\', '/')}`
      rewritten += 1
    }
    if (rewritten === 0) return 0
    packaged.comment_dependencies = 'Rewritten by scripts/repack.mjs for local tarball installation; '
      + 'the committed manifest declares workspace ranges.'
    writeFileSync(manifestPath, `${JSON.stringify(packaged, undefined, 2)}\n`)
    rmSync(path)
    execFileSync('tar', [...tarFlags, '-czf', toTarPath(path), '-C', toTarPath(work), 'package'], { stdio: 'inherit' })
    return rewritten
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

try {
  // The bundle first (its deps are exactly the members), then every member —
  // a member may itself name a sibling (notebook-app → notebook).
  // 先组合包（其依赖恰为成员），再逐成员——成员自己也可能点名兄弟包
  // （notebook-app → notebook）。
  rewriteTarball(tarball, members)
  process.stdout.write(`repacked ${basename(tarball)} with ${String(members.length)} member tarball(s)\n`)
  for (const member of members) {
    const path = memberTarballOf(member)
    const rewritten = rewriteTarball(path, members.filter(name => name !== member))
    if (rewritten > 0) process.stdout.write(`repacked ${basename(path)} — ${String(rewritten)} sibling dep(s)\n`)
  }
} finally {
  rmSync(work, { recursive: true, force: true })
}

/** Keep the destination directory alive for callers that pass a new one. */
mkdirSync(destination, { recursive: true })
