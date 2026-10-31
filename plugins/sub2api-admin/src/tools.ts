/**
 * 工具目录：定义应用全部模型侧工具（overview + 七张动作表工具 + accounts +
 * usage + request 透传）。装配（index.ts）经 createAppTools 造出全名定义；
 * 动作 → 端点知识在 actions.ts，应用定义在 app-definition.ts。
 * The tool catalog: defines the app's full model-facing toolset (overview +
 * the seven table-driven tools + accounts + usage + the raw request
 * passthrough). The assembly (index.ts) builds the full-named definitions via
 * createAppTools; the action→endpoint knowledge lives in actions.ts and the
 * application definition in app-definition.ts.
 *
 * Successful writes refresh the matching store slice so pages update.
 * @module @veren/sub2api-admin/tools
 */
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { AdminArgs, GateExec, Sub2AdminClient } from './client.ts'
import { adminTool, argNumber, argObject, argString, idList, integer, numberParam, objParam, oneOf, str, toQuery } from './client.ts'
import type { Sub2ApiStore } from './store.ts'
import { assertRawAllowedUnattended } from './unattended.ts'
import { runTable } from './actions.ts'
import type { ActionTable } from './actions.ts'
import {
  ACCOUNT_ACTIONS, CHANNEL_ACTIONS, GROUP_ACTIONS, PAYMENT_ACTIONS,
  PROMO_ACTIONS, REDEEM_ACTIONS, SUB_ACTIONS, USER_ACTIONS,
} from './actions.ts'

// ---- store 切片刷新 / the store slice refresh ----

/** store 切片名 / one store slice name */
type SliceName = 'home' | 'channels' | 'groups' | 'users' | 'subscriptions' | 'finance' | 'codes' | 'accounts' | 'usage'

/** 刷新 store 切片（静默失败：页面数据是辅助面）/ refresh one store slice (silent) */
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
    tableTool(client, 'accounts', ACCOUNT_ACTIONS, ACCOUNT_DESC, () => slice('accounts')),
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

/** usage：用量分析（query → 路径的映射抽成小函数保持工具构造不超行）
 * / usage: analytics (the query→path mapping is a small helper so the tool
 * builder stays within the line budget) */
function usagePath(args: AdminArgs): string {
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
  return path
}

/** usage：用量分析 / usage: analytics */
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
    run: (args) => client.request('GET', usagePath(args)),
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
