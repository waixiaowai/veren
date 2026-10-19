/**
 * Audit page search semantics: keyword filtering over action, actor, target and result.
 * 审计页检索语义：按操作类型、操作者、对象与结果做关键字过滤。
 */
import { describe, expect, it } from 'vitest'

/** One audit entry shape the filter reads. 过滤器读取的审计记录形状。 */
interface FilterableEntry {
  id: string
  action?: string
  actorLabel?: string
  actorId?: string
  target?: string
  result?: string
}

/** The browser module's exported filter, typed at the import boundary. */
type FilterAudit = (items: readonly FilterableEntry[], query?: string | null) => readonly FilterableEntry[]

// `client/views.js` is browser JavaScript shipped as-is (no declaration file), so
// the test imports it dynamically and types the one function it exercises.
// `client/views.js` 是原样发布的浏览器 JavaScript（没有声明文件），因此测试动态引入它，
// 并只为用到的那一个函数声明类型。
const viewsUrl = new URL('../client/views.js', import.meta.url).href
const { filterAudit } = await import(viewsUrl) as { filterAudit: FilterAudit }

const ENTRIES: readonly FilterableEntry[] = [
  { id: 'a1', action: 'users.create', actorLabel: 'Admin', actorId: 'u1', target: 'alice@example.com', result: 'success' },
  { id: 'a2', action: 'roles.update', actorLabel: 'Alice Chen', actorId: 'u2', target: 'support', result: 'failure' },
  { id: 'a3', action: 'auth.login', actorLabel: 'Bob Li', actorId: 'u3', target: '', result: 'success' },
]

describe('filterAudit', () => {
  it('matches the action as a case-insensitive substring', () => {
    expect(filterAudit(ENTRIES, 'USERS.').map((entry) => entry.id)).toEqual(['a1'])
    expect(filterAudit(ENTRIES, 'roles').map((entry) => entry.id)).toEqual(['a2'])
  })

  it('matches the actor label and id', () => {
    // `chen` appears only in a2's actor label, while `alice` would also hit a1's target.
    // `chen` 只出现在 a2 的操作者名里，而 `alice` 还会命中 a1 的对象字段。
    expect(filterAudit(ENTRIES, 'CHEN').map((entry) => entry.id)).toEqual(['a2'])
    expect(filterAudit(ENTRIES, 'u3').map((entry) => entry.id)).toEqual(['a3'])
  })

  it('matches the target and the result', () => {
    expect(filterAudit(ENTRIES, 'example.com').map((entry) => entry.id)).toEqual(['a1'])
    expect(filterAudit(ENTRIES, 'failure').map((entry) => entry.id)).toEqual(['a2'])
  })

  it('keeps every entry for an empty, blank or missing keyword', () => {
    expect(filterAudit(ENTRIES, '')).toHaveLength(3)
    expect(filterAudit(ENTRIES, '   ')).toHaveLength(3)
    expect(filterAudit(ENTRIES, null)).toHaveLength(3)
    expect(filterAudit(ENTRIES, undefined)).toHaveLength(3)
  })

  it('returns no entry when nothing matches', () => {
    expect(filterAudit(ENTRIES, 'zzz')).toEqual([])
  })
})
