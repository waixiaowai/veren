/**
 * 页面共享 store：Sub2API 运营数据的可订阅快照（getSnapshot 引用稳定）。
 * The page-shared store: a subscribable snapshot of Sub2API operations data.
 *
 * store 只存各 API 的原始返回（事实），页面树是纯派生；refresh* 在激活时与
 * 对应工具写入成功后触发。切片按页面划分：home/channels/groups/users/
 * subscriptions/finance/codes/accounts/usage。
 * The store keeps raw API payloads (facts); trees are pure derivations. Slices
 * map one-to-one to pages; refreshes run on activation and after tool writes.
 * @module @veren/sub2api-admin/store
 */
import type { Sub2AdminClient } from './client.ts'

/** Keyed 行：页面列表条目（id 必须字符串，由 pages 投影）/ keyed rows carry string ids */
export type Row = Record<string, unknown>

/** 经营/健康切片（首页指挥台）/ the home slice: money, health, todo signals */
export interface HomeSlice {
  stats?: Row
  payment?: Row
  availability?: Row
}

/** 资金切片（订单 + 套餐）/ the finance slice: orders + plans */
export interface FinanceSlice {
  orders?: Row[]
  plans?: Row[]
}

/** 卡密切片（兑换码 + 优惠码）/ the codes slice: redeem + promo */
export interface CodesSlice {
  redeem?: Row[]
  redeemStats?: Row
  promo?: Row[]
}

/** store 快照：全部页面共享的权威状态 / the snapshot shared by all pages */
export interface Sub2ApiState {
  home?: HomeSlice
  channels?: Row[]
  groups?: Row[]
  users?: Row[]
  subscriptions?: Row[]
  finance?: FinanceSlice
  codes?: CodesSlice
  accounts?: Row[]
  usage?: { range?: Row; trend?: Row[]; models?: Row[]; updatedAt?: string }
  error?: string
  updatedAt?: string
}

/** 从列表返回中取条目数组 / extract the item array from one list payload */
function itemsOf(payload: unknown): Row[] {
  const items = (payload as { items?: unknown })?.items
  return Array.isArray(items) ? items as Row[] : []
}

/** 从 trend/models 返回中取数组 / extract an array field from one payload */
function arrayOf(payload: unknown, field: string): Row[] {
  const value = (payload as Record<string, unknown>)?.[field]
  return Array.isArray(value) ? value as Row[] : []
}

export class Sub2ApiStore {
  private state: Sub2ApiState = {}
  private readonly listeners = new Set<() => void>()

  /** 当前快照（引用稳定）/ current snapshot (stable reference) */
  getSnapshot(): Sub2ApiState {
    return this.state
  }

  /** 订阅变更；返回退订函数 / subscribe; returns an unsubscribe */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** 刷新首页切片：大盘 + 支付经营 + 账号可用性 / refresh home: stats + payment + availability */
  async refreshHome(client: Sub2AdminClient): Promise<void> {
    const [stats, payment, availability] = await Promise.all([
      client.request('GET', '/admin/dashboard/stats'),
      client.request('GET', '/admin/payment/dashboard').catch(() => null),
      client.request('GET', '/admin/ops/account-availability').catch(() => null),
    ])
    this.patch({
      home: {
        stats: stats as Row,
        ...(payment === null ? {} : { payment: payment as Row }),
        ...(availability === null ? {} : { availability: availability as Row }),
      },
    })
  }

  /** 刷新渠道列表（前 50）/ refresh channels (first 50) */
  async refreshChannels(client: Sub2AdminClient): Promise<void> {
    this.patch({ channels: itemsOf(await client.request('GET', '/admin/channels?page=1&page_size=50')) })
  }

  /** 刷新分组（全量）/ refresh groups (all) */
  async refreshGroups(client: Sub2AdminClient): Promise<void> {
    const payload = await client.request('GET', '/admin/groups/all')
    this.patch({ groups: Array.isArray(payload) ? payload as Row[] : itemsOf(payload) })
  }

  /** 刷新用户列表（前 50）/ refresh users (first 50) */
  async refreshUsers(client: Sub2AdminClient): Promise<void> {
    this.patch({ users: itemsOf(await client.request('GET', '/admin/users?page=1&page_size=50')) })
  }

  /** 刷新订阅列表（前 50）/ refresh subscriptions (first 50) */
  async refreshSubscriptions(client: Sub2AdminClient): Promise<void> {
    this.patch({ subscriptions: itemsOf(await client.request('GET', '/admin/subscriptions?page=1&page_size=50')) })
  }

  /** 刷新资金切片：订单（前 20）+ 套餐 / refresh finance: orders (first 20) + plans */
  async refreshFinance(client: Sub2AdminClient): Promise<void> {
    const [orders, plans] = await Promise.all([
      client.request('GET', '/admin/payment/orders?page=1&page_size=20'),
      client.request('GET', '/admin/payment/plans'),
    ])
    this.patch({ finance: { orders: itemsOf(orders), plans: Array.isArray(plans) ? plans as Row[] : [] } })
  }

  /** 刷新卡密切片：兑换码（前 20）+ 统计 + 优惠码（前 20）/ refresh codes: redeem + stats + promo */
  async refreshCodes(client: Sub2AdminClient): Promise<void> {
    const [redeem, redeemStats, promo] = await Promise.all([
      client.request('GET', '/admin/redeem-codes?page=1&page_size=20'),
      client.request('GET', '/admin/redeem-codes/stats'),
      client.request('GET', '/admin/promo-codes?page=1&page_size=20'),
    ])
    this.patch({
      codes: {
        redeem: itemsOf(redeem),
        redeemStats: redeemStats as Row,
        promo: itemsOf(promo),
      },
    })
  }

  /** 刷新账号列表（前 50）/ refresh accounts (first 50) */
  async refreshAccounts(client: Sub2AdminClient): Promise<void> {
    this.patch({ accounts: itemsOf(await client.request('GET', '/admin/accounts?page=1&page_size=50')) })
  }

  /** 刷新用量：今日汇总 + 近 7 日趋势 + 模型维度 / refresh usage: range, 7-day trend, per-model */
  async refreshUsage(client: Sub2AdminClient): Promise<void> {
    const today = new Date().toISOString().slice(0, 10)
    const weekAgo = new Date(Date.now() - 6 * 86_400_000).toISOString().slice(0, 10)
    const query = `start_date=${weekAgo}&end_date=${today}`
    const [range, trend, models] = await Promise.all([
      client.request('GET', `/admin/usage/stats?${query}`),
      client.request('GET', `/admin/dashboard/trend?${query}&granularity=day`),
      client.request('GET', `/admin/dashboard/models?${query}`),
    ])
    this.patch({
      usage: {
        range: range as Row,
        trend: arrayOf(trend, 'trend'),
        models: arrayOf(models, 'models'),
        updatedAt: new Date().toISOString(),
      },
    })
  }

  /** 用户留存切片并入 usage 返回的辅助读取（近 7 日新增/活跃趋势）/ retention rows read helper */
  async refreshRetention(client: Sub2AdminClient): Promise<void> {
    const today = new Date().toISOString().slice(0, 10)
    const weekAgo = new Date(Date.now() - 6 * 86_400_000).toISOString().slice(0, 10)
    const trend = await client.request('GET', `/admin/dashboard/users-trend?start_date=${weekAgo}&end_date=${today}&granularity=day`)
    const usage = this.state.usage ?? {}
    this.patch({ usage: { ...usage, trend: arrayOf(trend, 'trend'), updatedAt: new Date().toISOString() } })
  }

  /** 全量刷新（激活时调用）；单切片失败记入 error，不吞掉其他切片 / refresh all; one failure records error */
  async refreshAll(client: Sub2AdminClient): Promise<void> {
    const results = await Promise.allSettled([
      this.refreshHome(client),
      this.refreshChannels(client),
      this.refreshGroups(client),
      this.refreshUsers(client),
      this.refreshSubscriptions(client),
      this.refreshFinance(client),
      this.refreshCodes(client),
      this.refreshAccounts(client),
      this.refreshUsage(client),
    ])
    const failed = results.find(result => result.status === 'rejected') as PromiseRejectedResult | undefined
    if (failed !== undefined) {
      this.patch({ error: String(failed.reason instanceof Error ? failed.reason.message : failed.reason) })
    }
  }

  /** 不可变合并 + 通知 / immutable merge + notify */
  private patch(partial: Partial<Sub2ApiState>): void {
    this.state = { ...this.state, ...partial, updatedAt: new Date().toISOString() }
    this.notify()
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener()
  }
}
