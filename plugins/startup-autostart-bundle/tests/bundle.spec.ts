// Bundle invariant tests. Two invariants, both pure file parsing:
// 1. Composition shape: exactly four rows in dependency order - Host first,
//    then the model-facing tools, then the guidance skill that teaches when and
//    how to use them, then the Web UI - with no configuration on any row (each
//    member already carries its own defaults).
// 2. Bundle ownership: the bundle is the stack's ONLY profile layer - its
//    manifest declares exactly one patch file and all four members, while no
//    member declares `dsh.bundle.patch`. This is what keeps `dsh plugin`
//    reconciliation from activating a second, duplicate layer on install.
// Concurrency safe: read-only, no shared state.
// 组合包不变量测试。两个不变量，均为纯文件解析：
// 1. 组合形态：恰好四行、按依赖顺序——先 Host，再面向模型的工具，再教「何时、
//    怎么用」的指导技能，最后是 Web UI，且每行不带任何配置（各成员自带默认值）。
// 2. bundle 归属：组合包是技术栈唯一的 profile 层——自身 manifest 只声明一个
//    patch 文件并列全四个成员，而任何成员都不得声明 `dsh.bundle.patch`。
//    这保证 `dsh plugin` 的 reconciliation 在安装时不会激活第二个重复层。
// 并发安全：只读文件，无共享状态。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import yaml from 'js-yaml'

interface PatchRow {
  id: string
  name: string
  config?: Record<string, unknown>
}

interface PatchOp {
  insert: PatchRow[]
}

interface PackageManifest {
  name: string
  version: string
  dependencies?: Record<string, string>
  dsh?: { bundle?: { patch?: string | string[] } }
  files?: string[]
}

const bundleManifestPath = fileURLToPath(new URL('../package.json', import.meta.url))

/** Read one workspace package manifest from the sibling plugins directory. */
/** 从相邻的 plugins 目录读取某个工作区包 manifest。 */
function readMemberManifest(memberDir: string): PackageManifest {
  // 本 spec 在 tests/ 下，两级 `..` 先出包根，再进相邻成员目录。
  // This spec lives under tests/: two `..` levels exit the package root
  // before entering the sibling member directory.
  const url = new URL(`../../${memberDir}/package.json`, import.meta.url)
  return JSON.parse(readFileSync(fileURLToPath(url), 'utf8')) as PackageManifest
}

/** Load and flatten the bundle's `insert` operations. */
/** 读取并摊平组合包的全部 `insert` 操作。 */
function loadRows(): PatchRow[] {
  const patchPath = fileURLToPath(new URL('../cordis.patch.yml', import.meta.url))
  const doc = yaml.load(readFileSync(patchPath, 'utf8')) as PatchOp[]
  return doc.flatMap((op) => op.insert)
}

describe('startup-autostart-bundle patch', () => {
  const rows = loadRows()

  it('inserts exactly four rows in dependency order', () => {
    // 四行、按依赖顺序：Host 必须最先插入；工具与 UI 依赖它的接口面；技能行
    // 讲的是工具怎么用，因此紧跟在工具之后。
    // Four rows in dependency order: the Host must be inserted first; the
    // tools and the UI depend on its surface; the guidance row documents those
    // tools, so it rides directly after them.
    expect(rows.map((row) => row.name)).toEqual([
      '@veren/startup-autostart',
      '@veren/startup-autostart-tool',
      '@veren/startup-autostart-skill',
      '@veren/startup-autostart-ui',
    ])
  })

  it('carries no per-row configuration', () => {
    // 每行零配置：各成员自带默认值，组合包不做二次裁剪。
    // Zero config per row: every member ships its own defaults; the bundle
    // performs no second-guessing overrides.
    for (const row of rows) {
      expect(row.config, `${row.name} must not carry config`).toBeUndefined()
    }
  })
})

describe("startup-autostart-bundle owns the stack's only bundle layer", () => {
  // 四个成员目录：与组合包同在 plugins/ 工作区里。
  // The four member directories: siblings of the bundle in the plugins/
  // workspace.
  const members = [
    'startup-autostart',
    'startup-autostart-tool',
    'startup-autostart-skill',
    'startup-autostart-ui',
  ]
  const bundle = JSON.parse(
    readFileSync(bundleManifestPath, 'utf8'),
  ) as PackageManifest

  it('declares exactly one patch file and depends on every member', () => {
    // 唯一 patch 文件 + 全员依赖：安装组合包即安装整栈。
    // One patch file plus every member as a dependency: installing the
    // bundle installs the whole stack.
    expect(bundle.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    for (const member of members) {
      const manifest = readMemberManifest(member)
      expect(bundle.dependencies?.[manifest.name], `${manifest.name} must be a dependency`).toBeDefined()
    }
  })

  it('exposes no member as a bundle', () => {
    // 成员必须零 bundle 声明：否则 dsh plugin 的 reconciliation 会把成员
    // patch 也激活成一层，与本组合包重复插行。
    // A member must carry no bundle declaration: otherwise dsh plugin
    // reconciliation activates the member patch as another layer, and it
    // would insert rows duplicating this bundle's.
    for (const member of members) {
      const manifest = readMemberManifest(member)
      expect(manifest.dsh?.bundle, `${manifest.name} must not declare dsh.bundle`).toBeUndefined()
      // files 里也不得再携带 patch 文件：不留对外暴露的残迹。
      // The files list must not carry a patch file either: no residue of an
      // outward-facing bundle.
      expect(manifest.files ?? []).not.toContain('cordis.patch.yml')
    }
  })
})
