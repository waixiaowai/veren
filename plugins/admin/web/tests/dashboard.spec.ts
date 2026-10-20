/**
 * Dashboard summaries: the KPI numbers must be derived from the loaded payloads,
 * not guessed, and the audit window must admit when it was exhausted.
 * 仪表盘汇总：KPI 数字必须由已加载载荷推导，审计窗口占满时必须如实标注。
 */
import { describe, expect, it } from 'vitest'

/** One user as the list payload returns it. 列表载荷中的单个用户。 */
interface UserView {
  id: string
  active?: boolean
}

/** One capability state as the catalog returns it. 能力目录中的单个状态。 */
interface CapabilityState {
  capability: string
  active?: { id: string } | null
}

/** One audit entry as the page returns it. 审计页中的单条记录。 */
interface AuditEntry {
  id: string
  action: string
  at: string
}

type SummarizeUsers = (users: { items?: readonly UserView[] } | null) => { total: number; active: number; inactive: number }
type SummarizeCapabilities = (catalog: { capabilities?: readonly CapabilityState[] } | null) => {
  ready: number
  total: number
  states: readonly CapabilityState[]
}
type AuditSummary = (
  page: { items?: readonly AuditEntry[] } | null,
  options: { now: Date; limit: number },
) => { items: readonly AuditEntry[]; latest: AuditEntry | undefined; today: number; truncated: boolean }

// `client/views.js` is browser JavaScript shipped as-is (no declaration file), so the
// test imports it dynamically and types only the pure helpers it exercises.
// `client/views.js` 是原样发布的浏览器 JavaScript（没有声明文件），因此测试动态引入它，
// 并只为用到的纯函数声明类型。
const viewsUrl = new URL('../client/views.js', import.meta.url).href
const { summarizeUsers, summarizeCapabilities, auditSummary } = await import(viewsUrl) as {
  summarizeUsers: SummarizeUsers
  summarizeCapabilities: SummarizeCapabilities
  auditSummary: AuditSummary
}

/** Noon on a fixed local day, so "today" is unambiguous. 固定本地日的正午，使「今日」无歧义。 */
const NOW = new Date('2026-10-20T12:00:00')

describe('summarizeUsers', () => {
  it('splits the list into active and inactive counts', () => {
    expect(summarizeUsers({ items: [{ id: 'a', active: true }, { id: 'b', active: false }, { id: 'c' }] }))
      .toEqual({ total: 3, active: 1, inactive: 2 })
  })

  it('tolerates an absent payload', () => {
    expect(summarizeUsers(null)).toEqual({ total: 0, active: 0, inactive: 0 })
  })
})

describe('summarizeCapabilities', () => {
  it('counts capabilities that have an active provider and keeps the states', () => {
    const summary = summarizeCapabilities({
      capabilities: [
        { capability: 'data', active: { id: 'pg' } },
        { capability: 'settings', active: null },
        { capability: 'auth' },
      ],
    })
    expect(summary).toMatchObject({ ready: 1, total: 3 })
    expect(summary.states).toHaveLength(3)
  })

  it('tolerates an absent catalog', () => {
    expect(summarizeCapabilities(null)).toEqual({ ready: 0, total: 0, states: [] })
  })
})

describe('auditSummary', () => {
  const page = {
    items: [
      { id: '1', action: 'roles.update', at: '2026-10-20T11:00:00' },
      { id: '2', action: 'users.create', at: '2026-10-20T09:00:00' },
      { id: '3', action: 'auth.login', at: '2026-10-19T23:00:00' },
    ],
  }

  it('counts only entries from the local day and keeps the newest first', () => {
    const summary = auditSummary(page, { now: NOW, limit: 200 })
    expect(summary.today).toBe(2)
    expect(summary.latest?.id).toBe('1')
    expect(summary.truncated).toBe(false)
  })

  it('marks the count as truncated when the window is full and still on today', () => {
    const full = {
      items: [
        { id: '1', action: 'a', at: '2026-10-20T11:00:00' },
        { id: '2', action: 'b', at: '2026-10-20T10:00:00' },
      ],
    }
    expect(auditSummary(full, { now: NOW, limit: 2 }).truncated).toBe(true)
    expect(auditSummary(full, { now: NOW, limit: 10 }).truncated).toBe(false)
  })

  it('reports an empty window without inventing numbers', () => {
    const summary = auditSummary({ items: [] }, { now: NOW, limit: 200 })
    expect(summary).toMatchObject({ today: 0, truncated: false, latest: undefined })
    expect(auditSummary(null, { now: NOW, limit: 200 }).items).toEqual([])
  })
})
