/**
 * 无人值守契约达标测试（docs/unattended-page-contract.cn.md §5 矩阵行 3–4）：
 * person-agent 是派发结算范本——两页逐行喂给可复用检查器；变异敏感用例证明
 * "挂载工具级超出页面级上限"与"停摆措辞"都会变红。
 * The unattended-contract compliance spec (docs/unattended-page-contract.md §5
 * rows 3–4): person-agent is the dispatch-settlement template — both pages fed
 * to the reusable checker; mutation cases prove both an over-level tool face
 * and stall wording turn red.
 */
import { describe, expect, it } from 'vitest'
import { assertNoUnattendedStall, assertUnattendedPage } from '@veren/test-support'
import type { ContractPageRow, ContractToolRow } from '@veren/test-support'
import { OverviewMeta, WorkspacesMeta } from '../src/pages.tsx'

/** 概览页十件工具的面 / the overview page's ten-tool face */
const OVERVIEW_TOOLS: readonly ContractToolRow[] = [
  { name: 'person_agent__workspace_session_list', level: 'L0' },
  { name: 'person_agent__session_create', level: 'L1' },
  { name: 'person_agent__session_rename', level: 'L1' },
  { name: 'person_agent__session_archive', level: 'L1' },
  { name: 'person_agent__session_unarchive', level: 'L1' },
  { name: 'person_agent__session_pin', level: 'L1' },
  { name: 'person_agent__session_unpin', level: 'L1' },
  { name: 'person_agent__workspace_create', level: 'L1' },
  { name: 'person_agent__workspace_rename', level: 'L1' },
  { name: 'person_agent__session_dispatch', level: 'L1' },
]

/** 两页矩阵行（§5 行 3–4）/ the two matrix rows (§5 rows 3–4) */
const ROWS: readonly ContractPageRow[] = [
  { label: 'person-agent/overview', meta: OverviewMeta, tools: OVERVIEW_TOOLS },
  { label: 'person-agent/workspaces', meta: WorkspacesMeta, tools: [
    { name: 'person_agent__workspace_session_list', level: 'L0' },
    { name: 'person_agent__session_create', level: 'L1' },
    { name: 'person_agent__workspace_create', level: 'L1' },
    { name: 'person_agent__workspace_rename', level: 'L1' },
  ] },
]

describe('person-agent 两页无人值守契约（§5 行 3–4，派发结算范本）', () => {
  it('逐行达标：契约字段在、级与挂载面一致、无停摆措辞', () => {
    for (const row of ROWS) assertUnattendedPage(row)
  })

  it('变异（挂载工具级超出页面级上限）→ 交叉核对变红', () => {
    // 页面降级成 L0 后，L1 工具超限 + 漏 writes 双双触发
    // / after demoting the page to L0, both the over-level tools and the missing writes fire
    const demoted: ContractPageRow = {
      label: 'person-agent/overview（变异体：把派发谎报成 L0）',
      meta: { ...OverviewMeta, writes: undefined, unattended: { ...OverviewMeta.unattended!, level: 'L0' } },
      tools: OVERVIEW_TOOLS,
    }
    expect(() => assertUnattendedPage(demoted)).toThrow()
  })

  it('变异（加停摆措辞）→ 禁令变红', () => {
    expect(() => assertNoUnattendedStall('person-agent/overview（变异体）',
      OverviewMeta.instructions! + '派发前先向用户确认。')).toThrow(/停摆措辞/)
  })
})
