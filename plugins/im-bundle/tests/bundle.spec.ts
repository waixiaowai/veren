/**
 * Bundle metadata and patch-shape specs.
 *
 * The most expensive mistake this stack can make is silently installing as a
 * plain dependency: without `dsh.bundle.patch` the Loader never mounts the rows,
 * and IM simply does not exist in the host while the install reports success.
 * These specs pin that declaration, the three member rows, their order, and the
 * testkit's absence from the install closure.
 *
 * 组合包元数据与 patch 形状测试。
 *
 * 本技术栈代价最高的错误是「悄悄装成普通依赖」：缺少 `dsh.bundle.patch` 时 Loader 永远不会
 * 挂载那些行，安装报告成功而宿主里根本没有 IM。这些测试钉住该声明、三行成员行、它们的顺序，
 * 以及 testkit 不在安装闭包里。
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
 * @returns the inserted rows in order.
 */
function insertedRows(): readonly PatchRow[] {
  const text = readFileSync(join(root, 'cordis.patch.yml'), 'utf8')
  const layers = load(text) as readonly PatchLayer[]
  return layers.flatMap(layer => layer.insert ?? [])
}

describe('im bundle metadata', () => {
  it('declares the bundle patch so the Loader mounts its rows', () => {
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      dsh?: { bundle?: { patch?: string } }
    }
    expect(manifest.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
  })

  it('declares the dsh engine window like every member', () => {
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      engines?: { dsh?: string }
    }
    expect(manifest.engines?.dsh).toBe('>=0.2.1-rc.2 <0.3.0')
  })
})

describe('im bundle patch rows', () => {
  it('inserts exactly the three member rows in dependency order', () => {
    const rows = insertedRows()
    expect(rows.map(row => row.id)).toEqual(['im', 'im-wechat', 'im-tool', 'im-ui'])
    expect(rows.map(row => row.name)).toEqual(['@veren/im', '@veren/im-wechat', '@veren/im-tool', '@veren/im-ui'])
  })

  it('inserts no disabled rows: the bundle switches as one', () => {
    for (const row of insertedRows()) expect(row.disabled).toBeUndefined()
  })
})

describe('install closure', () => {
  it('ships exactly the three member plugins as dependencies', () => {
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
    }
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toEqual([
      '@veren/im',
      '@veren/im-tool',
      '@veren/im-ui',
      '@veren/im-wechat',
    ])
  })

  it('never ships the testkit: it is a vitest library, not a plugin', () => {
    const raw = readFileSync(join(root, 'package.json'), 'utf8')
    expect(raw.includes('@veren/im-testkit')).toBe(false)
  })
})
