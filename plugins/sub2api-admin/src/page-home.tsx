/** @jsxRuntime automatic @jsxImportSource @veren/prompt-core */
/**
 * 首页 · 运营指挥台（只读）：核心经营指标经 store 首屏同步，正文带待办指引
 * 与操作指引；本页不执行写操作，具体操作去对应页面。指标渲染与指引文案拆在
 * 本文件的两个小组件里，HomePage 只做组装。
 * The home page · the ops console (read-only): core operating metrics sync via
 * the store's first screen; the body carries the to-do signals and the action
 * guide; this page performs no writes — actual operations belong to their
 * pages. Metric rendering and the guidance copy live in this file's two small
 * components; HomePage only assembles them.
 *
 * @module @veren/sub2api-admin/page-home
 */
import type { ComponentPageMeta, PageFC } from '@veren/prompt-page'
import type { Sub2ApiState } from './store.ts'
import { readState, registerTools, URL_PREFIX } from './page-runtime.ts'

/** 大盘点位（空值显示 -）/ one dashboard scalar (dash when absent) */
const num = (value: unknown): unknown => value ?? '-'

/** 十四项经营指标列表（每行一个标量）/ the fourteen operating metrics (one scalar per row) */
function HomeMetrics({ state }: { state: Sub2ApiState }) {
  const stats = state.home?.stats ?? {}
  const payment = state.home?.payment ?? {}
  const cost = Number(stats.today_actual_cost ?? 0)
  const revenue = Number((payment.today_amount as { amount?: number } | undefined)?.amount ?? 0)
  return (
    <ul>
      <li>收入今日：{String((payment.today_amount as unknown | undefined) ?? '-')}</li>
      <li>收入累计：{String((payment.total_amount as unknown | undefined) ?? '-')}</li>
      <li>成本今日：{num(stats.today_actual_cost)}</li>
      <li>成本累计：{num(stats.total_actual_cost)}</li>
      <li>今日毛利：{revenue - cost}</li>
      <li>活跃用户：{num(stats.active_users ?? stats.hourly_active_users)}</li>
      <li>今日新增：{num(stats.today_new_users)}</li>
      <li>总用户：{num(stats.total_users)}</li>
      <li>今日请求：{num(stats.today_requests)}</li>
      <li>今日 tokens：{num(stats.today_tokens)}</li>
      <li>待处理订单：{num(payment.pending_orders)}</li>
      <li>异常账号：{num(stats.error_accounts)}</li>
      <li>限流账号：{num(stats.ratelimit_accounts)}</li>
      <li>过载账号：{num(stats.overload_accounts)}</li>
    </ul>
  )
}

/** 待办信号与操作指引（逐字保持原文案）/ the to-do signals and the action guide (copy verbatim) */
function HomeGuidance() {
  return (
    <blockquote>
      {'待办指引：异常账号>0 → accounts 页 clear_error/set_status；待处理订单>0 → finance 页 payment orders；账号不可用 → channels/groups 页查配置。'}
      {'AI 操作指引：充值=users balance；封禁=users update {"status":"banned"}；生成兑换码=redeem_codes generate；创建优惠码=promo_codes create；开通订阅=subscriptions assign；新建渠道=channels create；调整倍率=groups set_rates。'}
      {'读写与常规运营写自主执行，完成后用一句话点名产物回报；退款/删套餐/删码（L2）无人值守会被工具拒绝（unattended/l2-refused），改走可逆替代或如实转述用户。'}
    </blockquote>
  )
}

/** 首页组件体：登记 overview 工具，正文直读 store 当前状态（一次性渲染）*/
export const HomePage: PageFC = (_props, agent) => {
  registerTools(agent, ['overview'])
  const state = readState()
  return (
    <>
      <h1>Sub2API 运营指挥台 · 首页</h1>
      <HomeMetrics state={state} />
      <HomeGuidance />
      {state.error === undefined ? null : <blockquote>store.error：{String(state.error)}</blockquote>}
    </>
  )
}

export const HomeMeta: ComponentPageMeta = {
  name: 'home',
  url: `${URL_PREFIX}/home`,
  description: 'Sub2API 运营指挥台：核心经营指标（收入/成本/毛利/活跃/新增/今日消耗）+ 待办信号 + 操作指引',
  unattended: {
    serves: '经营盘面问询与"该去哪页办什么事"的派发入口（本页只读，不办事）',
    level: 'L0',
    evidence: 'read-only',
    escape: 'none-needed',
  },
  instructions: '这是运营指挥台（首页，只读）。指标经正文同步：'
    + '收入/成本/毛利/活跃/新增/总用户/今日请求/tokens/待处理订单/异常/限流/过载账号。'
    + '数据过期用 overview 工具刷新；本页不执行写操作——具体操作去对应页面：'
    + '渠道管理 /apps/sub2api-admin/channels（工具 channels）；分组与倍率 /apps/sub2api-admin/groups（groups）；'
    + '用户与充值 /apps/sub2api-admin/users（users）；订阅 /apps/sub2api-admin/subscriptions（subscriptions）；'
    + '订单与套餐 /apps/sub2api-admin/finance（payment）；兑换码与优惠码 /apps/sub2api-admin/codes（redeem_codes / promo_codes）；'
    + '账号 /apps/sub2api-admin/accounts（accounts）；用量 /apps/sub2api-admin/usage（usage）。'
    + '常见操作：给用户充值→users balance；封禁→users update {"status":"banned"}；生成兑换码→redeem_codes generate；'
    + '创建优惠码→promo_codes create；开通订阅→subscriptions assign；新建渠道→channels create；调整倍率→groups set_rates。'
    + '各页读写与常规运营写自主执行并带证据回报；退款/删套餐/删码（L2）无人值守会被拒绝（unattended/l2-refused）。',
  instanceTitle: () => 'Sub2API 运营指挥台',
}
