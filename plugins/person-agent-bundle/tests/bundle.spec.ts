// Bundle invariant test: default preset keeps maintenance tools off, manager
// preset turns them on. Pure file parsing - concurrency safe, no shared state.
// 组合包不变量测试：默认 preset 维护工具全关，manager preset 开启。
// 纯文件解析，并发安全，无共享状态。
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

const patchPath = fileURLToPath(new URL('../cordis.patch.yml', import.meta.url))

/** Load and flatten the bundle's single `insert` operation. */
/** 读取并摊平组合包唯一的 `insert` 操作。 */
function loadRows(): PatchRow[] {
  const doc = yaml.load(readFileSync(patchPath, 'utf8')) as PatchOp[]
  return doc.flatMap((op) => op.insert)
}

describe('person-agent-bundle patch', () => {
  const rows = loadRows()

  it('inserts exactly two rows of the preset plugin with distinct ids', () => {
    expect(rows).toHaveLength(2)
    expect(new Set(rows.map((r) => r.id)).size).toBe(2)
    for (const row of rows) {
      expect(row.name).toBe('@veren/person-agent-preset')
    }
  })

  it('keeps every maintenance tool off in the default person-agent row', () => {
    const def = rows.find((r) => r.config?.presetId === 'person-agent')
    expect(def).toBeDefined()
    expect(def?.config?.withWorkspaceTools).toBe(false)
    expect(def?.config?.withSessionTools).toBe(false)
  })

  it('turns maintenance tools on only in the opt-in manager row', () => {
    const mgr = rows.find((r) => r.config?.presetId === 'person-agent-manager')
    expect(mgr).toBeDefined()
    expect(mgr?.config?.withWorkspaceTools).toBe(true)
    expect(mgr?.config?.withSessionTools).toBe(true)
  })
})
