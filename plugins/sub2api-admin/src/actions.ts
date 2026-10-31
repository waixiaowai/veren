/**
 * 表驱动动作：action → 请求构造（method/path/body/headers）。每个模型侧工具
 * 的一组动作在这里成为一张动作表，`runTable` 负责解析动作名、过无人值守分级门、
 * 发出单次请求。工具目录（tools.ts）只引用表，不内联端点知识。
 * Table-driven actions: action → request construction (method/path/body/
 * headers). Each model-facing tool's action set becomes one table here;
 * `runTable` resolves the action name, passes the unattended level gate, and
 * issues the single request. The tool catalog (tools.ts) references tables and
 * inlines no endpoint knowledge.
 *
 * @module @veren/sub2api-admin/actions
 */
import type { AdminArgs, GateExec, Sub2AdminClient } from './client.ts'
import { argString, toQuery } from './client.ts'
import { assertAllowedUnattended } from './unattended.ts'

/** 一个动作解析出的单次请求 / one request resolved from one action */
export interface Endpoint {
  method: string
  path: string
  body?: unknown
  headers?: Record<string, string>
}

/** 动作表：action → 请求构造 / the action table: action → request builder */
export type ActionTable = Record<string, (args: AdminArgs) => Endpoint>

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
export const CHANNEL_ACTIONS: ActionTable = crudTable('admin/channels')

/** 分组动作表（含倍率批量设置）/ group actions incl. rate multipliers */
export const GROUP_ACTIONS: ActionTable = {
  ...crudTable('admin/groups'),
  list: () => ep('GET', '/admin/groups/all'),
  set_rates: a => ep('PUT', `/admin/groups/${a.id}/rate-multipliers`, a.payload),
  clear_rates: a => ep('DELETE', `/admin/groups/${a.id}/rate-multipliers`),
}

/** 用户动作表 / user actions */
export const USER_ACTIONS: ActionTable = {
  ...crudTable('admin/users'),
  balance: a => ep('POST', `/admin/users/${a.id}/balance`, { balance: a.balance, operation: a.operation ?? 'add' }),
  replace_group: a => ep('POST', `/admin/users/${a.id}/replace-group`, { group_id: a.group_id }),
  api_keys: a => ep('GET', `/admin/users/${a.id}/api-keys`),
  usage: a => ep('GET', `/admin/users/${a.id}/usage`),
  balance_history: a => ep('GET', `/admin/users/${a.id}/balance-history`),
}

/** 订阅动作表 / subscription actions */
export const SUB_ACTIONS: ActionTable = {
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
export const PAYMENT_ACTIONS: ActionTable = {
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
export const PROMO_ACTIONS: ActionTable = {
  ...crudTable('admin/promo-codes'),
  usages: a => ep('GET', `/admin/promo-codes/${a.id}/usages`),
}

/** 兑换码动作表 / redeem-code actions */
export const REDEEM_ACTIONS: ActionTable = {
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
export const ACCOUNT_ACTIONS: ActionTable = {
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
export function runTable(client: Sub2AdminClient, table: ActionTable, args: AdminArgs, exec: GateExec, tool: string): Promise<unknown> {
  const action = argString(args, 'action') ?? ''
  const build = table[action]
  if (build === undefined) throw new Error(`Unknown action: ${action}`)
  assertAllowedUnattended(tool, action, exec)
  const endpoint = build(args)
  return client.request(endpoint.method, endpoint.path, endpoint.body, endpoint.headers)
}
