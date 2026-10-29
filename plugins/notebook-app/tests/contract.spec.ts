/**
 * 无人值守契约达标测试（docs/unattended-page-contract.cn.md §5 矩阵行 5–6）：
 * 记事本两页逐行喂给可复用检查器；变异敏感用例证明"拆 delete 门变红"——
 * 把 delete 的 L2 条款改回无人停摆的旧措辞或摘掉稳定码，检查器必须拒绝。
 * The unattended-contract compliance spec (docs/unattended-page-contract.md §5
 * rows 5–6): both notebook pages fed to the reusable checker; the
 * mutation-sensitivity case proves "removing the delete gate turns red" —
 * reverting the delete clause to the old stall wording or dropping the stable
 * code must be rejected by the checker.
 */
import { describe, expect, it } from 'vitest'
import { assertUnattendedPage } from '@veren/test-support'
import type { ContractPageRow, ContractToolRow } from '@veren/test-support'
import { ListMeta, NoteMeta } from '../src/pages.tsx'

/** 笔记详情页的工具面（两处复用，避免 optional 属性带 undefined 的方差问题）
 * / the note page's tool face (reused twice; dodges the optional-property undefined variance) */
const NOTE_TOOLS: readonly ContractToolRow[] = [
  { name: 'notebook__read_note', level: 'L0' },
  { name: 'notebook__rewrite_note', level: 'L1' },
  { name: 'notebook__delete_note', level: 'L2' },
]

/** 两页矩阵行（§5 行 5–6）/ the two matrix rows (§5 rows 5–6) */
const ROWS: readonly ContractPageRow[] = [
  { label: 'notebook/list', meta: ListMeta, tools: [
    { name: 'notebook__list_notes', level: 'L0' },
    { name: 'notebook__write_note', level: 'L1' },
  ] },
  { label: 'notebook/note', meta: NoteMeta, tools: NOTE_TOOLS },
]

describe('记事本两页无人值守契约（§5 行 5–6）', () => {
  it('逐行达标：契约字段在、级与挂载面一致、delete 的 L2 出路点名稳定码', () => {
    for (const row of ROWS) assertUnattendedPage(row)
  })

  it('delete 门的无人出路在说明句里如实可引用（验收第 5 条的自述引证面）', () => {
    expect(NoteMeta.instructions).toContain('unattended/l2-refused')
    expect(NoteMeta.instructions).toContain('投递指令点名删除')
  })

  it('变异（拆 delete 门：回到无人停摆旧措辞）→ 检查器变红', () => {
    const broken: ContractPageRow = {
      label: 'notebook/note（变异体：delete 门被拆）',
      meta: {
        url: NoteMeta.url,
        description: NoteMeta.description,
        writes: NoteMeta.writes,
        instructions: NoteMeta.instructions,
        unattended: { ...NoteMeta.unattended!, escape: '删除前先向用户确认' },
      },
      tools: NOTE_TOOLS,
    }
    // 双重变红：L2 出路缺稳定码 + L2 级说明句仍受停摆措辞禁令约束（显式再查一次）
    // / red twice: the L2 escape lacks the stable code, and the stall ban still applies when re-run explicitly
    expect(() => assertUnattendedPage(broken)).toThrow(/unattended\//)
    expect(broken.meta.instructions).toContain('delete_note 永久删除')
  })
})
