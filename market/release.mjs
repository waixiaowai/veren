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
import { readdir, readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { ROOT_DIR, SOURCES_FILE } from './lib/paths.mjs'
import { promisify } from 'node:util'

const run = promisify(execFile)
const DRY_RUN = process.argv.includes('--dry-run')
const REGISTRY = 'https://npm.veren.top/'
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
    for (const dependency of Object.keys(manifest.dependencies ?? {})) {
      if (packages.has(dependency)) visit(dependency)
    }
    state.set(name, 'done')
    ordered.push(manifest)
  }
  for (const root of roots) visit(root)
  return ordered
}

/**
 * registry 里已有的版本 / Versions the registry already publishes.
 * @param {string} name - 包名 / Package name.
 * @returns {Promise<string[]>} 版本列表 / Published versions.
 */
async function publishedVersions(name) {
  const response = await fetch(`${REGISTRY}${name.replace('/', '%2f')}`)
  if (response.status === 404) return []
  if (!response.ok) throw new Error(`${name}: registry HTTP ${response.status}`)
  return Object.keys((await response.json()).versions ?? {})
}

/**
 * 发布一个包 / Publish one package.
 * @param {object} manifest - 包清单 / Package manifest.
 * @returns {Promise<void>} 发布结束后 resolve / Resolves when pnpm finishes.
 */
async function publish(manifest) {
  const args = ['--filter', manifest.name, 'publish', '--no-git-checks', '--access', 'public', '--registry', REGISTRY]
  if (DRY_RUN) {
    console.log(`dry-run: pnpm ${args.join(' ')}`)
    return
  }
  console.log(`publishing ${manifest.name}@${manifest.version}`)
  const { stdout } = await run('pnpm', args, { cwd: ROOT_DIR, maxBuffer: 16 * 1024 * 1024 })
  for (const line of stdout.split('\n')) if (line.includes('+ ')) console.log(`  ${line.trim()}`)
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
    const versions = await publishedVersions(manifest.name)
    if (versions.includes(manifest.version)) {
      console.log(`skip (published): ${manifest.name}@${manifest.version}`)
      continue
    }
    await publish(manifest)
  }
}

await main()
