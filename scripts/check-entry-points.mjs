/**
 * 入口点门禁：待发布包的运行时入口必须是能被 Node 直接加载的构建产物。
 *
 * 背景：DSH 桌面 profile 把插件装进 `node_modules` 后用普通 Node 加载，而 Node 的
 * 类型剥离机制对 `node_modules` 内的 `.ts` 文件明确拒绝（ERR_UNSUPPORTED_NODE_
 * MODULES_TYPE_STRIPPING，安全策略而非 bug）。开发机从源码起宿主时由 tsx 转译，
 * 掩盖了 `main` 指向 `./src/index.ts` 的包在安装形态下根本无法激活的事实。
 *
 * 规则：
 * 1. 凡声明了 `main` 或 `exports` 的包，**运行时入口**（`main`、`exports` 顶层
 *    字符串、以及任意子路径如 `"./client"` 的字符串/`default` 形态）不得以
 *    `.ts/.tsx/.mts/.cts` 结尾；
 * 2. `exports` 声明的**每一条路径**（含 `types` 条件与 `"./package.json"`）在
 *    打包形态下都必须真实存在——`dist` 与 `lib` 均是 gitignore 的构建产物，缺失
 *    时先跑 `pnpm -r build` 再回来检查（各包 `prepack` 会在 `pnpm pack` 时自动
 *    构建，见 AGENTS.md「装插件」条目）；
 * 3. 含通配符（`*`）的映射（如 `"./locale/*.json"`、`"./src/*"`）无法静态定位
 *    单个文件，跳过存在性检查；
 * 4. 组合包（bundle）只有配置行没有入口，不声明 `main`/`exports` 入口，自然跳过；
 * 5. 清单里列出的 PENDING 包是已知例外（归属进行中的其他工作），只警告不放行
 *    新包——新包再犯同样的错会当场红。
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
 * 1. Every **runtime entry** (`main`, a top-level string in `exports`, or the
 *    string/`default` form of any subpath such as `"./client"`) must not end
 *    with `.ts/.tsx/.mts/.cts`;
 * 2. **every path declared in `exports`** (including `types` conditions and
 *    `"./package.json"`) must exist in the packed form — `dist` and `lib` are
 *    gitignored build artifacts, so run `pnpm -r build` first when missing
 *    (each package's `prepack` builds automatically during `pnpm pack`, see the
 *    install entry in AGENTS.md);
 * 3. mappings containing wildcards (`"./locale/*.json"`, `"./src/*"`) cannot be
 *    resolved to single files statically, so their existence is not checked;
 * 4. bundles carry only configuration rows and no entry, so they skip naturally;
 * 5. PENDING packages below are known exceptions owned by work in flight — they
 *    only warn; any NEW package committing the same mistake fails the gate.
 *
 * @module @veren/scripts/check-entry-points
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

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

/** 通配符映射：无法静态定位单个文件 / wildcard mappings resolve no single file. */
const GLOB = /\*/

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
 * 深度收集一个 exports 值的全部目标路径。字符串即路径；条件对象里 `default`
 * 分支承载运行时入口，`types` 等其余条件只是声明文件，沿对象继续下钻。
 * Collect every target path inside one exports value. A string is a path; in a
 * conditions object the `default` branch carries the runtime entry while
 * `types` and the other conditions only declare declaration files — keep
 * descending through nested objects.
 *
 * @param {string|object} value - exports value / exports 的某个值
 * @param {boolean} runtime - inherited runtime-entry marker / 继承的运行时入口标记
 * @returns {{path: string, runtime: boolean}[]} collected targets / 收集到的目标
 */
function collectExportTargets(value, runtime) {
  if (typeof value === 'string') return [{ path: value, runtime }]
  const targets = []
  for (const [condition, nested] of Object.entries(value)) {
    targets.push(...collectExportTargets(nested, runtime || condition === 'default'))
  }
  return targets
}

/**
 * 从清单里取全部声明目标：`main` 是运行时入口；`exports` 每个子路径都参与
 * 存在性检查，其中字符串值与 `default` 形态还是运行时入口。
 * Collect every declared target from a manifest: `main` is a runtime entry;
 * every `exports` subpath joins the existence check, and string values plus
 * `default` forms are runtime entries too.
 *
 * @param {object} manifest - parsed package.json / 已解析的清单
 * @returns {{path: string, runtime: boolean}[]} declared targets / 声明的目标
 */
function declaredTargets(manifest) {
  const targets = []
  if (typeof manifest.main === 'string') targets.push({ path: manifest.main, runtime: true })
  for (const value of Object.values(manifest.exports ?? {})) {
    targets.push(...collectExportTargets(value, false))
  }
  return targets
}

/**
 * 门禁主体：扫描 rootDir 下 plugins/packages 的全部包，返回问题清单与计数。
 * 独立成纯函数，供 CLI 与红灯自测（scripts/tests/）共用同一套逻辑。
 * Gate core: scan every package under rootDir's plugins/packages and return the
 * problem list plus counters. Extracted as a pure function so the CLI and the
 * red-light self test (scripts/tests/) share one implementation.
 *
 * @param {string} rootDir - workspace root to scan / 待扫描的工作区根目录
 * @returns {{checked: number, pending: number, problems: string[]}} gate result / 门禁结果
 */
export function collectEntryProblems(rootDir) {
  const problems = []
  let checked = 0
  let pending = 0
  for (const base of ['plugins', 'packages']) {
    for (const dirName of packageDirs(join(rootDir, base))) {
      const manifestFile = join(rootDir, base, dirName, 'package.json')
      const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'))
      const id = `${base}/${dirName}`
      const label = typeof manifest.name === 'string' ? `${manifest.name} (${id})` : id
      const targets = declaredTargets(manifest)
      if (targets.length === 0) continue // 组合包等无入口载体 / bundles carry no entry

      const pendingReason = PENDING_PACKAGES.get(id)
      const devReason = DEV_ONLY_PACKAGES.get(id)
      if (pendingReason !== undefined || devReason !== undefined) {
        pending += 1
        const reason = pendingReason ?? devReason
        process.stdout.write(`dev-only ${label}: entry ${[...new Set(targets.map(t => t.path))].join(', ')} — ${reason}\n`)
        continue
      }

      checked += 1
      const seen = new Set()
      for (const target of targets) {
        if (seen.has(target.path)) continue // 同一路径只报一次 / report each path once
        seen.add(target.path)
        if (GLOB.test(target.path)) continue // 通配符映射不查单文件 / wildcard mappings skip file checks
        if (target.runtime && TS_ENTRY.test(target.path)) {
          problems.push(`${label}: runtime entry "${target.path}" must be built JavaScript, not TypeScript — Node refuses to strip types under node_modules`)
          continue
        }
        if (!existsSync(join(rootDir, base, dirName, target.path))) {
          problems.push(`${label}: declared path "${target.path}" does not exist — run "pnpm -r build" first (dist/lib are gitignored; prepack builds them on pack)`)
        }
      }
    }
  }
  return { checked, pending, problems }
}

/** CLI 直跑判定：被 vitest import 时不自动执行 / run as CLI only, not when imported by vitest. */
function isDirectInvocation() {
  return process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
}

if (isDirectInvocation()) {
  const { checked, pending, problems } = collectEntryProblems(root)
  if (problems.length > 0) {
    process.stderr.write(`\n${problems.length} entry-point problem(s):\n`)
    for (const problem of problems) process.stderr.write(`  - ${problem}\n`)
    process.stderr.write('\nFix the manifest (entries must point at dist/lib) or build the package before checking.\n')
    process.exit(1)
  }
  process.stdout.write(`\n${checked} package entr${checked === 1 ? 'y' : 'ies'} point at loadable build artifacts; ${pending} pending package(s) owned by in-flight work.\n`)
}
