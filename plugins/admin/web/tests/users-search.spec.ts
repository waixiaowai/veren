/**
 * Users page search semantics: keyword filtering over email and name.
 * 用户页检索语义：按邮箱与姓名做关键字过滤。
 */
import { describe, expect, it } from 'vitest'

/** One user shape the filter reads. 过滤器读取的用户形状。 */
interface FilterableUser {
  id: string
  email?: string
  name?: string
}

/** The browser module's exported filter, typed at the import boundary. */
type FilterUsers = (users: readonly FilterableUser[], query?: string | null) => readonly FilterableUser[]

// `client/views.js` is browser JavaScript shipped as-is (no declaration file), so
// the test imports it dynamically and types the one function it exercises.
// `client/views.js` 是原样发布的浏览器 JavaScript（没有声明文件），因此测试动态引入它，
// 并只为用到的那一个函数声明类型。
const viewsUrl = new URL('../client/views.js', import.meta.url).href
const { filterUsers } = await import(viewsUrl) as { filterUsers: FilterUsers }

const USERS: readonly FilterableUser[] = [
  { id: 'u1', email: 'alice@example.com', name: 'Alice Chen' },
  { id: 'u2', email: 'bob@example.com', name: 'Bob Li' },
  { id: 'u3', email: 'carol@corp.test', name: 'Carol Wang' },
]

describe('filterUsers', () => {
  it('matches the email as a case-insensitive substring', () => {
    expect(filterUsers(USERS, 'ALICE@').map((user) => user.id)).toEqual(['u1'])
    expect(filterUsers(USERS, 'example.com').map((user) => user.id)).toEqual(['u1', 'u2'])
  })

  it('matches the name as a case-insensitive substring', () => {
    expect(filterUsers(USERS, 'bob').map((user) => user.id)).toEqual(['u2'])
    expect(filterUsers(USERS, ' wang ').map((user) => user.id)).toEqual(['u3'])
  })

  it('keeps every user for an empty, blank or missing keyword', () => {
    expect(filterUsers(USERS, '')).toHaveLength(3)
    expect(filterUsers(USERS, '   ')).toHaveLength(3)
    expect(filterUsers(USERS, null)).toHaveLength(3)
    expect(filterUsers(USERS, undefined)).toHaveLength(3)
  })

  it('returns no user when nothing matches', () => {
    expect(filterUsers(USERS, 'zzz')).toEqual([])
  })

  it('tolerates a user without a name', () => {
    const users = [{ id: 'u9', email: 'solo@example.com' }]
    expect(filterUsers(users, 'solo').map((user) => user.id)).toEqual(['u9'])
    expect(filterUsers(users, 'nobody')).toEqual([])
  })
})
