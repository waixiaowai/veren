/**
 * Pack the whole Baidu Netdisk stack for one profile install: the server
 * plugin, the web panel, and the configuration-only bundle that inserts both
 * loader rows.
 *
 * Why a script instead of three `pnpm pack` calls: a tarball install resolves
 * `workspace:*` outside the workspace, so the bundle's two member dependencies
 * are rewritten to `file:` references pointing at the sibling tarballs in the
 * same output directory. Everything else in the manifests already comes out
 * version-pinned by `pnpm pack`, so nothing else needs rewriting.
 *
 * 为一次性 profile 安装打包整个百度网盘栈：服务端插件、网页面板、以及插入两行
 * loader 的纯配置组合包。
 *
 * 为什么用脚本而不是三次 `pnpm pack`：tarball 安装在工作区之外解析不了
 * `workspace:*`，所以把组合包的两个成员依赖重写成指向同目录兄弟 tarball 的
 * `file:` 引用。清单里其余字段 `pnpm pack` 出来已是钉死的版本号，无需再动。
 *
 * Usage: node scripts/pack-stack.mjs [outDir]
 * 默认输出 deepseek/.dsh/packs/baidu-<version>/
 *
 * @module scripts/pack-stack
 */

import { execSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** The stack, in dependency order. / 栈内成员，按依赖顺序。 */
const MEMBERS = [
  { dir: root, name: '@veren/baidu-pan' },
  { dir: join(root, 'ui'), name: '@veren/baidu-pan-ui' },
  { dir: join(root, 'bundle'), name: '@veren/baidu-pan-bundle' },
]

const serverPkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const outDir = process.argv[2] ?? resolve(root, '../../deepseek/.dsh/packs', `baidu-${serverPkg.version}`)

/** execSync with a decoded failure message (Windows tar/JSON.stringify backslash traps avoided). */
/** 带可读失败的 execSync（规避 Windows 的 tar/JSON.stringify 反斜杠陷阱）。 */
function run(command, options = {}) {
  try {
    execSync(command, { stdio: 'inherit', ...options })
  } catch (error) {
    throw new Error(`command failed: ${command}\n${error.stderr?.toString?.() ?? ''}`)
  }
}

/** A path in tar's dialect: forward slashes, never JSON-escaped. */
/** tar 方言的路径：正斜杠，绝不做 JSON 转义。 */
const tarPath = path => path.replace(/\\/gu, '/')

/** Pack one member into the staging dir, then extract it in place. */
/** 把一个成员打进暂存目录，然后就地解开。 */
function stageMember(member, staging) {
  const before = new Set(execSync('ls ' + tarPath(staging), { encoding: 'utf8' }).split('\n'))
  run('pnpm pack --pack-destination ' + tarPath(staging), { cwd: member.dir })
  const produced = execSync('ls ' + tarPath(staging), { encoding: 'utf8' }).split('\n').filter(n => n.endsWith('.tgz') && !before.has(n))
  if (produced.length !== 1) throw new Error(`${member.name}: expected one tarball, saw ${produced.join(', ')}`)
  const tarball = produced[0]
  const dest = join(outDir, member.name.split('/')[1])
  mkdirSync(dest, { recursive: true })
  run('tar --force-local -xzf ' + tarPath(join(staging, tarball)) + ' -C ' + tarPath(dest))
  return { tarball, dir: dest }
}

rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })
const staging = mkdtempSync(join(tmpdir(), 'bdp-stack-'))
const staged = MEMBERS.map(member => ({ member, ...stageMember(member, staging) }))

/** Rewrite the bundle's member dependencies to file: references to the sibling tarballs. */
/** 把组合包的成员依赖重写成指向兄弟 tarball 的 file: 引用。 */
const bundlePkgPath = join(staged[2].dir, 'package', 'package.json')
const bundlePkg = JSON.parse(readFileSync(bundlePkgPath, 'utf8'))
for (const [name, range] of Object.entries(bundlePkg.dependencies ?? {})) {
  const sibling = staged.find(entry => entry.member.name === name)
  if (sibling === undefined) continue
  bundlePkg.dependencies[name] = 'file:' + tarPath(join(sibling.dir, sibling.tarball))
  void range
}
writeFileSync(bundlePkgPath, JSON.stringify(bundlePkg, null, 2) + '\n')

/** Re-tar every member in place (package/ prefix preserved). */
/** 就地重打每个成员（保留 package/ 前缀）。 */
for (const entry of staged) {
  run('tar --force-local -czf ' + tarPath(join(entry.dir, entry.tarball)) + ' package', { cwd: entry.dir })
}

rmSync(staging, { recursive: true, force: true })
console.log(`packed ${String(staged.length)} packages into ${outDir}`)
for (const entry of staged) console.log(`  ${entry.tarball}`)
