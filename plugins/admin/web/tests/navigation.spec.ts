/**
 * Sidebar grouping: a flat navigation list folds into semantic sections, and an
 * unknown path still reaches the operator through the "general" section.
 * 侧栏分组：扁平导航列表折叠成语义分组，未知路径仍通过「通用」分组抵达操作者。
 */
import { describe, expect, it } from 'vitest'

/** One navigation node as the host sends it. 宿主发送的单个导航节点。 */
interface NavNode {
  id: string
  path: string
  labelKey: string
}

/** One rendered section. 一个渲染出的分组。 */
interface NavSection {
  id: string
  labelKey: string
  nodes: readonly NavNode[]
}

type GroupNavigation = (nav: readonly NavNode[]) => readonly NavSection[]

// `client/views.js` is browser JavaScript shipped as-is (no declaration file), so
// the test imports it dynamically and types the one function it exercises.
// `client/views.js` 是原样发布的浏览器 JavaScript（没有声明文件），因此测试动态引入它，
// 并只为用到的那一个函数声明类型。
const viewsUrl = new URL('../client/views.js', import.meta.url).href
const { groupNavigation } = await import(viewsUrl) as { groupNavigation: GroupNavigation }

const NAV: readonly NavNode[] = [
  { id: 'dashboard', path: '/', labelKey: 'nav.dashboard' },
  { id: 'users', path: '/users', labelKey: 'nav.users' },
  { id: 'roles', path: '/roles', labelKey: 'nav.roles' },
  { id: 'audit', path: '/audit', labelKey: 'nav.audit' },
  { id: 'capabilities', path: '/system/capabilities', labelKey: 'nav.capabilities' },
]

describe('groupNavigation', () => {
  it('folds the default navigation into four sections in display order', () => {
    const sections = groupNavigation(NAV)
    expect(sections.map((section) => section.id)).toEqual(['overview', 'access', 'observability', 'system'])
    expect(sections.map((section) => section.nodes.map((node) => node.id))).toEqual([
      ['dashboard'],
      ['users', 'roles'],
      ['audit'],
      ['capabilities'],
    ])
    expect(sections.every((section) => section.labelKey.startsWith('nav.section.'))).toBe(true)
  })

  it('keeps a path the shell does not know in the general section', () => {
    const sections = groupNavigation([...NAV, { id: 'extra', path: '/extra', labelKey: 'nav.extra' }])
    const general = sections.at(-1)
    expect(general).toMatchObject({ id: 'general', labelKey: 'nav.section.general' })
    expect(general?.nodes.map((node) => node.id)).toEqual(['extra'])
  })

  it('drops empty sections and tolerates a missing list', () => {
    expect(groupNavigation([{ id: 'dashboard', path: '/', labelKey: 'nav.dashboard' }]).map((section) => section.id))
      .toEqual(['overview'])
    expect(groupNavigation([])).toEqual([])
  })

  it('does not treat the root path as a prefix of every route', () => {
    const sections = groupNavigation([{ id: 'users', path: '/users', labelKey: 'nav.users' }])
    expect(sections.map((section) => section.id)).toEqual(['access'])
  })
})
