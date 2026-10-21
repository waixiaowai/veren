/**
 * 发布索引源需要的所有 workspace 包 / Publish every workspace package the index source needs.
 *
 * 起点是 sources.txt 里的 bundle，按 `dependencies` 展开 workspace 依赖得到闭包，再做拓扑排序（依赖先发）。
 * 已经存在于 registry 的版本会被跳过，因此重复执行是安全的。
 * Starts from the bundles in sources.txt, closes over workspace dependencies, and publishes in dependency order.
 * A version that the registry already has is skipped, so re-running is safe.
 *
 * 用法 / Usage:
 *   node market/release.mjs --dry-run   # 只打印计划 / print the plan
 *   node market/release.mjs             # 真正发布 / publish for real
 */
import { execFile } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { loadDotEnv } from './lib/dotenv.mjs'
import { ROOT_DIR, SOURCES_FILE } from './lib/paths.mjs'
import { satisfies } from './lib/semver.mjs'
import { promisify } from 'node:util'

const run = promisify(execFile)
const DRY_RUN = process.argv.includes('--dry-run')
const REGISTRY = 'https://npm.veren.top/'
// 发布凭据只从环境变量取：仓库根的 .env（gitignore 的 *.env 规则覆盖，不入库）
// 或外部环境变量二选一，已导出的环境变量优先。pnpm publish 不认
// `--//host/:_authToken=` 形式的 CLI 参数，发布时 token 改经系统临时目录的
// 专用 .npmrc 传给子进程（见 publish）：绝不进仓库文件、不进 argv。
// The publish credential comes from the environment only: either the
// gitignored root .env (loaded below) or an exported variable, which wins.
// `pnpm publish` ignores a `--//host/:_authToken=` CLI flag, so at publish
// time the token travels through a dedicated .npmrc under the system temp
// dir (see publish): never into a committed file, never into argv.
loadDotEnv()
const TOKEN = process.env.NPM_TOKEN ?? ''
/** registry 文档缓存 / registry document cache. */
const registryCache = new Map()
/** 扫描的目录 / Directories scanned for workspace packages. */
const ROOTS = ['plugins', 'packages']

/**
 * 递归收集工作区包 / Collect workspace packages recursively.
 * @returns {Promise<Map<string, object>>} 包名到清单的映射 / Package name to manifest.
 */
async function workspacePackages() {
  const found = new Map()
  /**
   * @param {string} dir - 目录 / Directory to scan.
   * @returns {Promise<void>} 扫描完成时 resolve / Resolves when the subtree is scanned.
   */
  async function walk(dir) {
    const manifestPath = join(dir, 'package.json')
    if (await exists(manifestPath)) {
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
      if (typeof manifest.name === 'string') found.set(manifest.name, { ...manifest, dir })
      return
    }
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name !== 'node_modules') await walk(join(dir, entry.name))
    }
  }
  for (const root of ROOTS) await walk(resolve(ROOT_DIR, root))
  return found
}

/**
 * 判断路径是否存在 / Test whether a path exists.
 * @param {string} path - 待测路径 / Path to test.
 * @returns {Promise<boolean>} 存在为 true / True when it exists.
 */
async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/**
 * 从 bundle 出发收集依赖闭包并拓扑排序 / Close over dependencies from the bundles and sort them topologically.
 * @param {Map<string, object>} packages - 工作区清单 / Workspace manifests.
 * @param {string[]} roots - 起点包名 / Starting package names.
 * @returns {object[]} 依赖先行的发布顺序 / Publish order, dependencies first.
 */
function releaseOrder(packages, roots) {
  const ordered = []
  const state = new Map()
  /**
   * @param {string} name - 包名 / Package name.
   * @returns {void}
   */
  function visit(name) {
    if (state.get(name) === 'done') return
    if (state.get(name) === 'visiting') throw new Error(`循环依赖 / dependency cycle at ${name}`)
    const manifest = packages.get(name)
    if (manifest === undefined) throw new Error(`${name} 不在工作区里 / is not a workspace package`)
    state.set(name, 'visiting')
    // peerDependencies 也是安装闭包的一部分：市场装的包若 peer 指向 workspace 包，
    // registry 上必须存在，否则客户端安装时 peer 解析失败。
    // peerDependencies are part of the install closure: a market install fails peer
    // resolution when a peer points at a workspace package the registry lacks.
    for (const field of ['dependencies', 'peerDependencies']) {
      for (const dependency of Object.keys(manifest[field] ?? {})) {
        if (packages.has(dependency)) visit(dependency)
      }
    }
    state.set(name, 'done')
    ordered.push(manifest)
  }
  for (const root of roots) visit(root)
  return ordered
}

/**
 * registry 上已有的各版本清单 / The manifest the registry holds for every published version.
 * 逐包验证会反复查同一批文档，这里缓存一次 / cached: verification queries the same documents repeatedly.
 * @param {string} name - 包名 / Package name.
 * @returns {Promise<Record<string, object>>} 版本号到清单的映射 / Version to published manifest.
 */
async function registryManifests(name) {
  const cached = registryCache.get(name)
  if (cached !== undefined) return cached
  const response = await fetch(`${REGISTRY}${name.replace('/', '%2f')}`)
  if (!response.ok && response.status !== 404) throw new Error(`${name}: registry HTTP ${response.status}`)
  const versions = response.status === 404 ? {} : (await response.json()).versions ?? {}
  registryCache.set(name, versions)
  return versions
}

/**
 * 依赖声明与 registry 不一致的字段 / Declared fields that drifted from the registry.
 *
 * 同一个版本号一旦发布就不能再改，所以"源码已修、版本号没升"只会让注册中心继续供
 * 旧清单：本地跑测试通过，装进 profile 却还是旧依赖分类（典型症状是一份 cordis /
 * dsh-* 被装进 profile，把宿主服务遮蔽成 pending）。这里把这种不一致显式说出来。
 * A published version is immutable, so "source fixed, version not bumped" keeps the
 * registry serving the old classification: local tests pass, the profile still installs a
 * second cordis / dsh-* copy and shadows the host service into `pending`. Report it loudly.
 * @param {object} local - 本地清单 / Local manifest.
 * @param {object} published - registry 上的同版本清单 / The registry manifest of that version.
 * @returns {string[]} 漂移的字段名 / Names of the drifted fields.
 */
function dependencyDrift(local, published) {
  // `workspace:^` 在发布时会被改写成具体区间，逐键比较时把它当作恒等，否则每个工作区依赖都算漂移。
  // `workspace:^` is rewritten to a concrete range on publish, so compare it as equal per key.
  const same = (left, right) => typeof left === 'string' && left.startsWith('workspace:') ? true : left === right
  return ['dependencies', 'peerDependencies', 'engines'].filter((field) => {
    const left = local[field] ?? {}
    const right = published[field] ?? {}
    const keys = new Set([...Object.keys(left), ...Object.keys(right)])
    for (const key of keys) if (!same(left[key], right[key])) return true
    return false
  })
}

/**
 * 发布一个包 / Publish one package.
 * @param {object} manifest - 包清单 / Package manifest.
 * @returns {Promise<void>} 发布结束后 resolve / Resolves when pnpm finishes.
 */
async function publish(manifest) {
  const args = ['--filter', manifest.name, 'publish', '--no-git-checks', '--access', 'public', '--registry', REGISTRY]
  if (DRY_RUN) {
    console.log(`dry-run: pnpm ${args.join(' ')} (auth via temp userconfig)`)
    return
  }
  if (TOKEN === '') {
    throw new Error('NPM_TOKEN 未设置 / is not set: 把值写进仓库根 .env 的 NPM_TOKEN= 行，或导出同名环境变量；值从桌面 profile 的 .npmrc 只读复制，不要写进任何入库文件')
  }
  console.log(`publishing ${manifest.name}@${manifest.version}`)
  // token 写进系统临时目录的专用 .npmrc，用 NPM_CONFIG_USERCONFIG 指给发布子进程，
  // 发布完即删：不进仓库文件、不进 argv（argv 会带进错误日志）。
  // Write the token into a dedicated .npmrc under the system temp dir, hand it
  // to the publish subprocess via NPM_CONFIG_USERCONFIG, delete it afterwards:
  // the token stays out of repo files and out of argv, which leaks into error logs.
  const authDir = mkdtempSync(join(tmpdir(), 'veren-publish-'))
  const authFile = join(authDir, '.npmrc')
  writeFileSync(authFile, `//npm.veren.top/:_authToken=${TOKEN}\n`, { mode: 0o600 })
  try {
    // Windows 上 pnpm 是 .cmd，必须经 shell 启动 / On Windows pnpm is a .cmd shim, so it needs a shell.
    const { stdout } = await run('pnpm', args, {
      cwd: ROOT_DIR,
      maxBuffer: 16 * 1024 * 1024,
      shell: process.platform === 'win32',
      env: { ...process.env, NPM_CONFIG_USERCONFIG: authFile, npm_config_userconfig: authFile },
    })
    for (const line of stdout.split('\n')) if (line.includes('+ ')) console.log(`  ${line.trim()}`)
  } finally {
    rmSync(authDir, { recursive: true, force: true })
  }
}

/**
 * 发布后验证：目标版本在 registry 上，且已发布清单里声明的每个第一方依赖都能在
 * registry 上找到满足区间的版本。这正是"file: 删掉之后到底装不装得上"的判据。
 * Post-publish verification: the target version is on the registry and every
 * first-party dependency the published manifest declares resolves there — the
 * test that dependencies still install now that file: rewriting is gone.
 *
 * @param {Map<string, object>} packages - 工作区清单 / workspace manifests.
 * @param {object[]} manifests - 待验证清单 / manifests to verify.
 * @returns {Promise<string[]>} 问题列表 / problems.
 */
async function verifyReleased(packages, manifests) {
  const problems = []
  for (const manifest of manifests) {
    const before = problems.length
    const versions = await registryManifests(manifest.name)
    if (!Object.hasOwn(versions, manifest.version)) {
      problems.push(`${manifest.name}@${manifest.version} is missing from the registry`)
    } else {
      const declared = versions[manifest.version]
      for (const section of ['dependencies', 'peerDependencies']) {
        for (const [name, spec] of Object.entries(declared[section] ?? {})) {
          if (!packages.has(name)) continue
          const candidates = Object.keys(await registryManifests(name))
          if (!candidates.some(version => satisfies(version, spec) === true)) {
            problems.push(`${manifest.name}@${manifest.version} → ${name}@${spec} has no published version on the registry`)
          }
        }
      }
    }
    if (problems.length === before) console.log(`ok ${manifest.name}@${manifest.version} — every first-party dependency resolves`)
  }
  return problems
}

/**
 * 主流程 / Main flow.
 * @returns {Promise<void>} 全部包处理完后 resolve / Resolves after every package is handled.
 */
async function main() {
  const packages = await workspacePackages()
  const sources = (await readFile(SOURCES_FILE, 'utf8'))
    .split('\n').map(line => line.trim()).filter(line => line !== '' && !line.startsWith('#'))
  const ordered = releaseOrder(packages, sources)
  const publishable = ordered.filter(manifest => manifest.private !== true)
  const skipped = ordered.filter(manifest => manifest.private === true)
  for (const manifest of skipped) console.log(`skip (private): ${manifest.name}`)

  for (const manifest of publishable) {
    const published = await registryManifests(manifest.name)
    if (Object.hasOwn(published, manifest.version)) {
      const drifted = dependencyDrift(manifest, published[manifest.version])
      const label = `skip (published): ${manifest.name}@${manifest.version}`
      if (drifted.length === 0) console.log(label)
      else {
        console.log(`${label} — 依赖声明与本地不同（${drifted.join(', ')}），注册中心仍供旧清单，请升版本号后再发`)
        console.log(`${label} — dependency declaration drifted from source (${drifted.join(', ')}); bump the version and publish again`)
      }
      continue
    }
    await publish(manifest)
  }

  if (DRY_RUN) return
  // 主流程发布前查过同一批 registry 文档，缓存里还是旧清单；验证必须重新拉取，
  // 否则刚发布的版本会被误报成 missing。
  // main() queried the same registry documents before publishing, so the cache
  // still holds stale manifests; verification must refetch, or freshly
  // published versions get reported as missing.
  registryCache.clear()
  const problems = await verifyReleased(packages, publishable)
  for (const problem of problems) console.error(`DEP PROBLEM: ${problem}`)
  if (problems.length > 0) throw new Error(`${problems.length} released manifest(s) do not resolve on ${REGISTRY}`)
  console.log(`verified ${publishable.length} manifest(s): every version and first-party dependency resolves on ${REGISTRY}`)
}

await main()
