/** @jsxRuntime automatic @jsxImportSource @veren/prompt-core */
/**
 * 应用九页（一次性渲染形态，模块级组件）：指挥台 / 渠道 / 分组 / 用户 / 订阅 /
 * 资金 / 卡密 / 账号 / 用量，`export const XxxPage: PageFC` 直接导出，不做工厂
 * 封装。组件体在页面会话的真实 Agent 上执行恰好一次，产物成型为 PAGE 块正文；
 * 工具由组件体直接 `agent.ctx.tools.register` 登记（全名 `sub2api_admin__<本地名>`，
 * 随 agent fiber 生灭）。此后页面不再渲染：模型从工具调用的结果获知数据变化。
 * 依赖走一条正道：组件体读装配期绑定的模块级槽位（权威 store + 全名工具，
 * `bindSub2ApiRuntime` 由装配调用一次）。store 是同步内存面，正文直读当前
 * 状态——首屏不经手任何宿主取数；未绑定即取 = 装配错误 fail loud。
 * The app's nine pages in the one-shot form as MODULE-LEVEL components — no
 * factory wrapper: home / channels / groups / users / subscriptions / finance /
 * codes / accounts / usage. The body runs exactly once on the page session's
 * real Agent and its output becomes the PAGE block body; tools register via
 * `agent.ctx.tools.register` (full names `sub2api_admin__<local>`, living and
 * dying with the agent fiber). The page never renders again: the model learns
 * data changes from tool results. Dependencies take one straight path: bodies
 * read the assembly-bound module slot (authoritative store + full-named tools,
 * bound once by `bindSub2ApiRuntime`). The store is a synchronous in-memory
 * face: bodies read the current state directly; reading it unbound fails loud.
 * @module @veren/sub2api-admin/pages
 */
import type { ComponentPageMeta, PageFC } from '@veren/prompt-page'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { Sub2ApiState } from './store.ts'

/** 应用 id（页面 URL 前缀的权威来源）/ the app id (authority of the url prefix) */
export const APP_ID = 'sub2api-admin'
/** 应用内 URL 前缀 / the app-scoped url prefix */
const URL_PREFIX = `/apps/${APP_ID}`

/** 工具对外名：`sub2api_admin__<本地名>`（§3.4.3）——组件体直接以全名登记
 * / the external tool name — the body registers under the full name directly */
export const externalName = (localName: string): string => `sub2api_admin__${localName}`

/** 权威 store 的结构面（快照引用稳定）/ the structural face of the authoritative store (stable snapshots) */
interface StoreFace {
  getSnapshot(): Sub2ApiState
}

/**
 * 装配期绑定的模块级槽位：load（没有 agent 可用）与组件体的工具登记从这里取
 * 权威 store 与全名工具。注册一定先于任何页面打开。
 * The module-level slot bound at assembly time: the bodies' tool registrations
 * and store reads take their authoritative facts from here. Registration always
 * precedes any page open.
 */
let runtime: { readonly store: StoreFace; readonly tools: readonly ToolDefinition[] } | undefined

/** 装配时绑定（index.ts 的单入口注册调用一次）/ bind at assembly time (called once by index.ts's wiring) */
export function bindSub2ApiRuntime(store: StoreFace, tools: readonly ToolDefinition[]): void {
  runtime = { store, tools }
}

/** 取绑定的运行时；未绑定 = 装配错误 fail loud / read the bound runtime; unbound = assembly error, fail loud */
function requireRuntime(): { readonly store: StoreFace; readonly tools: readonly ToolDefinition[] } {
  if (runtime === undefined) {
    throw new Error('[sub2api-admin] the sub2api runtime is not bound; the app wiring must run before pages open')
  }
  return runtime
}

/** 按本地名取全名工具定义 / look up a full-named tool definition by local name */
function toolOf(localName: string): ToolDefinition {
  const name = externalName(localName)
  const found = requireRuntime().tools.find((tool) => tool.name === name)
  if (found === undefined) throw new Error(`[sub2api-admin] tool ${name} is not defined`)
  return found
}

/** 组件体的本页工具登记（跑一次，安全）/ the body's tool registration for this page (runs once, safe) */
function registerTools(agent: Parameters<PageFC>[1], locals: readonly string[]): void {
  for (const local of locals) agent.ctx.tools.register(toolOf(local))
}

/** 正文直读权威 store 当前状态（同步内存面；一次性渲染内安全）
 * / the body's direct read of the authoritative store (a synchronous in-memory face; safe inside the one-shot render) */
function readState(): Sub2ApiState {
  return requireRuntime().store.getSnapshot()
}

/** 大盘点位（空值显示 -）/ one dashboard scalar (dash when absent) */
const num = (value: unknown): unknown => value ?? '-'

/** 把无 id 的原始行投影成带 id 行（index 兜底）/ project raw rows into id-carrying rows */
function rowsOf(raw: readonly Record<string, unknown>[]): Array<Record<string, unknown> & { id: string }> {
  return raw.map((row, index) => ({ ...row, id: String(row.id ?? index) }))
}

/** 列表页静态配置（模块级常量）/ one list page's static config (a module-level constant) */
interface ListPageConfig {
  readonly name: string
  readonly url: string
  readonly description: string
  readonly title: string
  readonly instructions: string
  /** 本页挂载的工具（本地名；组件体登记）/ this page's tools (local names; the body registers them) */
  readonly tools: readonly string[]
  readonly pick: (state: Sub2ApiState) => readonly Record<string, unknown>[]
}

/** 通用列表页：标题 + 配套工具行 + 错误位 + keyed 列表 / generic list page: header + tool line + error + one keyed list */
function listPage(config: ListPageConfig): { readonly Page: PageFC; readonly Meta: ComponentPageMeta } {
  const Page: PageFC = (_props, agent) => {
    registerTools(agent, config.tools)
    const state = readState()
    const rows = rowsOf([...config.pick(state)])
    return (
      <>
        <h1>{config.title}</h1>
        <p>页面入口：{config.url}；配套工具：{config.tools.map(externalName).join('、')}</p>
        {state.error === undefined ? null : <blockquote>store.error：{String(state.error)}</blockquote>}
        <ul>
          {rows.map((row) => (
            <li key={row.id}>{JSON.stringify(row)}</li>
          ))}
        </ul>
      </>
    )
  }
  const Meta: ComponentPageMeta = {
    name: config.name,
    url: config.url,
    description: config.description,
    instructions: config.instructions,
  }
  return { Page, Meta }
}

// ---- 首页 · 运营指挥台 / Home · the ops console ----

export const HomePage: PageFC = (_props, agent) => {
  registerTools(agent, ['overview'])
  const state = readState()
  const stats = state.home?.stats ?? {}
  const payment = state.home?.payment ?? {}
  const cost = Number(stats.today_actual_cost ?? 0)
  const revenue = Number((payment.today_amount as { amount?: number } | undefined)?.amount ?? 0)
  return (
    <>
      <h1>Sub2API 运营指挥台 · 首页</h1>
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
      <blockquote>
        {'待办指引：异常账号>0 → accounts 页 clear_error/set_status；待处理订单>0 → finance 页 payment orders；账号不可用 → channels/groups 页查配置。'}
        {'AI 操作指引：充值=users balance；封禁=users update {"status":"banned"}；生成兑换码=redeem_codes generate；创建优惠码=promo_codes create；开通订阅=subscriptions assign；新建渠道=channels create；调整倍率=groups set_rates。所有写入前先向用户确认。'}
      </blockquote>
      {state.error === undefined ? null : <blockquote>store.error：{String(state.error)}</blockquote>}
    </>
  )
}

export const HomeMeta: ComponentPageMeta = {
  name: 'home',
  url: `${URL_PREFIX}/home`,
  description: 'Sub2API 运营指挥台：核心经营指标（收入/成本/毛利/活跃/新增/今日消耗）+ 待办信号 + 操作指引',
  instructions: '这是运营指挥台（首页）。指标经正文同步：'
    + '收入/成本/毛利/活跃/新增/总用户/今日请求/tokens/待处理订单/异常/限流/过载账号。'
    + '数据过期用 overview 工具刷新。具体操作去对应页面：'
    + '渠道管理 /apps/sub2api-admin/channels（工具 channels）；分组与倍率 /apps/sub2api-admin/groups（groups）；'
    + '用户与充值 /apps/sub2api-admin/users（users）；订阅 /apps/sub2api-admin/subscriptions（subscriptions）；'
    + '订单与套餐 /apps/sub2api-admin/finance（payment）；兑换码与优惠码 /apps/sub2api-admin/codes（redeem_codes / promo_codes）；'
    + '账号 /apps/sub2api-admin/accounts（accounts）；用量 /apps/sub2api-admin/usage（usage）。'
    + '常见操作：给用户充值→users balance；封禁→users update {"status":"banned"}；生成兑换码→redeem_codes generate；'
    + '创建优惠码→promo_codes create；开通订阅→subscriptions assign；新建渠道→channels create；调整倍率→groups set_rates。'
    + '所有写入前先向用户确认。',
  instanceTitle: () => 'Sub2API 运营指挥台',
}

// ---- 五个列表页 / the five list pages ----

const channels = listPage({
  name: 'channels',
  url: `${URL_PREFIX}/channels`,
  description: '渠道管理页：上游渠道列表，支持开通（create）/编辑（update）/下架（delete）',
  title: 'Sub2API 运营 · 渠道管理',
  instructions: '渠道经 channels 列表同步。用 channels 工具：create/update 传 payload（字段先 GET 一条对照）；delete 下架。'
    + '渠道测活/监控用 request 工具走 /admin/channel-monitors 端点（本页已挂载该透传工具）。写前先向用户确认。',
  tools: ['channels', 'request'],
  pick: state => state.channels ?? [],
})
export const ChannelsPage = channels.Page
export const ChannelsMeta = channels.Meta

const groups = listPage({
  name: 'groups',
  url: `${URL_PREFIX}/groups`,
  description: '分组管理页：分组列表（倍率/平台/订阅类型/限额），创建/编辑/删除/模型倍率批量设置',
  title: 'Sub2API 运营 · 分组管理',
  instructions: '分组经 groups 列表同步（含 rate_multiplier/subscription_type/daily_limit_usd）。'
    + '用 groups 工具：create/update 传 payload；set_rates（id+payload，如 {"gpt-4":1.5}）批量设模型倍率；clear_rates 清除。'
    + '绑定账号在 accounts 页改账号的 group_ids。写前先向用户确认。',
  tools: ['groups'],
  pick: state => state.groups ?? [],
})
export const GroupsPage = groups.Page
export const GroupsMeta = groups.Meta

const users = listPage({
  name: 'users',
  url: `${URL_PREFIX}/users`,
  description: '用户管理页：用户列表（余额/分组/状态），开通、充值/扣减、封禁、换组',
  title: 'Sub2API 运营 · 用户管理',
  instructions: '用户经 users 列表同步（含 balance/status/allowed_groups）。用 users 工具：'
    + 'create（payload {"email","password"}）开通；balance（id,balance,operation add|subtract|set）充值/扣减；'
    + 'update（fields {"status":"banned"}）封禁；replace_group 换组；api_keys/usage/balance_history 查明细。'
    + '订阅分配在 subscriptions 页。写前先向用户确认。',
  tools: ['users'],
  pick: state => state.users ?? [],
})
export const UsersPage = users.Page
export const UsersMeta = users.Meta

const subscriptions = listPage({
  name: 'subscriptions',
  url: `${URL_PREFIX}/subscriptions`,
  description: '订阅管理页：用户订阅列表，分配/续期/重置额度/撤销/恢复',
  title: 'Sub2API 运营 · 订阅管理',
  instructions: '订阅经 subscriptions 列表同步。用 subscriptions 工具：assign/bulk_assign（payload）分配；'
    + 'extend（id+payload {"days":30}）续期；reset_quota 重置额度；revoke/restore 撤销/恢复；progress 看进度；'
    + 'by_user/by_group 按用户/分组查。套餐 CRUD 在 finance 页。写前先向用户确认。',
  tools: ['subscriptions'],
  pick: state => state.subscriptions ?? [],
})
export const SubscriptionsPage = subscriptions.Page
export const SubscriptionsMeta = subscriptions.Meta

const accounts = listPage({
  name: 'accounts',
  url: `${URL_PREFIX}/accounts`,
  description: '账号管理页：上游账号列表（平台/类型/状态/可调度），状态/调度/清错/配额/批量运维',
  title: 'Sub2API 运营 · 账号管理',
  instructions: '账号经 accounts 列表同步。用 accounts 工具做查询与运维：'
    + 'set_status/set_schedulable/clear_error/clear_rate_limit/reset_quota/refresh/test/bulk_update。'
    + '异常账号清错用 clear_error；停用用 set_status {"status":"paused"}。写前先向用户确认。',
  tools: ['accounts'],
  pick: state => state.accounts ?? [],
})
export const AccountsPage = accounts.Page
export const AccountsMeta = accounts.Meta

// ---- 资金（订单 + 套餐） / Finance (orders + plans) ----

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
  instructions: '订单经 orders 列表、套餐经 plans 列表同步，收入汇总经 payment.summary 同步。'
    + '用 payment 工具：dashboard 看收入；orders 查单；order_cancel/order_retry/order_refund 处理异常单；'
    + 'plan_create/plan_update/plan_delete 维护套餐。本页也挂了 overview 工具：'
    + '正文顶部的收入汇总来自首页支付切片，过期时用 overview 刷新。写前先向用户确认。',
  instanceTitle: () => 'Sub2API 运营 · 资金管理',
}

// ---- 卡密（兑换码 + 优惠码） / Codes (redeem + promo) ----

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
  instructions: '兑换码经 redeem 列表、统计经 redeem_stats、优惠码经 promo 列表同步。'
    + '用 redeem_codes 工具生成/核销/清理（支付流传 idempotency_key）；用 promo_codes 工具维护优惠码（usages 看核销）。'
    + '写前先向用户确认。',
  instanceTitle: () => 'Sub2API 运营 · 卡密',
}

// ---- 用量分析 / Usage analytics ----

export const UsagePage: PageFC = (_props, agent) => {
  registerTools(agent, ['usage'])
  const state = readState()
  const trend = rowsOf(state.usage?.trend ?? [])
  const models = rowsOf(state.usage?.models ?? [])
  return (
    <>
      <h1>{`Sub2API 运营 · 用量分析${state.usage?.updatedAt === undefined ? '' : `（更新于 ${state.usage.updatedAt}）`}`}</h1>
      <p>区间汇总：{String((state.usage?.range as unknown | undefined) ?? '-')}</p>
      {state.error === undefined ? null : <blockquote>store.error：{String(state.error)}</blockquote>}
      <h2>近 7 日趋势</h2>
      <ul>{trend.map((row) => <li key={row.id}>{JSON.stringify(row)}</li>)}</ul>
      <h2>模型维度</h2>
      <ul>{models.map((row) => <li key={row.id}>{JSON.stringify(row)}</li>)}</ul>
    </>
  )
}

export const UsageMeta: ComponentPageMeta = {
  name: 'usage',
  url: `${URL_PREFIX}/usage`,
  description: '用量分析页：近 7 日趋势、模型维度统计、区间汇总（成本/毛利口径见指挥台）',
  instructions: '区间汇总经 usage.range、近 7 日趋势经 usage.trend、模型维度经 usage.models 同步。'
    + '需要其他口径（自定义区间/按用户/按 Key/用户排行）用 usage 工具查询；'
    + '成本与毛利在首页（today_actual_cost 与支付收入之差）。',
  instanceTitle: () => 'Sub2API 运营 · 用量分析',
}
