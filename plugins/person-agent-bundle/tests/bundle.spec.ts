// Bundle invariant tests. Two invariants, both pure file parsing:
// 1. Composition shape: exactly one preset row, the bridge shape - the
//    delegating persona and both maintenance tool families always on, no
//    toggles left. The other four members are composed by the preset
//    definition itself as per-session child rows, so one row is the whole
//    integration.
// 2. Bundle ownership: the bundle is the stack's ONLY profile layer - its
//    manifest declares exactly one patch file and all five members, while no
//    member declares `dsh.bundle.patch`. This is what keeps `dsh plugin`
//    reconciliation from activating a second, duplicate layer on install.
// Concurrency safe: read-only, no shared state.
// 组合包不变量测试。两个不变量，均为纯文件解析：
// 1. 组合形态：单条预设行、桥梁形态——派活人设与两类维护工具常开，不再有
//    任何开关。其余四个成员由预设定义本身作为按会话子行组合，插入这一行即
//    完成全部集成。
// 2. bundle 归属：组合包是技术栈唯一的 profile 层——自身 manifest 只声明一个
//    patch 文件并列全五个成员，而任何成员都不得声明 `dsh.bundle.patch`。
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
  // 本 spec 在 tests/ 下：两级 `..` 先出包根，再进相邻成员目录。
  // This spec lives under tests/: two `..` levels exit the package root
  // before entering the sibling member directory.
  const url = new URL(`../../${memberDir}/package.json`, import.meta.url)
  return JSON.parse(readFileSync(fileURLToPath(url), 'utf8')) as PackageManifest
}

/** Load and flatten the bundle's single `insert` operation. */
/** 读取并摊平组合包唯一的 `insert` 操作。 */
function loadRows(): PatchRow[] {
  const patchPath = fileURLToPath(new URL('../cordis.patch.yml', import.meta.url))
  const doc = yaml.load(readFileSync(patchPath, 'utf8')) as PatchOp[]
  return doc.flatMap((op) => op.insert)
}

describe('person-agent-bundle patch', () => {
  const rows = loadRows()

  it('inserts exactly one preset row - the bridge has one shape', () => {
    // 单行：人设与工具常开，不存在第二行、也不存在开关之分。
    // One row: persona and tools always on - no second row, no toggle split.
    expect(rows).toHaveLength(1)
    expect(rows[0]?.name).toBe('@veren/person-agent-preset')
    expect(rows[0]?.config?.presetId).toBe('person-agent')
  })

  it('carries no tool or persona toggles anymore', () => {
    // 三个历史开关必须消失：它们曾把桥梁劈成两种形态。
    // The three historical toggles must be gone: they used to split the
    // bridge into two shapes.
    const config = rows[0]?.config ?? {}
    expect(config).not.toHaveProperty('withWorkspaceTools')
    expect(config).not.toHaveProperty('withSessionTools')
    expect(config).not.toHaveProperty('dispatcher')
  })
})

describe('person-agent-bundle owns the stack\'s only bundle layer', () => {
  // 五个成员目录：与组合包在同一个 plugins/ 工作区里。
  // The five member directories: siblings of the bundle in the plugins/
  // workspace.
  const members = [
    'person-agent-preset',
    'person-agent-dynamic-context',
    'person-agent-reanchor',
    'person-agent-tool-session',
    'person-agent-tool-workspace',
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
      expect(bundle.dependencies?.[manifest.name]).toBeDefined()
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
