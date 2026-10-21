/**
 * 入口点门禁：待发布包的运行时入口必须是能被 Node 直接加载的构建产物。
 *
 * 背景：DSH 桌面 profile 把插件装进 `node_modules` 后用普通 Node 加载，而 Node 的
 * 类型剥离机制对 `node_modules` 内的 `.ts` 文件明确拒绝（ERR_UNSUPPORTED_NODE_
 * MODULES_TYPE_STRIPPING，安全策略而非 bug）。开发机从源码起宿主时由 tsx 转译，
 * 掩盖了 `main` 指向 `./src/index.ts` 的包在安装形态下根本无法激活的事实。
 *
 * 规则：
 * 1. 凡声明了 `main` 或 `exports["."]` 的包，运行时入口不得以 `.ts/.tsx/.mts/.cts`
 *    结尾；
 * 2. 入口指向的文件必须真实存在（dist 是 gitignore 的构建产物，缺失时先跑
 *    `pnpm -r build` 再回来检查）；
 * 3. 组合包（bundle）只有配置行没有入口，不声明 `main`/`exports["."]`，自然跳过；
 * 4. 清单里列出的 PENDING 包是已知例外（归属进行中的其他工作），只警告不放行新包——
 *    新包再犯同样的错会当场红。
 *
 * Entry-point gate: a package that will be installed must expose a Node-loadable
 * built artifact as its runtime entry.
 *
 * Background: a DSH desktop profile installs plugins under `node_modules` and
 * loads them with plain Node, whose type stripping explicitly refuses `.ts`
 * files under `node_modules` (ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING — a
 * security policy, not a bug). Running the host from sources hides this because
 * tsx transpiles, so a `main` pointing at `./src/index.ts` simply never
 * activates in the installed form.
 *
 * Rules:
 * 1. Every package declaring `main` or `exports["."]` must not end its runtime
 *    entry with `.ts/.tsx/.mts/.cts`;
 * 2. the entry file must exist (dist is a gitignored build artifact — run
 *    `pnpm -r build` first when missing);
 * 3. bundles carry only configuration rows and no entry, so they skip naturally;
 * 4. PENDING packages below are known exceptions owned by work in flight — they
 *    only warn; any NEW package committing the same mistake fails the gate.
 *
 * @module @veren/scripts/check-entry-points
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * 已知例外：main 仍指向 src、由进行中的其他会话负责收尾的包。
 * 每一项都必须写明归属；对应工作落地后应把条目删掉，让门禁恢复全量。
 * 当前为空：所有待发布包的入口都已指向构建产物。
 *
 * Known exceptions: packages whose main still points at src, to be finished by
 * the sessions that own them. Each entry must name its owner; delete the entry
 * once that work lands so the gate returns to full coverage. Currently empty:
 * every packagable entry now points at a built artifact.
 *
 * @type {Map<string, string>}
 */
const PENDING_PACKAGES = new Map([])

/**
 * 仅限工作区的开发基建：从不打包、从不发布、不会被装进任何 profile 的 node_modules，
 * 消费方按设计直接读它的源码。它不承担"安装后能被 Node 加载"的契约，因此豁免——
 * 豁免必须点名并写明理由，防止这个口子被当成新包的后门。
 *
 * Workspace-only dev infrastructure: never packed, never published, never
 * installed into any profile's node_modules; consumers read its sources by
 * design. It carries no "loadable after install" contract, so it is exempt —
 * exemptions must be named and reasoned to keep the list from becoming a
 * backdoor for new packages.
 *
 * @type {Map<string, string>}
 */
const DEV_ONLY_PACKAGES = new Map([
  ['packages/test-support', 'workspace-only test infrastructure, consumed as sources'],
  ['plugins/page-sync-bench', 'private benchmark, never packed or published; owns its own build'],
])

/** 运行时入口不允许的扩展名 / extensions a runtime entry must not use. */
const TS_ENTRY = /\.mts$|\.cts$|\.tsx?$/

/**
 * 递归收集含 package.json 的包目录，跳过 node_modules。
 * 分组目录可能多层嵌套（plugins/admin/providers/x），靠递归而不是固定层数。
 *
 * Recursively collect package directories, skipping node_modules. Group
 * directories may nest arbitrarily deep (plugins/admin/providers/x), so walk
 * instead of assuming a fixed depth.
 *
 * @param {string} base - directory to scan / 待扫描目录
 * @param {number} [depth] - recursion limit against symlink cycles / 防符号环的递归上限
 * @returns {string[]} package dirs relative to `base` / 相对 `base` 的包目录
 */
function packageDirs(base, depth = 0) {
  if (depth > 4 || !existsSync(base)) return []
  const dirs = []
  for (const entry of readdirSync(base, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === 'node_modules') continue
    const dir = join(base, entry.name)
    if (existsSync(join(dir, 'package.json'))) dirs.push(entry.name)
    else dirs.push(...packageDirs(dir, depth + 1).map(child => `${entry.name}/${child}`))
  }
  return dirs
}

/**
 * 从清单里取运行时入口（main 与 exports["."] 的字符串/default 形态）。
 * Collect the runtime entries declared by a manifest (main plus the string or
 * `default` form of exports["."]).
 *
 * @param {object} manifest - parsed package.json / 已解析的清单
 * @returns {string[]} entry paths relative to the package / 相对包目录的入口路径
 */
function runtimeEntries(manifest) {
  const entries = []
  if (typeof manifest.main === 'string') entries.push(manifest.main)
  const dot = manifest.exports?.['.']
  if (typeof dot === 'string') entries.push(dot)
  else if (typeof dot?.default === 'string') entries.push(dot.default)
  return entries
}

const failures = []
let checked = 0
let pending = 0

for (const base of ['plugins', 'packages']) {
  for (const dirName of packageDirs(join(root, base))) {
    const manifestFile = join(root, base, dirName, 'package.json')
    const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'))
    const id = `${base}/${dirName}`
    const label = typeof manifest.name === 'string' ? `${manifest.name} (${id})` : id
    const entries = runtimeEntries(manifest)
    if (entries.length === 0) continue // 组合包等无入口载体 / bundles carry no entry

    const pendingReason = PENDING_PACKAGES.get(id)
    if (pendingReason !== undefined) {
      pending += 1
      process.stdout.write(`pending  ${label}: entry ${entries.join(', ')} — ${pendingReason}\n`)
      continue
    }
    const devReason = DEV_ONLY_PACKAGES.get(id)
    if (devReason !== undefined) {
      pending += 1
      process.stdout.write(`dev-only ${label}: entry ${entries.join(', ')} — ${devReason}\n`)
      continue
    }

    checked += 1
    for (const entry of new Set(entries)) {
      if (TS_ENTRY.test(entry)) {
        failures.push(`${label}: runtime entry "${entry}" must be built JavaScript, not TypeScript — Node refuses to strip types under node_modules`)
        continue
      }
      if (!existsSync(join(root, base, dirName, entry))) {
        failures.push(`${label}: runtime entry "${entry}" does not exist — run "pnpm -r build" first (dist is gitignored)`)
      }
    }
  }
}

if (failures.length > 0) {
  process.stderr.write(`\n${failures.length} entry-point problem(s):\n`)
  for (const failure of failures) process.stderr.write(`  - ${failure}\n`)
  process.stderr.write('\nFix the manifest (main/exports must point at dist) or build the package before checking.\n')
  process.exit(1)
}

process.stdout.write(`\n${checked} package entr${checked === 1 ? 'y' : 'ies'} point at loadable build artifacts; ${pending} pending package(s) owned by in-flight work.\n`)
