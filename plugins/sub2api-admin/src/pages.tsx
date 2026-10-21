/** @jsxRuntime automatic @jsxImportSource @veren/prompt-core */
/**
 * 应用的九个页面：指挥台 / 渠道 / 分组 / 用户 / 订阅 / 资金 / 卡密 / 账号 / 用量。
 * The app's nine pages: home / channels / groups / users / subscriptions /
 * finance / codes / accounts / usage via defineAppPage.
 *
 * 页面树是 store 快照的纯投影；工具写入成功后 store 刷新，树经 SNAPSHOT/PATCH
 * 同步进页面会话。首页是指挥台：经营指标 + 待办 + AI/人操作指引。
 * Each tree is a pure projection of the store snapshot. The home page is the
 * ops console: business metrics + todo signals + next-step guidance for AI & human.
 * @module @veren/sub2api-admin/pages
 */
import { Data, Keyed, Static, defineAppPage } from '@veren/prompt-page'
import type { PageDefinition } from '@veren/prompt-page'
import type { Sub2ApiState } from './store.ts'

/** 应用 id（页面 URL 前缀的权威来源）/ the app id (authority of the url prefix) */
export const APP_ID = 'sub2api-admin'
/** 应用内 URL 前缀 / the app-scoped url prefix */
const URL_PREFIX = `/apps/${APP_ID}`

/** Keyed 条目：id 必须是字符串 / keyed rows carry string ids */
type Row = Record<string, unknown> & { id: string }

/** 把无 id 的原始行投影成 Keyed 条目（index 兜底 id）/ project raw rows into keyed rows */
function rowsOf(raw: readonly Record<string, unknown>[]): Row[] {
  return raw.map((row, index) => ({ ...row, id: String(row.id ?? index) }))
}

/** 大盘点位（空值显示 -）/ one dashboard scalar (dash when absent) */
const num = (value: unknown): unknown => value ?? '-'

/** 通用列表页构造：标题 + 错误位 + 一个 Keyed 列表 / generic list page: header + error + one keyed list */
function listPage(config: {
  name: string
  url: string
  description: string
  title: string
  instructions: string
  tools: readonly string[]
  path: string
  pick: (state: Sub2ApiState) => readonly Record<string, unknown>[]
}): PageDefinition<Sub2ApiState> {
  return defineAppPage<Sub2ApiState>({
    name: config.name,
    url: config.url,
    description: config.description,
    tools: [...config.tools],
    instructions: config.instructions,
    instanceTitle: () => config.title,
    tree: (_params, state) => (
      <>
        <Static content={config.title} />
        <Static content={`页面入口：${config.url}；配套工具：sub2api_admin__${config.tools[0]}`} />
        {state.error === undefined ? null : <Data path="store.error" value={state.error} />}
        <Keyed path={config.path} items={rowsOf([...config.pick(state)])} />
      </>
    ),
  })
}

// ---- 首页 · 运营指挥台 / Home · the ops console ----

export const homePage: PageDefinition<Sub2ApiState> = defineAppPage<Sub2ApiState>({
  name: 'home',
  url: `${URL_PREFIX}/home`,
  description: 'Sub2API 运营指挥台：核心经营指标（收入/成本/毛利/活跃/新增/今日消耗）+ 待办信号 + 操作指引',
  tools: ['overview'],
  instructions: '这是运营指挥台（首页）。指标经 data 节点同步：'
    + 'metrics.revenue_today / metrics.revenue_total / metrics.cost_today / metrics.cost_total / metrics.gross_today / '
    + 'metrics.active_users / metrics.new_users_today / metrics.total_users / metrics.today_requests / metrics.today_tokens / '
    + 'metrics.pending_orders / metrics.error_accounts / metrics.ratelimit_accounts / metrics.overload_accounts。'
    + '数据过期用 overview 工具刷新。具体操作去对应页面：'
    + '渠道管理 /apps/sub2api-admin/channels（工具 channels）；分组与倍率 /apps/sub2api-admin/groups（groups）；'
    + '用户与充值 /apps/sub2api-admin/users（users）；订阅 /apps/sub2api-admin/subscriptions（subscriptions）；'
    + '订单与套餐 /apps/sub2api-admin/finance（payment）；兑换码与优惠码 /apps/sub2api-admin/codes（redeem_codes / promo_codes）；'
    + '账号 /apps/sub2api-admin/accounts（accounts）；用量 /apps/sub2api-admin/usage（usage）。'
    + '常见操作：给用户充值→users balance；封禁→users update {"status":"banned"}；生成兑换码→redeem_codes generate；'
    + '创建优惠码→promo_codes create；开通订阅→subscriptions assign；新建渠道→channels create；调整倍率→groups set_rates。'
    + '所有写入前先向用户确认。',
  instanceTitle: () => 'Sub2API 运营指挥台',
  // §3.10.5 规则 1：一级页必须携带能力地图（本应用无 :param 详情页，
  // 地图列的是各工具页与"什么时候去"）。
  // §3.10.5 rule 1: the home page must carry a capability map (this app has no
  // :param detail pages; the map lists its tool pages and when to open them).
  map: [
    { url: `${URL_PREFIX}/channels`, use: '渠道管理：新建/修改/下架渠道时打开' },
    { url: `${URL_PREFIX}/groups`, use: '分组与倍率：调整分组倍率时打开' },
    { url: `${URL_PREFIX}/users`, use: '用户与充值：给用户充值或封禁时打开' },
    { url: `${URL_PREFIX}/subscriptions`, use: '订阅：开通/分配订阅时打开' },
    { url: `${URL_PREFIX}/finance`, use: '订单与套餐：查订单、改套餐时打开' },
    { url: `${URL_PREFIX}/codes`, use: '兑换码与优惠码：生成码时打开' },
    { url: `${URL_PREFIX}/accounts`, use: '账号运维：处理异常账号时打开' },
    { url: `${URL_PREFIX}/usage`, use: '用量分析：看消耗趋势时打开' },
  ],
  tree: (_params, state) => {
    const stats = state.home?.stats ?? {}
    const payment = state.home?.payment ?? {}
    const cost = Number(stats.today_actual_cost ?? 0)
    const revenue = Number((payment.today_amount as { amount?: number } | undefined)?.amount ?? 0)
    return (
      <>
        <Static content="Sub2API 运营指挥台 · 首页" />
        <Data path="metrics.revenue_today" value={String((payment.today_amount as Row | undefined) ?? '-')} />
        <Data path="metrics.revenue_total" value={String((payment.total_amount as Row | undefined) ?? '-')} />
        <Data path="metrics.cost_today" value={num(stats.today_actual_cost)} />
        <Data path="metrics.cost_total" value={num(stats.total_actual_cost)} />
        <Data path="metrics.gross_today" value={revenue - cost} />
        <Data path="metrics.active_users" value={num(stats.active_users ?? stats.hourly_active_users)} />
        <Data path="metrics.new_users_today" value={num(stats.today_new_users)} />
        <Data path="metrics.total_users" value={num(stats.total_users)} />
        <Data path="metrics.today_requests" value={num(stats.today_requests)} />
        <Data path="metrics.today_tokens" value={num(stats.today_tokens)} />
        <Data path="metrics.pending_orders" value={num(payment.pending_orders)} />
        <Data path="metrics.error_accounts" value={num(stats.error_accounts)} />
        <Data path="metrics.ratelimit_accounts" value={num(stats.ratelimit_accounts)} />
        <Data path="metrics.overload_accounts" value={num(stats.overload_accounts)} />
        <Static content={'待办指引：异常账号>0 → accounts 页 clear_error/set_status；待处理订单>0 → finance 页 payment orders；'
          + '账号不可用 → channels/groups 页查配置。各页面 URL 见应用说明。'} />
        <Static content={'AI 操作指引：充值=users balance；封禁=users update {"status":"banned"}；生成兑换码=redeem_codes generate；'
          + '创建优惠码=promo_codes create；开通订阅=subscriptions assign；新建渠道=channels create；调整倍率=groups set_rates。'
          + '所有写入前先向用户确认。'} />
        {state.error === undefined ? null : <Data path="store.error" value={state.error} />}
      </>
    )
  },
})

// ---- 渠道管理 ----

export const channelsPage = listPage({
  name: 'channels',
  url: `${URL_PREFIX}/channels`,
  description: '渠道管理页：上游渠道列表，支持开通（create）/编辑（update）/下架（delete）',
  title: 'Sub2API 运营 · 渠道管理',
  instructions: '渠道经 channels 列表同步。用 channels 工具：create/update 传 payload（字段先 GET 一条对照）；delete 下架。'
    + '渠道测活/监控用 request 工具走 /admin/channel-monitors 端点。写前先向用户确认。',
  tools: ['channels'],
  path: 'channels',
  pick: state => state.channels ?? [],
})

// ---- 分组管理 ----

export const groupsPage = listPage({
  name: 'groups',
  url: `${URL_PREFIX}/groups`,
  description: '分组管理页：分组列表（倍率/平台/订阅类型/限额），创建/编辑/删除/模型倍率批量设置',
  title: 'Sub2API 运营 · 分组管理',
  instructions: '分组经 groups 列表同步（含 rate_multiplier/subscription_type/daily_limit_usd）。'
    + '用 groups 工具：create/update 传 payload；set_rates（id+payload，如 {"gpt-4":1.5}）批量设模型倍率；clear_rates 清除。'
    + '绑定账号在 accounts 页改账号的 group_ids。写前先向用户确认。',
  tools: ['groups'],
  path: 'groups',
  pick: state => state.groups ?? [],
})

// ---- 用户管理 ----

export const usersPage = listPage({
  name: 'users',
  url: `${URL_PREFIX}/users`,
  description: '用户管理页：用户列表（余额/分组/状态），开通、充值/扣减、封禁、换组',
  title: 'Sub2API 运营 · 用户管理',
  instructions: '用户经 users 列表同步（含 balance/status/allowed_groups）。用 users 工具：'
    + 'create（payload {"email","password"}）开通；balance（id,balance,operation add|subtract|set）充值/扣减；'
    + 'update（fields {"status":"banned"}）封禁；replace_group 换组；api_keys/usage/balance_history 查明细。'
    + '订阅分配在 subscriptions 页。写前先向用户确认。',
  tools: ['users'],
  path: 'users',
  pick: state => state.users ?? [],
})

// ---- 订阅管理 ----

export const subscriptionsPage = listPage({
  name: 'subscriptions',
  url: `${URL_PREFIX}/subscriptions`,
  description: '订阅管理页：用户订阅列表，分配/续期/重置额度/撤销/恢复',
  title: 'Sub2API 运营 · 订阅管理',
  instructions: '订阅经 subscriptions 列表同步。用 subscriptions 工具：assign/bulk_assign（payload）分配；'
    + 'extend（id+payload {"days":30}）续期；reset_quota 重置额度；revoke/restore 撤销/恢复；progress 看进度；'
    + 'by_user/by_group 按用户/分组查。套餐 CRUD 在 finance 页。写前先向用户确认。',
  tools: ['subscriptions'],
  path: 'subscriptions',
  pick: state => state.subscriptions ?? [],
})

// ---- 资金（订单 + 套餐）----

export const financePage: PageDefinition<Sub2ApiState> = defineAppPage<Sub2ApiState>({
  name: 'finance',
  url: `${URL_PREFIX}/finance`,
  description: '资金管理页：支付订单列表 + 订阅套餐列表 + 收入汇总',
  tools: ['payment', 'overview'],
  instructions: '订单经 orders 列表、套餐经 plans 列表同步，收入汇总经 payment.summary 同步。'
    + '用 payment 工具：dashboard 看收入；orders 查单；order_cancel/order_retry/order_refund 处理异常单；'
    + 'plan_create/plan_update/plan_delete 维护套餐。写前先向用户确认。',
  instanceTitle: () => 'Sub2API 运营 · 资金管理',
  tree: (_params, state) => (
    <>
      <Static content="Sub2API 运营 · 资金管理" />
      <Data path="payment.summary" value={String((state.home?.payment as Row | undefined) ?? '-')} />
      {state.error === undefined ? null : <Data path="store.error" value={state.error} />}
      <Static content="订单（前 20）：" />
      <Keyed path="orders" items={rowsOf(state.finance?.orders ?? [])} />
      <Static content="订阅套餐：" />
      <Keyed path="plans" items={rowsOf(state.finance?.plans ?? [])} />
    </>
  ),
})

// ---- 卡密（兑换码 + 优惠码）----

export const codesPage: PageDefinition<Sub2ApiState> = defineAppPage<Sub2ApiState>({
  name: 'codes',
  url: `${URL_PREFIX}/codes`,
  description: '卡密页：兑换码（生成/核销/过期/删除）+ 优惠码（创建/编辑/删除/用例）+ 兑换统计',
  tools: ['redeem_codes', 'promo_codes'],
  instructions: '兑换码经 redeem 列表、统计经 redeem_stats、优惠码经 promo 列表同步。'
    + '用 redeem_codes 工具生成/核销/清理（支付流传 idempotency_key）；用 promo_codes 工具维护优惠码（usages 看核销）。'
    + '写前先向用户确认。',
  instanceTitle: () => 'Sub2API 运营 · 卡密',
  tree: (_params, state) => (
    <>
      <Static content="Sub2API 运营 · 卡密（兑换码 + 优惠码）" />
      <Data path="redeem_stats" value={String((state.codes?.redeemStats as Row | undefined) ?? '-')} />
      {state.error === undefined ? null : <Data path="store.error" value={state.error} />}
      <Static content="兑换码（前 20）：" />
      <Keyed path="redeem" items={rowsOf(state.codes?.redeem ?? [])} />
      <Static content="优惠码（前 20）：" />
      <Keyed path="promo" items={rowsOf(state.codes?.promo ?? [])} />
    </>
  ),
})

// ---- 账号管理 ----

export const accountsPage = listPage({
  name: 'accounts',
  url: `${URL_PREFIX}/accounts`,
  description: '账号管理页：上游账号列表（平台/类型/状态/可调度），状态/调度/清错/配额/批量运维',
  title: 'Sub2API 运营 · 账号管理',
  instructions: '账号经 accounts 列表同步。用 accounts 工具做查询与运维：'
    + 'set_status/set_schedulable/clear_error/clear_rate_limit/reset_quota/refresh/test/bulk_update。'
    + '异常账号清错用 clear_error；停用用 set_status {"status":"paused"}。写前先向用户确认。',
  tools: ['accounts'],
  path: 'accounts',
  pick: state => state.accounts ?? [],
})

// ---- 用量分析 ----

export const usagePage: PageDefinition<Sub2ApiState> = defineAppPage<Sub2ApiState>({
  name: 'usage',
  url: `${URL_PREFIX}/usage`,
  description: '用量分析页：近 7 日趋势、模型维度统计、区间汇总（成本/毛利口径见指挥台）',
  tools: ['usage'],
  instructions: '区间汇总经 usage.range、近 7 日趋势经 usage.trend、模型维度经 usage.models 同步。'
    + '需要其他口径（自定义区间/按用户/按 Key/用户排行）用 usage 工具查询；'
    + '成本与毛利在首页（today_actual_cost 与支付收入之差）。',
  instanceTitle: () => 'Sub2API 运营 · 用量分析',
  tree: (_params, state) => (
    <>
      <Static content={`Sub2API 运营 · 用量分析${state.usage?.updatedAt === undefined ? '' : `（更新于 ${state.usage.updatedAt}）`}`} />
      <Data path="usage.range" value={String((state.usage?.range as Row | undefined) ?? '-')} />
      {state.error === undefined ? null : <Data path="store.error" value={state.error} />}
      <Keyed path="usage.trend" items={rowsOf(state.usage?.trend ?? [])} />
      <Keyed path="usage.models" items={rowsOf(state.usage?.models ?? [])} />
    </>
  ),
})
