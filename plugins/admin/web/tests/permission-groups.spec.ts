/**
 * Permission picker semantics: section assignment, per-section and global summaries,
 * and selection inversion.
 * 权限选择器语义：小节归属、逐节与全局汇总、以及反选。
 */
import { describe, expect, it } from 'vitest'
import { ADMIN_PERMISSIONS } from '@veren/admin-contract'

/** One rendered section. 一个渲染出的小节。 */
interface PermissionGroup {
  id: string
  labelKey: string
  permissions: readonly string[]
}

/** Section counts plus their totals. 小节计数与合计。 */
interface Summary {
  total: number
  selected: number
  groups: readonly { id: string; selected: number; total: number }[]
}

type GroupPermissions = (available: readonly string[]) => readonly PermissionGroup[]
type SelectionSummary = (groups: readonly PermissionGroup[], selected: readonly string[]) => Summary
type InvertSelection = (values: readonly string[], selected: readonly string[]) => readonly string[]

// `client/views.js` is browser JavaScript shipped as-is (no declaration file), so the
// test imports it dynamically and types only the pure helpers it exercises.
// `client/views.js` 是原样发布的浏览器 JavaScript（没有声明文件），因此测试动态引入它，
// 并只为用到的纯函数声明类型。
const viewsUrl = new URL('../client/views.js', import.meta.url).href
const { groupPermissions, selectionSummary, invertSelection } = await import(viewsUrl) as {
  groupPermissions: GroupPermissions
  selectionSummary: SelectionSummary
  invertSelection: InvertSelection
}

/** Every permission the platform defines. 平台定义的全部权限。 */
const ALL: string[] = Object.values(ADMIN_PERMISSIONS)

describe('groupPermissions', () => {
  it('places every catalog permission in exactly one section', () => {
    const groups = groupPermissions(ALL)
    const placed = groups.flatMap((group) => group.permissions)
    expect([...placed].sort()).toEqual([...ALL].sort())
    expect(new Set(placed).size).toBe(placed.length)
    expect(groups.every((group) => group.permissions.length > 0)).toBe(true)
  })

  it('keeps the declared section order and drops empty sections', () => {
    expect(groupPermissions(ALL).map((group) => group.id))
      .toEqual(['overview', 'identity', 'observe', 'system', 'terminal'])
    expect(groupPermissions(['terminal.tasks.decide']).map((group) => group.id)).toEqual(['terminal'])
    expect(groupPermissions([])).toEqual([])
  })

  it('sends a permission the catalog has never seen to the trailing other section', () => {
    const groups = groupPermissions([...ALL, 'custom.new.permission'])
    expect(groups.at(-1)).toMatchObject({ id: 'other', permissions: ['custom.new.permission'] })
  })
})

describe('selectionSummary', () => {
  const groups = groupPermissions(ALL)

  it('counts selections per section and in total', () => {
    const summary = selectionSummary(groups, ['admin.dashboard.read', 'admin.audit.read'])
    expect(summary.total).toBe(ALL.length)
    expect(summary.selected).toBe(2)
    expect(summary.groups).toEqual([
      { id: 'overview', selected: 1, total: 1 },
      { id: 'identity', selected: 0, total: 3 },
      { id: 'observe', selected: 1, total: 2 },
      { id: 'system', selected: 0, total: 2 },
      { id: 'terminal', selected: 0, total: 2 },
    ])
  })

  it('reports a fully selected section as complete and ignores unknown selections', () => {
    const summary = selectionSummary(groups, ['terminal.tasks.read', 'terminal.tasks.decide', 'unknown.permission'])
    expect(summary.groups.find((group) => group.id === 'terminal')).toEqual({ id: 'terminal', selected: 2, total: 2 })
    expect(summary.selected).toBe(2)
  })
})

describe('invertSelection', () => {
  it('returns the complement in the offered order', () => {
    expect(invertSelection(['a', 'b', 'c'], ['b'])).toEqual(['a', 'c'])
    expect(invertSelection(['a', 'b', 'c'], [])).toEqual(['a', 'b', 'c'])
    expect(invertSelection(['a', 'b', 'c'], ['a', 'b', 'c'])).toEqual([])
  })

  it('follows the permission list it is given', () => {
    expect(invertSelection(ALL, ['admin.dashboard.read'])).toHaveLength(ALL.length - 1)
  })
})
