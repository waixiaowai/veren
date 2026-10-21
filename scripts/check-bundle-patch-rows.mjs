/**
 * Guard the G1 bundle-patch row-ownership contract.
 *
 * Every `plugins/*-bundle/cordis.patch.yml` inserts loader rows by id. If two
 * bundles inserted the same id, installing both would append the row twice and
 * the Loader composes inserts as a pure append (`applyEntryPatches` in the
 * harness vendor include) — undefined behavior. The contract therefore is:
 *
 * 1. A row id may be inserted by at most one bundle.
 * 2. The application-framework ids (`app-registry`, `page-registry`,
 *    `task-center`, `app-host`) may only appear in `app-host-bundle`.
 * 3. Any bundle other than `app-host-bundle` that inserts an app-framework
 *    consumer (a row whose package hard-injects the framework) must declare
 *    `@veren/app-host-bundle` as a dependency; this script checks the one
 *    known consumer list below — extend it when a new framework consumer
 *    bundle lands.
 *
 * 守卫 G1 组合包 patch 行所有权契约。
 *
 * 每个 `plugins/*-bundle/cordis.patch.yml` 都按 id 插 loader 行。若两个组合包
 * 插了同一个 id，同装时会追加两次，而 Loader 对 insert 是纯追加（harness
 * vendor include 的 `applyEntryPatches`）——行为未定义。因此契约是：
 *
 * 1. 一个行 id 至多被一个组合包插入。
 * 2. 应用框架 id（`app-registry`、`page-registry`、`task-center`、`app-host`）
 *    只允许出现在 `app-host-bundle` 里。
 * 3. `app-host-bundle` 之外、其成员硬注入应用框架的组合包，必须把
 *    `@veren/app-host-bundle` 声明为依赖；本脚本检查下面这份已知消费者清单，
 *    新增框架消费者组合包时请扩充。
 *
 * Usage / 用法: node scripts/check-bundle-patch-rows.mjs
 *
 * @module @veren/scripts/check-bundle-patch-rows
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { load } from 'js-yaml'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const bundlesDir = join(root, 'plugins')

/** Loader row ids owned exclusively by the app-host bundle. 框架行 id 及其唯一属主。 */
const FRAMEWORK_ROW_IDS = ['app-registry', 'page-registry', 'task-center', 'app-host']
const FRAMEWORK_BUNDLE = '@veren/app-host-bundle'

/**
 * Bundles whose members hard-inject the application framework and therefore
 * must depend on the framework bundle. 成员硬注入应用框架、必须依赖框架组合包的组合包。
 */
const FRAMEWORK_CONSUMERS = new Set(['@veren/forum-bundle', '@veren/notebook-bundle'])

/** One inserted row as the patch YAML declares it. patch YAML 声明的一条插入行。 */
function insertedRows(bundleDir) {
  const text = readFileSync(join(bundleDir, 'cordis.patch.yml'), 'utf8')
  const layers = load(text)
  return layers.flatMap(layer => layer?.insert ?? [])
}

/** @returns {string[]} the contract violations found / 违反契约的清单 */
function violations() {
  const problems = []
  /** row id -> bundle names inserting it / 行 id -> 插它的组合包清单 */
  const owners = new Map()
  const manifests = new Map()

  for (const entry of readdirSync(bundlesDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.endsWith('-bundle')) continue
    const dir = join(bundlesDir, entry.name)
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    manifests.set(manifest.name, manifest)
    for (const row of insertedRows(dir)) {
      if (row.id === undefined) continue
      if (!owners.has(row.id)) owners.set(row.id, [])
      owners.get(row.id).push(manifest.name)
    }
  }

  for (const [id, names] of owners) {
    if (names.length > 1) {
      problems.push(`row "${id}" is inserted by ${names.length} bundles: ${names.join(', ')}`)
    }
    if (FRAMEWORK_ROW_IDS.includes(id) && !names.includes('@veren/app-host-bundle')) {
      problems.push(`framework row "${id}" is inserted by ${names.join(', ')}; only ${FRAMEWORK_BUNDLE} may insert it`)
    }
  }

  for (const name of FRAMEWORK_CONSUMERS) {
    const manifest = manifests.get(name)
    if (manifest === undefined) continue
    if (manifest.dependencies?.[FRAMEWORK_BUNDLE] === undefined) {
      problems.push(`${name} composes framework consumers but does not depend on ${FRAMEWORK_BUNDLE}`)
    }
  }
  return problems
}

const problems = violations()
if (problems.length > 0) {
  for (const problem of problems) process.stderr.write(`G1 violation: ${problem}\n`)
  process.exit(1)
}
process.stdout.write('bundle patch rows: ownership contract OK\n')
