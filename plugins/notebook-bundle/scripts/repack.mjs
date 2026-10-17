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
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

const work = mkdtempSync(join(tmpdir(), 'forum-bundle-pack-'))
try {
  // npm tarballs keep every entry under a leading `package/` directory, and pnpm
  // requires that layout when it reads the tarball back.
  mkdirSync(join(work, 'package'), { recursive: true })
  execFileSync('tar', ['-xzf', tarball, '-C', work], { stdio: 'inherit' })
  const packaged = JSON.parse(readFileSync(join(work, 'package', 'package.json'), 'utf8'))
  for (const member of members) {
    const memberTarball = join(destination, `${member.replace('@', '').replace('/', '-')}-${version}.tgz`)
    packaged.dependencies[member] = `file:${memberTarball.replaceAll('\\', '/')}`
  }
  packaged.comment_dependencies = 'Rewritten by scripts/repack.mjs for local tarball installation; '
    + 'the committed manifest declares workspace ranges.'
  writeFileSync(join(work, 'package', 'package.json'), `${JSON.stringify(packaged, undefined, 2)}\n`)
  rmSync(tarball)
  execFileSync('tar', ['-czf', tarball, '-C', work, 'package'], { stdio: 'inherit' })
  process.stdout.write(`repacked ${basename(tarball)} with ${String(members.length)} member tarball(s)\n`)
} finally {
  rmSync(work, { recursive: true, force: true })
}

/** Keep the destination directory alive for callers that pass a new one. */
mkdirSync(destination, { recursive: true })
