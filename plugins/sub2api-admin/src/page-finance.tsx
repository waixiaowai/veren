/** @jsxRuntime automatic @jsxImportSource @veren/prompt-core */
/**
 * 资金管理页（订单 + 套餐）：收入汇总、订单列表（前 20）与订阅套餐列表经
 * store 首屏同步；payment 工具承担全部读写，退款与删套餐是 L2（无人值守被拒）。
 * The finance page (orders + plans): the revenue summary, the orders list
 * (first 20), and the subscription-plans list sync via the store's first
 * screen; the payment tool carries every read/write, refunds and plan deletion
 * are L2 (refused unattended).
 *
 * @module @veren/sub2api-admin/page-finance
 */
import type { ComponentPageMeta, PageFC } from '@veren/prompt-page'
import { readState, registerTools, rowsOf, URL_PREFIX } from './page-runtime.ts'

export const FinancePage: PageFC = (_props, agent) => {
  registerTools(agent, ['payment', 'overview'])
  const state = readState()
  const orders = rowsOf(state.finance?.orders ?? []).slice(0, 20)
  const plans = rowsOf(state.finance?.plans ?? [])
  return (
    <>
      <h1>Sub2API 运营 · 资金管理</h1>
      <p>收入汇总：{String((state.home?.payment as unknown | undefined) ?? '-')}</p>
      {state.error === undefined ? null : <blockquote>store.error：{String(state.error)}</blockquote>}
      <h2>订单（前 20）：</h2>
      <ul>{orders.map((row) => <li key={row.id}>{JSON.stringify(row)}</li>)}</ul>
      <h2>订阅套餐：</h2>
      <ul>{plans.map((row) => <li key={row.id}>{JSON.stringify(row)}</li>)}</ul>
    </>
  )
}

export const FinanceMeta: ComponentPageMeta = {
  name: 'finance',
  url: `${URL_PREFIX}/finance`,
  description: '资金管理页：支付订单列表 + 订阅套餐列表 + 收入汇总',
  writes: true,
  unattended: {
    serves: '订单排查/异常单处理/套餐维护类投递任务与盘面问询',
    level: 'L2',
    evidence: '一句话点名订单/套餐 id 与状态前后值（工具返回值）',
    escape: '退款（order_refund）与删套餐（plan_delete）无人值守被工具拒绝（unattended/l2-refused）——改走 order_cancel/order_retry 等可逆替代或如实转述用户，绝不重试',
  },
  instructions: '订单经 orders 列表、套餐经 plans 列表同步，收入汇总经 payment.summary 同步。'
    + '用 payment 工具：dashboard 看收入；orders 查单；order_cancel/order_retry 处理异常单（L1 自主执行）；'
    + 'plan_create/plan_update 维护套餐（L1 自主执行）；order_refund 退款与 plan_delete 删套餐是 L2——'
    + '本回合没有人类消息时会被工具以 unattended/l2-refused 拒绝，此时不要重试，改走可逆替代或如实转述用户。'
    + '本页也挂了 overview 工具：正文顶部的收入汇总来自首页支付切片，过期时用 overview 刷新。'
    + '写成功后用一句话点名订单/套餐 id 与状态前后值回报。',
  instanceTitle: () => 'Sub2API 运营 · 资金管理',
}
