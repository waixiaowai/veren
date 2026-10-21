/**
 * PageRegistry / definePage 契约测试（减法后）：URL 匹配、目录、fail loud 校验。
 * PageRegistry / definePage contract tests (after the subtraction): url
 * matching, the catalog, fail-loud validation.
 *
 * mountPage 的块宿主测试已随块管线删除；组件页的会话行为见 component.spec.ts。
 * The mountPage block-host tests died with the block pipeline; component-page
 * session behavior lives in component.spec.ts.
 */
import { describe, expect, it } from 'vitest'
import { definePage, formatPath, matchPath, normalizePath, PageRegistry, splitUrl } from '../src/index.ts'
import type { PageDefinition } from '../src/types.ts'

const ListPage: PageDefinition<never> = definePage({
  name: 'list',
  url: '/task-list',
  description: '任务列表页',
})

const DetailPage: PageDefinition<never> = definePage({
  name: 'detail',
  url: '/task-detail/:taskId',
  description: '任务详情页',
})

describe('url matching', () => {
  it('normalizePath / splitUrl', () => {
    expect(normalizePath('/a/b/')).toBe('/a/b')
    expect(normalizePath('a')).toBe('/a')
    const { path, query } = splitUrl('/task-detail/t-1?focus=chat&focus=2')
    expect(path).toBe('/task-detail/t-1')
    expect(query.get('focus')).toBe('chat')
  })

  it('matchPath：:param 捕获 + 解码；静态不符/段数不符 → null', () => {
    expect(matchPath('/task-detail/:taskId', '/task-detail/t-12')).toEqual({ taskId: 't-12' })
    expect(matchPath('/task-detail/:taskId', '/task-detail/a%20b')).toEqual({ taskId: 'a b' })
    expect(matchPath('/task-detail/:taskId', '/task-list')).toBeNull()
    expect(matchPath('/a', '/a/b')).toBeNull()
    expect(matchPath('/a/:x/c', '/a/1/c')).toEqual({ x: '1' })
  })

  it('formatPath：参数实例化 + 编码', () => {
    expect(formatPath('/task-detail/:taskId', { taskId: 't-12' })).toBe('/task-detail/t-12')
    expect(formatPath('/task-detail/:taskId', { taskId: 'a b' })).toBe('/task-detail/a%20b')
  })
})

describe('PageRegistry', () => {
  it('resolve：路径参数 + query 合并（path 优先），返回规范化 URL', () => {
    const registry = new PageRegistry()
    registry.register(ListPage)
    registry.register(DetailPage)

    const miss = registry.resolve('/task-list')
    expect(miss?.page.name).toBe('list')
    expect(miss?.params).toEqual({})

    const hit = registry.resolve('/task-detail/t-9?taskId=override&focus=chat')
    expect(hit?.page.name).toBe('detail')
    expect(hit?.params).toEqual({ taskId: 't-9', focus: 'chat' }) // path 优先
    expect(hit?.url).toBe('/task-detail/t-9?focus=chat')

    expect(registry.resolve('/nope')).toBeNull()
  })

  it('catalog 与 disposer（HMR/卸载安全）', () => {
    const registry = new PageRegistry()
    const dispose = registry.register(ListPage)
    expect(registry.catalog()).toEqual([{ name: 'list', url: '/task-list', description: '任务列表页' }])
    dispose()
    expect(registry.catalog()).toEqual([])
    expect(registry.resolve('/task-list')).toBeNull()
  })

  it('重名/URL 模式冲突 fail loud', () => {
    const registry = new PageRegistry()
    registry.register(ListPage)
    expect(() => registry.register(ListPage)).toThrow(/duplicate page name/)
    expect(() => registry.register(DetailPage)).not.toThrow()
    expect(() => registry.register({
      ...ListPage, name: 'list2', url: '/task-list/',
    })).toThrow(/duplicate page url/)
  })
})

describe('definePage', () => {
  it('misconfiguration fails loud：空名/空描述/坏 URL/重复 :param', () => {
    expect(() => definePage({ name: '', url: '/a', description: 'x' })).toThrow()
    expect(() => definePage({ name: 'p', url: '/a', description: '' })).toThrow()
    expect(() => definePage({ name: 'p', url: 'a/b', description: 'x' })).toThrow()
    expect(() => definePage({ name: 'p', url: '/a?b=1', description: 'x' })).toThrow()
    expect(() => definePage({ name: 'p', url: '/a/:x/:x', description: 'x' })).toThrow()
    expect(() => definePage({ name: 'p', url: '/a/:', description: 'x' })).toThrow()
  })
})
