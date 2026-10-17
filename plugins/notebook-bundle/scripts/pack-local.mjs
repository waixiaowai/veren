/**
 * Build the throwaway bundle tarball for a local test node.
 *
 * The committed manifest declares `workspace:^` members, which is what a
 * published bundle needs and what `pnpm pack` cannot resolve outside an
 * installed workspace. A test node installs from tarballs, so this script packs
 * the configuration files itself and rewrites the two dependency entries to the
 * sibling member tarballs. The committed manifest is never modified.
 *
 * 为本地测试节点生成一次性组合包 tarball。
 *
 * 提交进仓库的清单声明 `workspace:^` 成员，这是已发布组合包所需的写法，也是 `pnpm pack`
 * 在未安装的工作区之外无法解析的写法。测试节点从 tarball 安装，因此本脚本自行打包配置文件，
 * 并把两条依赖改写成同级的成员 tarball。提交的清单不会被修改。
 *
 * @module @veren/notebook-bundle/pack-local
 */

import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const destination = resolve(process.argv[2] ?? join(root, 'tarballs'))
mkdirSync(destination, { recursive: true })

const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const version = manifest.version
const tarball = join(destination, `${manifest.name.replace('@', '').replace('/', '-')}-${version}.tgz`)
const members = Object.keys(manifest.dependencies ?? {})

const work = mkdtempSync(join(tmpdir(), 'notebook-bundle-pack-'))
try {
  const packageDir = join(work, 'package')
  mkdirSync(packageDir)
  for (const file of ['cordis.patch.yml', 'icon.svg', 'README.md', 'README.cn.md']) {
    if (existsSync(join(root, file))) copyFileSync(join(root, file), join(packageDir, file))
  }
  const packaged = { ...manifest, dependencies: {} }
  for (const member of members) {
    const memberTarball = join(destination, `${member.replace('@', '').replace('/', '-')}-${version}.tgz`)
    packaged.dependencies[member] = `file:${memberTarball.replaceAll('\\', '/')}`
  }
  packaged.comment_dependencies = 'Rewritten by scripts/pack-local.mjs for local tarball installation; '
    + 'the committed manifest declares workspace ranges.'
  writeFileSync(join(packageDir, 'package.json'), `${JSON.stringify(packaged, undefined, 2)}\n`)
  rmSync(tarball, { force: true })
  execFileSync('tar', ['-czf', tarball, '-C', work, 'package'], { stdio: 'inherit' })
  process.stdout.write(`packed ${tarball} with ${String(members.length)} member tarball(s)\n`)
} finally {
  rmSync(work, { recursive: true, force: true })
}
