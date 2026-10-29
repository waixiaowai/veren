/**
 * 无人值守契约达标测试（docs/unattended-page-contract.cn.md §5 矩阵行 1–2）：
 * forum 是全自主达标的参照实现——两页逐行喂给可复用检查器；变异敏感用例证明
 * "给 forum 加一刀切确认门变红"（stall 措辞禁令拦截）。
 * The unattended-contract compliance spec (docs/unattended-page-contract.md §5
 * rows 1–2): forum is the fully autonomous reference — both pages fed to the
 * reusable checker; the mutation case proves "adding a blanket confirmation
 * gate to forum turns red" (the stall-wording ban intercepts).
 */
import { describe, expect, it } from 'vitest'
import { assertNoUnattendedStall, assertUnattendedPage } from '@veren/test-support'
import type { ContractPageRow, ContractToolRow } from '@veren/test-support'
import { CatalogMeta, PostMeta } from '../src/pages.tsx'

/** 投递回报面（两页同挂：task_take/task_complete/task_fail，页面作用域同名词汇）
 * / the delivery-report face (on both pages: page-scoped, same vocabulary as the global face) */
const PAGE_TASK_TOOLS: readonly ContractToolRow[] = [
  { name: 'task_take', level: 'L1' },
  { name: 'task_complete', level: 'L1' },
  { name: 'task_fail', level: 'L1' },
]

/** 两页矩阵行（§5 行 1–2）/ the two matrix rows (§5 rows 1–2) */
const ROWS: readonly ContractPageRow[] = [
  { label: 'forum/catalog', meta: CatalogMeta, tools: [
    { name: 'forum__list', level: 'L0' },
    { name: 'forum__post', level: 'L1' },
    { name: 'forum__inbox', level: 'L0' },
    ...PAGE_TASK_TOOLS,
  ] },
  { label: 'forum/post', meta: PostMeta, tools: [
    { name: 'forum__read', level: 'L0' },
    { name: 'forum__comment', level: 'L1' },
    { name: 'forum__vote', level: 'L1' },
    { name: 'forum__inbox', level: 'L0' },
    ...PAGE_TASK_TOOLS,
  ] },
]

describe('论坛两页无人值守契约（§5 行 1–2，达标参照）', () => {
  it('逐行达标：契约字段在、级与挂载面一致、无停摆措辞', () => {
    for (const row of ROWS) assertUnattendedPage(row)
  })

  it('变异（加一刀切确认门）→ 停摆措辞禁令变红', () => {
    expect(() => assertNoUnattendedStall('forum/catalog（变异体）',
      CatalogMeta.instructions! + '所有写入前先向用户确认。')).toThrow(/停摆措辞/)
    expect(() => assertNoUnattendedStall('forum/post（变异体）',
      PostMeta.instructions!.replace('以你自己的预设名义对主题或评论投 up/down', '写前先向用户确认，再投票')))
      .toThrow(/停摆措辞/)
  })
})
