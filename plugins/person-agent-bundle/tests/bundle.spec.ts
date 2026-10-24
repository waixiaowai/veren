// Bundle invariant tests. Two invariants, both pure file parsing:
// 1. Composition shape: exactly one app row - the app IS the whole stack (the
//    bridge persona, the page-scoped tools and the renhua skill live inside the
//    app's page sessions). No preset row, no toggles.
// 2. Bundle ownership: the bundle is the stack's ONLY profile layer - its
//    manifest declares exactly one patch file, depends on the application
//    framework bundle (@veren/app-host-bundle brings the framework rows) and
//    the app, while no member declares `dsh.bundle.patch`. This is what keeps
//    `dsh plugin` reconciliation from activating a second, duplicate layer on
//    install.
// Concurrency safe: read-only, no shared state.
// 组合包不变量测试。两个不变量，均为纯文件解析：
// 1. 组合形态：单条应用行——应用即整栈（桥梁人设、页面级工具与 renhua 技能
//    都活在应用的页面会话里）。没有预设行，也没有任何开关。
// 2. bundle 归属：组合包是技术栈唯一的 profile 层——自身 manifest 只声明一个
//    patch 文件，依赖应用框架组合包（@veren/app-host-bundle 带入框架行）与
//    应用本身，而任何成员都不得声明 `dsh.bundle.patch`。这保证 `dsh plugin`
//    的 reconciliation 在安装时不会激活第二个重复层。
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
  peerDependencies?: Record<string, string>
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

  it('inserts exactly one app row - the app is the whole stack', () => {
    // 应用行只有一条且零配置：工具面常量就近写在组件体里，行上没有可配的东西。
    // 人设、工具与技能都活在应用的页面会话里，不存在第二行、也不存在开关之分。
    // 预设行已随纯应用栈退役。
    // One app row with zero config: the tool-face constants live right in the
    // component bodies, so the row itself carries nothing configurable. The
    // persona, tools and the skill all live in the app's page sessions - no
    // second row, no toggle split. The preset row is retired with the
    // app-only stack.
    expect(rows).toHaveLength(1)
    expect(rows[0]?.name).toBe('@veren/person-agent-app')
    expect(rows[0]?.config).toBeUndefined()
  })

  it('carries no preset row and no toggles anymore', () => {
    // 历史形态必须消失：preset 行与三个历史开关都不再出现。
    // The historical shape must be gone: no preset row, none of the three
    // historical toggles.
    const config = rows[0]?.config ?? {}
    expect(config).not.toHaveProperty('presetId')
    expect(config).not.toHaveProperty('withWorkspaceTools')
    expect(config).not.toHaveProperty('withSessionTools')
    expect(config).not.toHaveProperty('dispatcher')
  })
})

describe('person-agent-bundle owns the stack\'s only bundle layer', () => {
  // 成员目录：与组合包在同一个 plugins/ 工作区里。框架由
  // @veren/app-host-bundle 依赖带入，不在成员清单里重复。
  // The member directories: siblings of the bundle in the plugins/ workspace.
  // The framework rides in through the @veren/app-host-bundle dependency and
  // is deliberately absent here.
  const members = [
    'person-agent-app',
    'person-agent-tool-session',
    'person-agent-tool-workspace',
  ]
  const bundle = JSON.parse(
    readFileSync(bundleManifestPath, 'utf8'),
  ) as PackageManifest

  it('declares exactly one patch file and depends on the framework bundle and the app', () => {
    // 唯一 patch 文件 + 框架组合包与应用两个直接依赖：安装组合包即安装整栈。
    // 工具构建器包不经组合包直接依赖——它们随应用传递；这里顺带锁住这条链。
    // One patch file plus the two direct dependencies (framework bundle + app):
    // installing the bundle installs the whole stack. The tool builder packages
    // are NOT direct bundle dependencies — they ride through the app; the chain
    // is locked here too.
    expect(bundle.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    expect(bundle.dependencies?.['@veren/app-host-bundle']).toBeDefined()
    const app = readMemberManifest('person-agent-app')
    expect(bundle.dependencies?.[app.name]).toBeDefined()
    for (const tool of ['person-agent-tool-session', 'person-agent-tool-workspace']) {
      const manifest = readMemberManifest(tool)
      // 工具构建器包被应用运行时 import（页面组件体直登构建器），必须声明成
      // dependencies 才会随 bundle → app 链真实安装；挂 peer 在 pnpm v10（默认
      // 不自动装 peer）下会装出孤儿，应用模块加载即失败。这里锁住这条安装链。
      // The tool builder packages are runtime-imported by the app (page bodies
      // register the builders directly), so they must be dependencies for the
      // bundle → app → tools chain to actually install; a peer leaves them
      // orphaned under pnpm v10 (peers are not auto-installed) and the app
      // module then fails to load. The install chain is locked here.
      expect(app.dependencies?.[manifest.name]).toBeDefined()
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
