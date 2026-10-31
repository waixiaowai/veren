/** @jsxRuntime automatic @jsxImportSource @veren/prompt-core */
/**
 * 五个通用列表页（渠道/分组/用户/订阅/账号）：一张静态配置表 + 一个
 * `listPage` 工厂产出 { Page, Meta } 对。页面结构统一：标题 + 配套工具行 +
 * 错误位 + keyed 列表；每页的差异只有配置（url/说明/工具/取数切片/无人值守契约）。
 * The five generic list pages (channels/groups/users/subscriptions/accounts):
 * one static config table plus a `listPage` factory producing { Page, Meta }
 * pairs. The page shape is uniform — header + tool line + error slot + keyed
 * list; pages differ only in config (url/instructions/tools/store slice/
 * unattended contract).
 *
 * @module @veren/sub2api-admin/page-lists
 */
import type { ComponentPageMeta, PageFC } from '@veren/prompt-page'
import type { Sub2ApiState } from './store.ts'
import { externalName, readState, registerTools, rowsOf, URL_PREFIX } from './page-runtime.ts'

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
  /** 无人值守契约（docs/unattended-page-contract.cn.md §2）/ the unattended contract */
  readonly unattended: ComponentPageMeta['unattended']
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
    writes: true,
    unattended: config.unattended,
  }
  return { Page, Meta }
}

/** 渠道管理页 / the channels page */
const channels = listPage({
  name: 'channels',
  url: `${URL_PREFIX}/channels`,
  description: '渠道管理页：上游渠道列表，支持开通（create）/编辑（update）/下架（delete）',
  title: 'Sub2API 运营 · 渠道管理',
  instructions: '渠道经 channels 列表同步。用 channels 工具：create/update 传 payload（字段先 GET 一条对照）；delete 下架（可重建，L1 自主执行）。'
    + '渠道测活/监控用 request 工具走 /admin/channel-monitors 端点（本页已挂载该透传工具；非 GET 无人值守会被拒）。'
    + '写成功后用一句话点名产物（渠道 id 与关键字段前后值）回报。',
  tools: ['channels', 'request'],
  pick: state => state.channels ?? [],
  unattended: {
    serves: '渠道开通/改配/下架类投递任务与盘面问询',
    level: 'L1',
    evidence: '一句话点名渠道 id 与字段前后值（工具返回值）',
    escape: '上游不可达时如实回报 SUB2API_* 错误并停在该任务，不悬置不重试轰炸',
  },
})
export const ChannelsPage = channels.Page
export const ChannelsMeta = channels.Meta

/** 分组管理页 / the groups page */
const groups = listPage({
  name: 'groups',
  url: `${URL_PREFIX}/groups`,
  description: '分组管理页：分组列表（倍率/平台/订阅类型/限额），创建/编辑/删除/模型倍率批量设置',
  title: 'Sub2API 运营 · 分组管理',
  instructions: '分组经 groups 列表同步（含 rate_multiplier/subscription_type/daily_limit_usd）。'
    + '用 groups 工具：create/update 传 payload；set_rates（id+payload，如 {"gpt-4":1.5}）批量设模型倍率；clear_rates 清除；delete 可重建（L1 自主执行）。'
    + '绑定账号在 accounts 页改账号的 group_ids。写成功后用一句话点名分组 id 与变更字段回报。',
  tools: ['groups'],
  pick: state => state.groups ?? [],
  unattended: {
    serves: '分组创建/倍率调整类投递任务与盘面问询',
    level: 'L1',
    evidence: '一句话点名分组 id 与倍率/限额前后值（工具返回值）',
    escape: '上游不可达时如实回报 SUB2API_* 错误并停在该任务，不悬置不重试轰炸',
  },
})
export const GroupsPage = groups.Page
export const GroupsMeta = groups.Meta

/** 用户管理页 / the users page */
const users = listPage({
  name: 'users',
  url: `${URL_PREFIX}/users`,
  description: '用户管理页：用户列表（余额/分组/状态），开通、充值/扣减、封禁、换组',
  title: 'Sub2API 运营 · 用户管理',
  instructions: '用户经 users 列表同步（含 balance/status/allowed_groups）。用 users 工具：'
    + 'create（payload {"email","password"}）开通；balance（id,balance,operation add|subtract|set）充值/扣减——扣减带 idempotency_key 防重放；'
    + 'update（fields {"status":"banned"}）封禁（可解封，L1）；replace_group 换组；api_keys/usage/balance_history 查明细。'
    + '订阅分配在 subscriptions 页。写成功后用一句话点名用户 id 与余额/状态前后值回报。',
  tools: ['users'],
  pick: state => state.users ?? [],
  unattended: {
    serves: '开通/充值/封禁/换组类投递任务与盘面问询',
    level: 'L1',
    evidence: '一句话点名用户 id 与余额/状态前后值（工具返回值）',
    escape: '上游不可达时如实回报 SUB2API_* 错误并停在该任务；扣减类改动带 idempotency_key 可安全重试',
  },
})
export const UsersPage = users.Page
export const UsersMeta = users.Meta

/** 订阅管理页 / the subscriptions page */
const subscriptions = listPage({
  name: 'subscriptions',
  url: `${URL_PREFIX}/subscriptions`,
  description: '订阅管理页：用户订阅列表，分配/续期/重置额度/撤销/恢复',
  title: 'Sub2API 运营 · 订阅管理',
  instructions: '订阅经 subscriptions 列表同步。用 subscriptions 工具：assign/bulk_assign（payload）分配；'
    + 'extend（id+payload {"days":30}）续期；reset_quota 重置额度；revoke/restore 撤销/恢复（互为反向，L1 自主执行）；progress 看进度；'
    + 'by_user/by_group 按用户/分组查。套餐 CRUD 在 finance 页。写成功后用一句话点名订阅 id 与状态前后值回报。',
  tools: ['subscriptions'],
  pick: state => state.subscriptions ?? [],
  unattended: {
    serves: '订阅分配/续期/撤销类投递任务与盘面问询',
    level: 'L1',
    evidence: '一句话点名订阅 id 与状态/额度前后值（工具返回值）',
    escape: 'revoke 误操作用 restore 即时回退；上游不可达时如实回报 SUB2API_* 错误并停在该任务',
  },
})
export const SubscriptionsPage = subscriptions.Page
export const SubscriptionsMeta = subscriptions.Meta

/** 账号管理页 / the accounts page */
const accounts = listPage({
  name: 'accounts',
  url: `${URL_PREFIX}/accounts`,
  description: '账号管理页：上游账号列表（平台/类型/状态/可调度），状态/调度/清错/配额/批量运维',
  title: 'Sub2API 运营 · 账号管理',
  instructions: '账号经 accounts 列表同步。用 accounts 工具做查询与运维：'
    + 'set_status/set_schedulable/clear_error/clear_rate_limit/reset_quota/refresh/test/bulk_update——全部是可逆状态翻转（L1 自主执行）。'
    + '异常账号清错用 clear_error；停用用 set_status {"status":"paused"}。写成功后用一句话点名账号 id 与状态前后值回报。',
  tools: ['accounts'],
  pick: state => state.accounts ?? [],
  unattended: {
    serves: '异常账号清错/停用/调度翻转类投递任务（首页待办的主出口）',
    level: 'L1',
    evidence: '一句话点名账号 id 与状态前后值（工具返回值）',
    escape: '全部动作可逆（set_status/set_schedulable 翻回即回滚）；上游不可达时如实回报 SUB2API_* 错误并停在该任务',
  },
})
export const AccountsPage = accounts.Page
export const AccountsMeta = accounts.Meta
