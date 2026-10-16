#!/usr/bin/env node
/**
 * 把本 bundle 以「手动 link」方式装进一个 DSH profile —— 不经过 pnpm。
 * Install this bundle into a DSH profile by hand-linking it, without pnpm.
 *
 * 它做三件事（与 `pnpm add link:<本目录>` + 记录 bundle 层等价）：
 *   1. 备份 profile 的 package.json；
 *   2. 写入 dependencies["dsh-session-dispatch"] = "link:<本目录>"，
 *      并把 "dsh-session-dispatch" 追加进 dsh.profile.bundles（幂等）；
 *   3. 在 <profile>/node_modules 下建一个目录联接（junction）指向本目录。
 *
 * 为什么需要它：本机 profile 由 pnpm 10.28.2 建立，而当前执行的 pnpm 是 11.x，
 * store 布局不同，任何 pnpm 安装都会先报 ERR_PNPM_UNEXPECTED_STORE。本脚本不调用 pnpm。
 *
 * 安全：拒绝写入 `~/.dsh`（桌面端 profile）；只允许测试节点或显式给出的其它 profile。
 * Safety: refuses to write into `~/.dsh` (the Desktop profile).
 *
 * 用法 / Usage:
 *   node install-into-profile.mjs "C:\Users\imeep\.dsh_test_2\profiles\web"
 *   node install-into-profile.mjs --revert "C:\Users\imeep\.dsh_test_2\profiles\web"
 */
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PLUGIN_DIR = dirname(fileURLToPath(import.meta.url))
const BUNDLE_NAME = 'dsh-session-dispatch'

const argv = process.argv.slice(2)
const revert = argv.includes('--revert')
const requested = argv.find(arg => !arg.startsWith('--')) ?? process.env.DSH_PROFILE_DIR ?? ''
if (requested === '') {
  console.error('用法 / usage: node install-into-profile.mjs [--revert] <profile 目录>')
  console.error('  例如 / e.g.: node install-into-profile.mjs "C:\\Users\\imeep\\.dsh_test_2\\profiles\\web"')
  process.exit(1)
}
const profileDir = resolve(requested)

// 桌面端 profile 绝不触碰 / never touch the Desktop profile.
const desktopHome = resolve(homedir(), '.dsh')
const insideDesktop = relative(desktopHome, profileDir)
const escapesDesktop = insideDesktop.startsWith('..') || insideDesktop.includes(':')
if (!escapesDesktop) {
  console.error(`拒绝写入桌面端 profile / refusing to write into the Desktop profile: ${profileDir}`)
  process.exit(1)
}

if (!existsSync(join(profileDir, 'package.json'))) {
  console.error(`找不到 profile 清单 / no profile manifest at: ${join(profileDir, 'package.json')}`)
  process.exit(1)
}

// 先确认已经构建：profile 加载的是 package.json 的 main（dist/index.js）。
// Preflight the build: the profile loads package.json's main (dist/index.js).
if (!existsSync(join(PLUGIN_DIR, 'dist', 'index.js'))) {
  console.error('还没有构建产物 / no build output yet.')
  console.error(`  先执行 / run first: cd "${PLUGIN_DIR}"`)
  console.error('    node link-deps.mjs')
  console.error('    node ..\\node_modules\\typescript\\bin\\tsc')
  process.exit(1)
}

const manifestPath = join(profileDir, 'package.json')
const backupPath = join(profileDir, 'package.json.session-dispatch.bak')
const linkPath = join(profileDir, 'node_modules', BUNDLE_NAME)
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const profile = manifest.dsh ??= {}
const profileSection = profile.profile ??= {}
const bundles = profileSection.bundles ??= []
manifest.dependencies ??= {}

if (revert) {
  profileSection.bundles = bundles.filter(entry => entry !== BUNDLE_NAME)
  delete manifest.dependencies[BUNDLE_NAME]
  // 先写清单再拆联接：拆联接失败也不会留下半还原状态。
  // Write the manifest first: a failed link removal must not leave a half-reverted state.
  writeFileSync(manifestPath, `${JSON.stringify(manifest, undefined, 2)}\n`)
  if (isJunctionTo(linkPath, PLUGIN_DIR)) {
    try {
      // 目录联接必须用 rmdirSync：rmSync 在这台 Node/Windows 上会报 ERR_FS_EISDIR。
      // A directory junction needs rmdirSync; rmSync reports ERR_FS_EISDIR here.
      rmdirSync(linkPath)
      console.log(`已移除目录联接 / removed the junction: ${linkPath}`)
    } catch (error) {
      console.warn(`警告：目录联接未能移除，请手工删除 / could not remove the junction, delete it by hand: ${String(error)}`)
    }
  }
  console.log('已移除 bundle 行与依赖项 / removed the bundle row and the dependency')
  console.log(`如需还原其余内容，参考备份 / restore anything else from: ${backupPath}`)
  console.log('请重启 Web GUI 使该层失效 / restart the Web GUI for the layer to take effect.')
  process.exit(0)
}

// 1. 备份（只备份一次，保留最初状态）/ back up once, keeping the original state.
if (!existsSync(backupPath)) copyFileSync(manifestPath, backupPath)

// 2. 写入依赖与 bundle 层（幂等）/ write the dependency and the bundle layer, idempotently.
const spec = `link:${PLUGIN_DIR.replaceAll('\\', '/')}`
manifest.dependencies[BUNDLE_NAME] = spec
if (!profileSection.bundles.includes(BUNDLE_NAME)) profileSection.bundles.push(BUNDLE_NAME)
writeFileSync(manifestPath, `${JSON.stringify(manifest, undefined, 2)}\n`)
console.log(`package.json: dependencies["${BUNDLE_NAME}"] = ${spec}`)
console.log(`package.json: dsh.profile.bundles = ${JSON.stringify(profileSection.bundles)}`)

// 3. node_modules 目录联接 / create the node_modules junction.
mkdirSync(join(profileDir, 'node_modules'), { recursive: true })
if (isJunctionTo(linkPath, PLUGIN_DIR)) {
  console.log(`junction 已存在 / junction already present: ${linkPath}`)
} else if (pathExists(linkPath)) {
  console.error(`已存在但不是指向本目录的联接，请手工处理后重试 / exists but does not point here: ${linkPath}`)
  process.exitCode = 1
} else {
  symlinkSync(PLUGIN_DIR, linkPath, 'junction')
  console.log(`junction: ${linkPath} -> ${PLUGIN_DIR}`)
}

console.log('\n完成 / done。下一步 / next: 重启 Web GUI，然后让 agent 调用 session_dispatch。')
console.log(`回退 / revert: node "${fileURLToPath(import.meta.url)}" --revert "${profileDir}"`)

/**
 * 判断路径是否存在（含断掉的联接）/ Whether a path exists, including a broken link.
 * @param path - 候选路径 / candidate path.
 * @returns 是否存在于目录项中 / whether a directory entry exists there.
 */
function pathExists(path) {
  try {
    lstatSync(path)
    return true
  } catch {
    return false
  }
}

/**
 * 判断 path 是否是指向 target 的目录联接 / Whether path is a junction pointing at target.
 * @param path - 候选联接路径 / candidate link path.
 * @param target - 期望目标 / expected target.
 * @returns 是否匹配 / whether it matches.
 */
function isJunctionTo(path, target) {
  try {
    if (!lstatSync(path).isSymbolicLink()) return false
    return realpathSync(path).toLowerCase() === realpathSync(target).toLowerCase()
  } catch {
    return false
  }
}
