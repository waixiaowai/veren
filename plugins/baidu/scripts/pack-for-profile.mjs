/**
 * Produce the profile-install pack: the pnpm pack tarball with every
 * `workspace:*` dependency rewritten away.
 *
 * Why: `dsh plugin add <tarball>` installs the package outside the pnpm
 * workspace, where `workspace:*` cannot resolve (the documented tarball trap).
 * The only such dependency here is the build-only `@veren/platform-modules`
 * — the shipped artifacts (dist/ + lib/client.js) never require it at
 * runtime, so dropping it from the packed manifest is safe. This is the
 * sanctioned tarball+rewrite exception for profile installs, not a license to
 * add workspace dependencies elsewhere.
 *
 * 产出 profile 安装包：把 pnpm pack 的 tarball 里所有 `workspace:*` 依赖重写掉。
 *
 * 原因：`dsh plugin add <tarball>` 在 pnpm workspace 之外安装，`workspace:*` 无法解析
 * （即文档记载的 tarball 陷阱）。本包唯一的这类依赖是仅构建期使用的 `@veren/platform-modules`
 * ——发布产物（dist/ + lib/client.js）运行时根本不 require 它，从打包清单里删掉是安全的。
 * 这是 profile 安装"tarball + 重写"的既定例外，不是在别处随意添加 workspace 依赖的许可。
 *
 * Usage: node scripts/pack-for-profile.mjs [outDir]
 * 默认输出 deepseek/.dsh/packs/baidu-<version>/veren-baidu-pan-<version>.tgz
 *
 * @module scripts/pack-for-profile
 */

import { execSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

/** execSync with a decoded failure message (tar's stderr as text, not a Buffer dump). */
/** 带可读失败信息的 execSync（tar 的 stderr 以文本呈现，而不是 Buffer 转储）。 */
function run(command, options = {}) {
  try {
    execSync(command, { stdio: 'inherit', ...options })
  } catch (error) {
    const stderr = error.stderr?.toString?.() ?? ''
    throw new Error(`command failed: ${command}\n${stderr}`)
  }
}

/** A path in tar's dialect: forward slashes, no drive-letter escaping. Windows tar reads a backslash as an escape, so `C:\x` never resolves. */
/** tar 方言下的路径：正斜杠、不做盘符转义。Windows 的 tar 把反斜杠当转义符，`C:\x` 永远解析不了。 */
function tarPath(path) {
  return path.replace(/\\/gu, '/')
}

/** Output pack dir; the default lands beside the other stable-node packs. */
/** 输出目录；缺省与其余稳定节点包并列。 */
const outDir = process.argv[2] ?? resolve(root, '../../deepseek/.dsh/packs', `baidu-${pkg.version}`)
const tarballName = `veren-baidu-pan-${pkg.version}.tgz`

/** 1. pnpm pack (prepack builds both halves) into a temp dir. */
const temp = mkdtempSync(join(tmpdir(), 'bdp-pack-'))
run('pnpm pack --pack-destination ' + tarPath(temp), { cwd: root })

/** 2. Rewrite the manifest: drop workspace-range deps everywhere. The pnpm layout keeps a package/ prefix — preserve it. GNU tar on Windows reads `C:` as a remote host: always pass --force-local. */
const stage = outDir
rmSync(outDir, { recursive: true, force: true })
mkdirSync(stage, { recursive: true })
run('tar --force-local -xzf ' + tarPath(join(temp, tarballName)) + ' -C ' + tarPath(stage))
const packedPath = join(stage, 'package', 'package.json')
const packed = JSON.parse(readFileSync(packedPath, 'utf8'))
let dropped = 0
for (const section of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
  const deps = packed[section]
  if (deps === undefined) continue
  for (const [name, range] of Object.entries(deps)) {
    if (range.startsWith('workspace:')) {
      delete deps[name]
      dropped += 1
    }
  }
}
writeFileSync(packedPath, JSON.stringify(packed, null, 2) + '\n')

/** 3. Re-tar keeping the package/ prefix (the npm tarball layout pnpm expects). */
const out = join(outDir, tarballName)
run('tar --force-local -czf ' + tarPath(out) + ' package', { cwd: stage })
rmSync(temp, { recursive: true, force: true })
console.log(`repacked ${tarballName} (dropped ${String(dropped)} workspace deps) -> ${out}`)
