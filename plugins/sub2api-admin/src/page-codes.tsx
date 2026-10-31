/** @jsxRuntime automatic @jsxImportSource @veren/prompt-core */
/**
 * 卡密页（兑换码 + 优惠码）：兑换统计、兑换码列表（前 20）与优惠码列表
 * （前 20）经 store 首屏同步；删除类动作是 L2（无人值守被拒），expire 是可逆
 * 替代的软过期。
 * The codes page (redeem + promo): the redeem statistics, the redeem-code list
 * (first 20), and the promo-code list (first 20) sync via the store's first
 * screen; deletions are L2 (refused unattended) and expire is the reversible
 * soft-expiry alternative.
 *
 * @module @veren/sub2api-admin/page-codes
 */
import type { ComponentPageMeta, PageFC } from '@veren/prompt-page'
import { readState, registerTools, rowsOf, URL_PREFIX } from './page-runtime.ts'

export const CodesPage: PageFC = (_props, agent) => {
  registerTools(agent, ['redeem_codes', 'promo_codes'])
  const state = readState()
  const redeem = rowsOf(state.codes?.redeem ?? []).slice(0, 20)
  const promo = rowsOf(state.codes?.promo ?? []).slice(0, 20)
  return (
    <>
      <h1>Sub2API 运营 · 卡密（兑换码 + 优惠码）</h1>
      <p>兑换统计：{String((state.codes?.redeemStats as unknown | undefined) ?? '-')}</p>
      {state.error === undefined ? null : <blockquote>store.error：{String(state.error)}</blockquote>}
      <h2>兑换码（前 20）：</h2>
      <ul>{redeem.map((row) => <li key={row.id}>{JSON.stringify(row)}</li>)}</ul>
      <h2>优惠码（前 20）：</h2>
      <ul>{promo.map((row) => <li key={row.id}>{JSON.stringify(row)}</li>)}</ul>
    </>
  )
}

export const CodesMeta: ComponentPageMeta = {
  name: 'codes',
  url: `${URL_PREFIX}/codes`,
  description: '卡密页：兑换码（生成/核销/过期/删除）+ 优惠码（创建/编辑/删除/用例）+ 兑换统计',
  writes: true,
  unattended: {
    serves: '兑换码生成/过期、优惠码维护类投递任务与盘面问询',
    level: 'L2',
    evidence: '一句话点名码 id/批次与状态前后值（工具返回值）',
    escape: '删除类（delete/batch_delete）无人值守被工具拒绝（unattended/l2-refused）——改走 expire（可逆的软过期）或如实转述用户，绝不重试',
  },
  instructions: '兑换码经 redeem 列表、统计经 redeem_stats、优惠码经 promo 列表同步。'
    + '用 redeem_codes 工具生成/核销/过期清理（支付流传 idempotency_key；expire 是可逆替代的软过期，L1 自主执行）；'
    + '用 promo_codes 工具维护优惠码（usages 看核销；create/update L1 自主执行）。'
    + '删除类（redeem_codes delete/batch_delete、promo_codes delete）是 L2——本回合没有人类消息时会被工具以 '
    + 'unattended/l2-refused 拒绝，此时不要重试，改走 expire 或如实转述用户。'
    + '写成功后用一句话点名码 id/批次与状态回报。',
  instanceTitle: () => 'Sub2API 运营 · 卡密',
}
