/**
 * 无人值守契约达标测试（docs/unattended-page-contract.cn.md §5 矩阵行 7–15）：
 * 九页逐行喂给可复用检查器 assertUnattendedPage；变异敏感用例证明检查器
 * 双向有效——加停摆措辞变红、漏 writes 变红、L2 出路缺稳定码变红。
 * The unattended-contract compliance spec (docs/unattended-page-contract.md §5
 * rows 7–15): the nine pages fed row by row to the reusable checker
 * assertUnattendedPage; mutation-sensitivity cases prove the checker works in
 * both directions — stall wording, a missing writes, an L2 escape without the
 * stable code all turn red.
 */
import { describe, expect, it } from 'vitest'
import { assertNoUnattendedStall, assertUnattendedPage } from '@veren/test-support'
import type { ContractPageRow } from '@veren/test-support'
import { FinanceMeta, CodesMeta, HomeMeta, UsageMeta, AccountsMeta, ChannelsMeta, GroupsMeta, SubscriptionsMeta, UsersMeta } from '../src/pages.tsx'

/** 九页矩阵行（§5 行 7–15；工具级 = 该工具动作级上限）/ the nine matrix rows (§5 rows 7–15; tool level = the tool's action ceiling) */
const ROWS: readonly ContractPageRow[] = [
  { label: 'sub2api/home', meta: HomeMeta, tools: [{ name: 'sub2api_admin__overview', level: 'L0' }] },
  { label: 'sub2api/channels', meta: ChannelsMeta, tools: [
    { name: 'sub2api_admin__channels', level: 'L1' },
    { name: 'sub2api_admin__request', level: 'L1' },
  ] },
  { label: 'sub2api/groups', meta: GroupsMeta, tools: [{ name: 'sub2api_admin__groups', level: 'L1' }] },
  { label: 'sub2api/users', meta: UsersMeta, tools: [{ name: 'sub2api_admin__users', level: 'L1' }] },
  { label: 'sub2api/subscriptions', meta: SubscriptionsMeta, tools: [{ name: 'sub2api_admin__subscriptions', level: 'L1' }] },
  { label: 'sub2api/finance', meta: FinanceMeta, tools: [
    { name: 'sub2api_admin__payment', level: 'L2' },
    { name: 'sub2api_admin__overview', level: 'L0' },
  ] },
  { label: 'sub2api/codes', meta: CodesMeta, tools: [
    { name: 'sub2api_admin__redeem_codes', level: 'L2' },
    { name: 'sub2api_admin__promo_codes', level: 'L2' },
  ] },
  { label: 'sub2api/accounts', meta: AccountsMeta, tools: [{ name: 'sub2api_admin__accounts', level: 'L1' }] },
  { label: 'sub2api/usage', meta: UsageMeta, tools: [{ name: 'sub2api_admin__usage', level: 'L0' }] },
]

describe('九页无人值守契约（§5 行 7–15）', () => {
  it('逐行达标：契约字段在、级与挂载面一致、L2 出路点名稳定码', () => {
    for (const row of ROWS) expect(() => assertUnattendedPage(row)).toBeDefined()
    for (const row of ROWS) assertUnattendedPage(row)
  })

  it('L0 页（home/usage）没有写意图声明', () => {
    expect(HomeMeta.writes).toBeUndefined()
    expect(UsageMeta.writes).toBeUndefined()
  })

  it('变异（给 L1 页加一刀切确认门）→ 停摆措辞禁令变红', () => {
    expect(() => assertNoUnattendedStall('sub2api/channels（变异体）',
      ChannelsMeta.instructions! + '所有写入前先向用户确认。')).toThrow(/停摆措辞/)
  })

  it('变异（漏 writes 声明）→ 交叉核对变红', () => {
    const broken: ContractPageRow = {
      label: 'sub2api/accounts（变异体：漏 writes）',
      meta: { ...AccountsMeta, writes: undefined },
      tools: [{ name: 'sub2api_admin__accounts', level: 'L1' }],
    }
    expect(() => assertUnattendedPage(broken)).toThrow(/writes/)
  })

  it('变异（L2 出路缺稳定码）→ 出路检查变红', () => {
    const broken: ContractPageRow = {
      label: 'sub2api/finance（变异体：出路没有稳定码）',
      meta: { ...FinanceMeta, unattended: { ...FinanceMeta.unattended!, escape: '做不了就问用户' } },
      tools: [{ name: 'sub2api_admin__payment', level: 'L2' }],
    }
    expect(() => assertUnattendedPage(broken)).toThrow(/unattended\//)
  })
})
