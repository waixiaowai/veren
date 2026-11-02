/**
 * 组合包不变量测试。两个不变量，均为纯文件解析：
 * 1. 组合形态：单条应用行——应用即整栈（每日采集、持久快照、派生指标、四页与
 *    报告投递都活在应用里），没有开关行。
 * 2. bundle 归属：组合包是技术栈唯一的 profile 层——自身 manifest 只声明一个
 *    patch 文件，依赖应用框架组合包（@veren/app-host-bundle 带入框架行）与应用
 *    本身，而成员不得声明 `dsh.bundle.patch`。这保证 `dsh plugin` 的
 *    reconciliation 在安装时不会激活第二个重复层。
 * 并发安全：只读文件，无共享状态。
 *
 * Bundle invariant tests. Two invariants, both pure file parsing:
 * 1. Composition shape: exactly one app row - the app IS the whole stack (the
 *    daily pull, the durable snapshots, the derived metrics, the four pages, and
 *    the report delivery all live inside the app).
 * 2. Bundle ownership: the bundle is the stack's ONLY profile layer - its
 *    manifest declares exactly one patch file, depends on the application
 *    framework bundle (@veren/app-host-bundle brings the framework rows) and
 *    the app, while no member declares `dsh.bundle.patch`. This is what keeps
 *    `dsh plugin` reconciliation from activating a second, duplicate layer on
 *    install.
 * Concurrency safe: read-only, no shared state.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import yaml from 'js-yaml'

/** 一条 patch 行 / one patch row */
interface PatchRow {
  id: string
  name: string
  config?: Record<string, unknown>
}

/** 一组 patch 操作 / one patch operation */
interface PatchOp {
  insert: PatchRow[]
}

/** 一个包的清单 / one package manifest */
interface PackageManifest {
  name: string
  version: string
  dependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  dsh?: { bundle?: { patch?: string | string[] } }
  files?: string[]
}

const bundleManifestPath = fileURLToPath(new URL('../package.json', import.meta.url))

/** 读取一个工作区包清单（相邻成员目录）/ reads one workspace package manifest (a sibling member directory) */
function readMemberManifest(memberDir: string): PackageManifest {
  // 本 spec 在 tests/ 下：两级 `..` 先出包根，再进相邻成员目录。
  // This spec lives under tests/: two `..` levels exit the package root
  // before entering the sibling member directory.
  const url = new URL(`../../${memberDir}/package.json`, import.meta.url)
  return JSON.parse(readFileSync(fileURLToPath(url), 'utf8')) as PackageManifest
}

/** 读取并摊平组合包唯一的 `insert` 操作 / loads and flattens the bundle's single `insert` operation */
function loadRows(): PatchRow[] {
  const patchPath = fileURLToPath(new URL('../cordis.patch.yml', import.meta.url))
  const doc = yaml.load(readFileSync(patchPath, 'utf8')) as PatchOp[]
  return doc.flatMap((op) => op.insert)
}

describe('composition shape', () => {
  it('inserts exactly one row: the app', () => {
    const rows = loadRows()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.id).toBe('zhihu-ops')
    expect(rows[0]?.name).toBe('@veren/zhihu-ops')
  })

  it('carries no per-feature toggle rows', () => {
    for (const row of loadRows()) {
      expect(Object.keys(row)).not.toContain('enabled')
    }
  })
})

describe('bundle ownership', () => {
  it('declares exactly one patch file', () => {
    const manifest = JSON.parse(readFileSync(bundleManifestPath, 'utf8')) as PackageManifest
    const patch = manifest.dsh?.bundle?.patch
    expect(patch).toBe('./cordis.patch.yml')
  })

  it('depends on the framework bundle and the app', () => {
    const manifest = JSON.parse(readFileSync(bundleManifestPath, 'utf8')) as PackageManifest
    expect(manifest.dependencies?.['@veren/app-host-bundle']).toBeDefined()
    expect(manifest.dependencies?.['@veren/zhihu-ops']).toBeDefined()
  })

  it('ships the member without a bundle declaration of its own', () => {
    const member = readMemberManifest('zhihu-ops')
    expect(member.dsh?.bundle).toBeUndefined()
    expect(member.peerDependencies?.['@veren/zhihu-ops']).toBeUndefined()
  })
})
