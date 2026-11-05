/**
 * Bundle metadata and patch-shape specs.
 *
 * The most expensive mistake this stack can make is silently installing as a
 * plain dependency: without `dsh.bundle.patch` the Loader never mounts the
 * rows, and notifications simply do not exist in the host while the install
 * reports success. These specs pin that declaration, the three member rows,
 * their order, and every member's dependency.
 *
 * 组合包元数据与 patch 形状测试。
 *
 * 本技术栈代价最高的错误是「悄悄装成普通依赖」：缺少 `dsh.bundle.patch` 时 Loader 永远不会
 * 挂载那些行，安装报告成功而宿主里根本没有通知能力。这些测试钉住该声明、三行成员行、它们的
 * 顺序，以及每个成员的依赖。
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

/** One package manifest, narrowed to the fields these specs read. */
interface Manifest {
  readonly name?: string
  readonly engines?: { readonly dsh?: string }
  readonly dsh?: { readonly bundle?: { readonly patch?: string } }
  readonly dependencies?: Readonly<Record<string, string>>
}

/**
 * Read and parse the bundle's own patch.
 * @returns the inserted rows in order.
 */
function insertedRows(): readonly PatchRow[] {
  const text = readFileSync(join(root, 'cordis.patch.yml'), 'utf8')
  const layers = load(text) as readonly PatchLayer[]
  return layers.flatMap(layer => layer.insert ?? [])
}

/** The bundle's own manifest. */
function bundleManifest(): Manifest {
  return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as Manifest
}

/** One member's manifest, read through the workspace link. */
function memberManifest(name: string): Manifest {
  return JSON.parse(readFileSync(join(root, `node_modules/${name}/package.json`), 'utf8')) as Manifest
}

describe('mail bundle metadata', () => {
  it('declares the bundle patch so the Loader mounts its rows', () => {
    expect(bundleManifest().dsh?.bundle?.patch).toBe('./cordis.patch.yml')
  })

  it('declares the dsh engine window like every member', () => {
    expect(bundleManifest().engines?.dsh).toBe('>=0.2.1-rc.2 <0.3.0')
  })

  it('inserts exactly the three member rows, in dependency order', () => {
    const rows = insertedRows()
    expect(rows.map(row => row.id)).toEqual(['mail', 'mail-tool', 'mail-ui'])
    expect(rows.map(row => row.name)).toEqual(['@veren/mail', '@veren/mail-tool', '@veren/mail-ui'])
  })

  it('depends on every member it inserts', () => {
    const dependencies = bundleManifest().dependencies ?? {}
    for (const row of insertedRows()) {
      expect(dependencies[row.name ?? '']).toBe('workspace:^')
    }
  })

  it('keeps every member inside the same dsh engine window', () => {
    for (const row of insertedRows()) {
      expect(memberManifest(row.name ?? '').engines?.dsh).toBe('>=0.2.1-rc.2 <0.3.0')
    }
  })

  it('never disables a member row in the shipped patch', () => {
    for (const row of insertedRows()) {
      expect(row.disabled).toBeUndefined()
    }
  })
})
