// Bundle invariant test: one preset row, the bridge shape - delegating persona
// and both maintenance tool families always on, no toggles left.
// Pure file parsing - concurrency safe, no shared state.
// 组合包不变量测试：单条预设行、桥梁形态——派活人设与两类维护工具常开，
// 不再有任何开关。纯文件解析，并发安全，无共享状态。
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
