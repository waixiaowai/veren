/**
 * 应用定义 + 应用全部工具（本地名；装配以全名 `sub2api_admin__<本地名>` 备好后，
 * 由页面组件体在唯一一次渲染里 `agent.ctx.tools.register` 登记）。
 * The application definition and the app's full toolset (local names; assembly
 * prepares them under full names `sub2api_admin__<local>` and the page bodies
 * register them via `agent.ctx.tools.register` in the one render).
 * Action→endpoint mapping is table-driven; each successful write refreshes the
 * matching store slice so pages update.
 * @module @veren/sub2api-admin/tools
 */
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { ApplicationDefinition, AppId, PageKey } from '@veren/app-registry'
import type { AdminArgs, GateExec, Sub2AdminClient } from './client.ts'
import { adminTool, argNumber, argObject, argString, idList, integer, numberParam, objParam, oneOf, str, toQuery } from './client.ts'
import type { Sub2ApiStore } from './store.ts'
import { assertAllowedUnattended, assertRawAllowedUnattended } from './unattended.ts'

// ---- 应用定义 / the application definition ----

export const APP_ID = 'sub2api-admin' as AppId

/** 应用定义：entry 是应用内页面键 / the definition; entry is a page key, not a url */
export const APP_DEFINITION: ApplicationDefinition = {
  id: APP_ID,
  name: 'Sub2API 运营',
  description: 'Sub2API 运营指挥台：经营指标、渠道/分组/用户/订阅/资金/卡密/账号/用量全流程管理',
  entry: 'home' as PageKey,
  instructions: 'Sub2API 运营应用覆盖运营全流程：home 是指挥台（经营指标+待办+操作指引），'
    + 'channels 渠道、groups 分组与倍率、users 用户与余额、subscriptions 订阅、finance 订单与套餐、'
    + 'codes 兑换码与优惠码、accounts 上游账号、usage 用量分析。'
    + '页面数据由 sub2api_admin__* 工具读写，正文是打开时刻的首屏——此后的变化以工具返回的结果为准。'
    + '读写与常规运营写（L1）自主执行，完成后用一句话点名产物（id/字段前后值）回报；'
    + '真破坏性动作（退款/删套餐/删码，L2）在本回合没有人类消息时会被工具以 unattended/l2-refused 拒绝——'
    + '此时不要重试，改走可逆替代或如实转述用户。',
  toolPrefix: 'sub2api_admin',
}

// ---- 表驱动动作 / table-driven actions ----

/** 一个动作解析出的单次请求 / one request resolved from one action */
interface Endpoint {
  method: string
  path: string
  body?: unknown
  headers?: Record<string, string>
}

/** 动作表：action → 请求构造 / the action table: action → request builder */
type ActionTable = Record<string, (args: AdminArgs) => Endpoint>

/** 请求构造小助手 / the endpoint builder shorthand */
const ep = (method: string, path: string, body?: unknown): Endpoint =>
  ({ method, path, ...(body === undefined ? {} : { body }) })

/** 资源 CRUD 动作表（list 可带查询参数，create/update 走 payload）/ generic CRUD table */
function crudTable(resource: string): ActionTable {
  return {
    list: a => ep('GET', `/${resource}${toQuery(a)}`),
    get: a => ep('GET', `/${resource}/${a.id}`),
    create: a => ep('POST', `/${resource}`, a.payload),
    update: a => ep('PUT', `/${resource}/${a.id}`, a.payload),
    delete: a => ep('DELETE', `/${resource}/${a.id}`),
  }
}

/** 渠道动作表 / channel actions */
const CHANNEL_ACTIONS: ActionTable = crudTable('admin/channels')

/** 分组动作表（含倍率批量设置）/ group actions incl. rate multipliers */
const GROUP_ACTIONS: ActionTable = {
  ...crudTable('admin/groups'),
  list: () => ep('GET', '/admin/groups/all'),
  set_rates: a => ep('PUT', `/admin/groups/${a.id}/rate-multipliers`, a.payload),
  clear_rates: a => ep('DELETE', `/admin/groups/${a.id}/rate-multipliers`),
}

/** 用户动作表 / user actions */
const USER_ACTIONS: ActionTable = {
  ...crudTable('admin/users'),
  balance: a => ep('POST', `/admin/users/${a.id}/balance`, { balance: a.balance, operation: a.operation ?? 'add' }),
  replace_group: a => ep('POST', `/admin/users/${a.id}/replace-group`, { group_id: a.group_id }),
  api_keys: a => ep('GET', `/admin/users/${a.id}/api-keys`),
  usage: a => ep('GET', `/admin/users/${a.id}/usage`),
  balance_history: a => ep('GET', `/admin/users/${a.id}/balance-history`),
}

/** 订阅动作表 / subscription actions */
const SUB_ACTIONS: ActionTable = {
  list: a => ep('GET', `/admin/subscriptions${toQuery(a)}`),
  get: a => ep('GET', `/admin/subscriptions/${a.id}`),
  progress: a => ep('GET', `/admin/subscriptions/${a.id}/progress`),
  assign: a => ep('POST', '/admin/subscriptions/assign', a.payload),
  bulk_assign: a => ep('POST', '/admin/subscriptions/bulk-assign', a.payload),
  bulk_action: a => ep('POST', '/admin/subscriptions/bulk-action', a.payload),
  extend: a => ep('POST', `/admin/subscriptions/${a.id}/extend`, a.payload),
  reset_quota: a => ep('POST', `/admin/subscriptions/${a.id}/reset-quota`),
  revoke: a => ep('POST', `/admin/subscriptions/${a.id}/revoke`),
  restore: a => ep('POST', `/admin/subscriptions/${a.id}/restore`),
  by_user: a => ep('GET', `/admin/users/${a.id}/subscriptions`),
  by_group: a => ep('GET', `/admin/groups/${a.id}/subscriptions`),
}

/** 资金动作表（订单 + 套餐）/ payment actions (orders + plans) */
const PAYMENT_ACTIONS: ActionTable = {
  dashboard: () => ep('GET', '/admin/payment/dashboard'),
  orders: a => ep('GET', `/admin/payment/orders${toQuery({ page: a.page, page_size: a.page_size, status: a.status, search: a.search })}`),
  order: a => ep('GET', `/admin/payment/orders/${a.id}`),
  order_cancel: a => ep('POST', `/admin/payment/orders/${a.id}/cancel`),
  order_retry: a => ep('POST', `/admin/payment/orders/${a.id}/retry`),
  order_refund: a => ep('POST', `/admin/payment/orders/${a.id}/refund`, a.payload),
  plans: () => ep('GET', '/admin/payment/plans'),
  plan_create: a => ep('POST', '/admin/payment/plans', a.payload),
  plan_update: a => ep('PUT', `/admin/payment/plans/${a.id}`, a.payload),
  plan_delete: a => ep('DELETE', `/admin/payment/plans/${a.id}`),
}

/** 优惠码动作表 / promo-code actions */
const PROMO_ACTIONS: ActionTable = {
  ...crudTable('admin/promo-codes'),
  usages: a => ep('GET', `/admin/promo-codes/${a.id}/usages`),
}

/** 兑换码动作表 / redeem-code actions */
const REDEEM_ACTIONS: ActionTable = {
  list: a => ep('GET', `/admin/redeem-codes${toQuery({ page: a.page, page_size: a.page_size, type: a.type, status: a.status, search: a.search })}`),
  get: a => ep('GET', `/admin/redeem-codes/${a.id}`),
  stats: () => ep('GET', '/admin/redeem-codes/stats'),
  generate: a => ep('POST', '/admin/redeem-codes/generate', {
    count: a.count ?? 1, type: a.type, value: a.value ?? 0, group_id: a.group_id, validity_days: a.validity_days, notes: a.notes,
  }),
  create_and_redeem: a => ep('POST', '/admin/redeem-codes/create-and-redeem', {
    code: a.code, type: a.type, value: a.value, user_id: a.user_id, notes: a.notes,
  }),
  expire: a => ep('POST', `/admin/redeem-codes/${a.id}/expire`),
  delete: a => ep('DELETE', `/admin/redeem-codes/${a.id}`),
  batch_delete: a => ep('POST', '/admin/redeem-codes/batch-delete', { ids: a.ids ?? [] }),
  batch_update: a => ep('POST', '/admin/redeem-codes/batch-update', { ids: a.ids ?? [], ...(a.fields ?? {}) }),
}

/** 账号动作表 / upstream account actions */
const ACCOUNT_ACTIONS: ActionTable = {
  list: a => ep('GET', `/admin/accounts${toQuery({ page: a.page, page_size: a.page_size, search: a.search, status: a.status, platform: a.platform, type: a.type })}`),
  get: a => ep('GET', `/admin/accounts/${a.id}`),
  usage: a => ep('GET', `/admin/accounts/${a.id}/usage`),
  stats: a => ep('GET', `/admin/accounts/${a.id}/stats?days=${a.days ?? 30}`),
  today_stats: a => ep('GET', `/admin/accounts/${a.id}/today-stats`),
  models: a => ep('GET', `/admin/accounts/${a.id}/models`),
  set_status: a => ep('PUT', `/admin/accounts/${a.id}`, { status: a.status }),
  set_schedulable: a => ep('POST', `/admin/accounts/${a.id}/schedulable`, { schedulable: a.schedulable ?? true }),
  clear_error: a => ep('POST', `/admin/accounts/${a.id}/clear-error`),
  clear_rate_limit: a => ep('POST', `/admin/accounts/${a.id}/clear-rate-limit`),
  recover_state: a => ep('POST', `/admin/accounts/${a.id}/recover-state`),
  reset_quota: a => ep('POST', `/admin/accounts/${a.id}/reset-quota`),
  refresh: a => ep('POST', `/admin/accounts/${a.id}/refresh`),
  test: a => ep('POST', `/admin/accounts/${a.id}/test`),
  bulk_update: a => ep('POST', '/admin/accounts/bulk-update', { account_ids: a.ids ?? [], ...(a.patch ?? {}) }),
}

/** 执行动作表里的一次调用（过无人值守分级门）/ run one action through its table (past the unattended level gate) */
function runTable(client: Sub2AdminClient, table: ActionTable, args: AdminArgs, exec: GateExec, tool: string): Promise<unknown> {
  const action = argString(args, 'action') ?? ''
  const build = table[action]
  if (build === undefined) throw new Error(`Unknown action: ${action}`)
  assertAllowedUnattended(tool, action, exec)
  const endpoint = build(args)
  return client.request(endpoint.method, endpoint.path, endpoint.body, endpoint.headers)
}

/** 刷新 store 切片（静默失败：页面数据是辅助面）/ refresh one store slice (silent) */
type SliceName = 'home' | 'channels' | 'groups' | 'users' | 'subscriptions' | 'finance' | 'codes' | 'accounts' | 'usage'

function syncSlice(client: Sub2AdminClient, store: Sub2ApiStore, slice: SliceName): void {
  const refreshers: Record<SliceName, (c: Sub2AdminClient) => Promise<void>> = {
    home: c => store.refreshHome(c),
    channels: c => store.refreshChannels(c),
    groups: c => store.refreshGroups(c),
    users: c => store.refreshUsers(c),
    subscriptions: c => store.refreshSubscriptions(c),
    finance: c => store.refreshFinance(c),
    codes: c => store.refreshCodes(c),
    accounts: c => store.refreshAccounts(c),
    usage: c => store.refreshUsage(c),
  }
  void refreshers[slice](client).catch(() => undefined)
}

// ---- 工具目录 / the tool catalog ----

/** 定义应用全部工具 / define the app's full tool catalog */
export function createAppTools(client: Sub2AdminClient, store: Sub2ApiStore): ToolDefinition[] {
  const slice = (name: SliceName) => syncSlice(client, store, name)
  return [
    overviewTool(client, () => slice('home')),
    tableTool(client, 'channels', CHANNEL_ACTIONS, CHANNEL_DESC, () => slice('channels')),
    tableTool(client, 'groups', GROUP_ACTIONS, GROUP_DESC, () => slice('groups')),
    tableTool(client, 'users', USER_ACTIONS, USER_DESC, () => slice('users')),
    tableTool(client, 'subscriptions', SUB_ACTIONS, SUB_DESC, () => slice('subscriptions')),
    tableTool(client, 'payment', PAYMENT_ACTIONS, PAYMENT_DESC, () => slice('finance')),
    tableTool(client, 'promo_codes', PROMO_ACTIONS, PROMO_DESC, () => slice('codes')),
    tableTool(client, 'redeem_codes', REDEEM_ACTIONS, REDEEM_DESC, () => slice('codes')),
    accountsTool(client, () => slice('accounts')),
    usageTool(client, () => slice('usage')),
    rawRequestTool(client),
  ]
}

/** overview：首页经营指标（大盘 + 支付 + 可用性） */
function overviewTool(client: Sub2AdminClient, onDone: () => void): ToolDefinition {
  return adminTool({
    name: 'overview',
    description: 'Get the Sub2API operations snapshot: today requests/tokens/cost/actual cost, revenue/payment dashboard (today/total amount and counts, pending orders), account availability by status. Read-only; call this first on the home page.',
    parameters: {},
    run: async () => {
      const [stats, payment, availability] = await Promise.all([
        client.request('GET', '/admin/dashboard/stats'),
        client.request('GET', '/admin/payment/dashboard'),
        client.request('GET', '/admin/ops/account-availability'),
      ])
      return { stats, payment, availability }
    },
    after: onDone,
  })
}

/** 通用动作型工具构造 / one table-driven action tool */
function tableTool(client: Sub2AdminClient, name: string, table: ActionTable, description: string, onDone: () => void): ToolDefinition {
  return adminTool({
    name,
    description,
    timeoutMs: 90000,
    parameters: {
      action: oneOf(Object.keys(table), 'Operation to perform'),
      id: integer('Resource id (single-resource actions)'),
      payload: objParam('JSON request body for create/update/assign/extend/refund and similar writes'),
      page: integer('Page number (1-based)'),
      page_size: integer('Page size'),
      search: str('Search filter'),
      status: str('Status filter'),
      balance: numberParam('Balance amount for users balance'),
      operation: { type: 'string', enum: ['add', 'subtract', 'set'], description: 'Balance operation' },
      group_id: integer('Target group id'),
      ids: idList('Ids for batch actions'),
      fields: objParam('Field patch for batch_update'),
      type: str('Redeem code type filter / type to generate'),
      count: integer('Number of codes to generate'),
      value: numberParam('Code value'),
      code: str('Explicit code string for create_and_redeem'),
      notes: str('Notes'),
      idempotency_key: str('Stable idempotency key header for payment flows'),
      days: integer('History days (accounts stats, default 30)'),
    },
    run: (args, exec) => runWithIdempotency(client, name, table, args, exec),
    after: onDone,
  })
}

/** 透传 Idempotency-Key 头（支付/充值流）；过无人值守分级门 / forward the idempotency key header; past the unattended level gate */
function runWithIdempotency(client: Sub2AdminClient, tool: string, table: ActionTable, args: AdminArgs, exec: GateExec): Promise<unknown> {
  const key = argString(args, 'idempotency_key')
  const wrapped: ActionTable = Object.fromEntries(Object.entries(table).map(([action, build]) => [action, (a: AdminArgs) => {
    const endpoint = build(a)
    return { ...endpoint, ...(key === undefined ? {} : { headers: { 'Idempotency-Key': key } }) }
  }]))
  return runTable(client, wrapped, args, exec, tool)
}

/** accounts：上游账号运维（含 15 动作） */
function accountsTool(client: Sub2AdminClient, onDone: () => void): ToolDefinition {
  return tableTool(client, 'accounts', ACCOUNT_ACTIONS, ACCOUNT_DESC, onDone)
}

/** usage：用量分析 */
function usageTool(client: Sub2AdminClient, onDone: () => void): ToolDefinition {
  return adminTool({
    name: 'usage',
    description: 'Query Sub2API usage analytics: list (per-request log), stats (range aggregates), trend, models, users_ranking. Dates are YYYY-MM-DD. Read-only.',
    timeoutMs: 90000,
    parameters: {
      query: { type: 'string', enum: ['list', 'stats', 'trend', 'models', 'users_ranking'], description: 'Which usage view to fetch' },
      start_date: str('Range start, YYYY-MM-DD'),
      end_date: str('Range end, YYYY-MM-DD'),
      granularity: { type: 'string', enum: ['hour', 'day'], description: 'Trend bucket size' },
      model: str('Filter by model name'),
      user_id: integer('Filter by user id'),
      api_key_id: integer('Filter by API key id'),
      group_id: integer('Filter by group id'),
      limit: integer('Row limit for rankings (max 100)'),
      page: integer('Page number for list'),
      page_size: integer('Page size for list'),
    },
    run: (args) => {
      const range = toQuery({
        start_date: args.start_date, end_date: args.end_date, granularity: args.granularity,
        model: args.model, user_id: args.user_id, api_key_id: args.api_key_id,
        group_id: args.group_id, limit: args.limit, page: args.page, page_size: args.page_size,
      })
      const paths: Record<string, string> = {
        list: `/admin/usage${range}`, stats: `/admin/usage/stats${range}`,
        trend: `/admin/dashboard/trend${range}`, models: `/admin/dashboard/models${range}`,
        users_ranking: `/admin/dashboard/users-ranking${range}`,
      }
      const path = paths[argString(args, 'query') ?? '']
      if (path === undefined) throw new Error(`Unknown usage query: ${argString(args, 'query') ?? ''}`)
      return client.request('GET', path)
    },
    after: onDone,
  })
}

/** request：未封装端点直通（仅 /api/v1/admin/**；非 GET 过无人值守门） */
function rawRequestTool(client: Sub2AdminClient): ToolDefinition {
  return adminTool({
    name: 'request',
    description: 'Raw passthrough to any Sub2API admin endpoint not covered by the dedicated tools (channel monitors, ops alerts, announcements, settings...). path starts with /admin/ or /api/v1/admin/; body is the JSON payload. Prefer read-only GET first; non-GET is L2 — refused unattended (unattended/l2-refused) and allowed only with a human message this turn.',
    parameters: {
      method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'DELETE'], description: 'HTTP method' },
      path: str('Admin path, e.g. /admin/announcements'),
      body: objParam('JSON request body'),
    },
    run: (args, exec) => {
      const raw = argString(args, 'path') ?? ''
      const path = raw.startsWith('/api/v1/admin') || raw.startsWith('/admin')
        ? raw
        : `/admin/${raw.replace(/^\/+/, '')}`
      const method = argString(args, 'method') ?? 'GET'
      assertRawAllowedUnattended(method, exec)
      return client.request(method, path, args.body)
    },
  })
}

/**
 * 共享的读写条款片段（docs/unattended-page-contract.cn.md §1/§3）：L1 自主
 * 执行 + 一句话证据回报；不再有"写前先向用户确认"（那是无人停摆措辞）。
 * The shared read/write clause (docs/unattended-page-contract.md §1/§3): L1
 * runs autonomously and reports one sentence of evidence; no "confirm before
 * writing" (that is unattended-stall wording).
 */
const POLICY = '读后写；写成功后用一句话点名产物（id 与关键字段前后值）回报。'

const CHANNEL_DESC = 'Manage upstream channels: list/get/create/update/delete. create/update take a payload object (backend-defined fields; GET a channel first to copy field names). delete 是可重建的下架（L1）。' + POLICY
const GROUP_DESC = 'Manage groups: list/get/create/update/delete, set_rates (id + payload, e.g. {"gpt-4":1.5}), clear_rates (id). rate_multiplier on the group payload adjusts billing multiplier. delete 是可重建的删除（L1）。' + POLICY
const USER_DESC = 'Manage users: list/get/create (payload e.g. {"email":"a@b.c","password":"..."}), update, delete, balance (id, balance, operation add|subtract|set), replace_group (id, group_id), api_keys, usage, balance_history. balance 扣减要带 idempotency_key 防重放。' + POLICY
const SUB_DESC = 'Manage subscriptions: list/get/progress, assign/bulk_assign/bulk_action (payload), extend (id + payload e.g. {"days":30}), reset_quota/revoke/restore (id), by_user/by_group (id). revoke 有 restore 反向操作（L1）。' + POLICY
const PAYMENT_DESC = 'Money operations: dashboard (revenue today/total), orders (list: page/page_size/status/search), order (id), order_cancel/order_retry (id), order_refund (id; refund takes payload — L2: refused unattended with unattended/l2-refused, human message this turn required), plans CRUD (plan_create/plan_update with payload, plan_delete — L2 同上). ' + POLICY
const PROMO_DESC = 'Manage promo codes: list/get/create/update/delete (create/update take a payload; delete 是 L2——无人值守被拒), usages (id). ' + POLICY
const REDEEM_DESC = 'Manage redeem codes (types balance/concurrency/subscription/invitation): list/get/stats, generate (count/type/value; subscription needs group_id+validity_days), create_and_redeem (code/type/value/user_id), expire/delete/batch_delete/batch_update (delete/batch_delete 是 L2——无人值守被拒). Use idempotency_key for payment flows. ' + POLICY
const ACCOUNT_DESC = 'Manage upstream accounts: list/get/usage/stats/today_stats/models, set_status/set_schedulable/clear_error/clear_rate_limit/recover_state/reset_quota/refresh/test, bulk_update (ids+patch). 全部是可逆状态翻转（L1）。' + POLICY
