/**
 * Bundle metadata and patch-shape specs.
 *
 * The most expensive mistake this stack can make is silently installing as a
 * plain dependency: without `dsh.bundle.patch` the Loader never mounts the rows,
 * and the forum simply does not exist in the GUI while the install reports
 * success. These specs pin that declaration, the two member rows, and the order
 * they must be inserted in.
 *
 * 组合包元数据与 patch 形状测试。
 *
 * 本技术栈代价最高的错误是「悄悄装成普通依赖」：缺少 `dsh.bundle.patch` 时 Loader 永远不会
 * 挂载那些行，安装报告成功而 GUI 里根本没有论坛。这些测试钉住该声明、两条成员行，以及它们
 * 必须的插入顺序。
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { load } from 'js-yaml'
import { describe, expect, it } from 'vitest'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/** One loader row as a patch declares it. */
interface PatchRow {
  readonly id?: string
  readonly name?: string
  readonly disabled?: unknown
}

/** One patch layer. */
interface PatchLayer {
  readonly insert?: readonly PatchRow[]
}

/**
 * Read and parse the bundle's own patch.
 * @returns the first layer's inserted rows.
 */
function insertedRows(): readonly PatchRow[] {
  const text = readFileSync(join(root, 'cordis.patch.yml'), 'utf8')
  const layers = load(text) as readonly PatchLayer[]
  return layers.flatMap(layer => layer.insert ?? [])
}

describe('forum bundle metadata', () => {
  it('declares the bundle patch so the Loader mounts its rows', () => {
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      dsh?: { bundle?: { patch?: string } }
      files?: readonly string[]
    }
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    // The patch must also ship: a declared file the package does not publish is
    // the same failure one step later.
    expect(manifest.files).toContain('cordis.patch.yml')
  })

  it('inserts the app framework before the Host, and the Host before the Web page', () => {
    expect(insertedRows().map(row => row.id)).toEqual([
      'app-registry', 'page-registry', 'app-host', 'forum', 'forum-ui',
    ])
  })

  it('names the member packages that the bundle depends on', () => {
    expect(insertedRows().map(row => row.name)).toEqual([
      '@veren/app-registry', '@veren/page-registry', '@veren/app-host', '@veren/forum', '@veren/forum-ui',
    ])
  })

  it('leaves every inserted row enabled', () => {
    for (const row of insertedRows()) expect(row.disabled).toBeUndefined()
  })

  it('declares every inserted row as a runtime dependency', () => {
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      dependencies?: Readonly<Record<string, string>>
    }
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toEqual([
      '@veren/app-host', '@veren/app-registry', '@veren/forum', '@veren/forum-ui', '@veren/page-registry',
    ])
  })
})
