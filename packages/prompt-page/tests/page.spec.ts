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
import type { PageDefinition, PageLiveBinding } from '../src/types.ts'

/**
 * 注册面要求 live 必填（组件页是唯一生产形态）；本文件的用例只测目录/匹配契约，
 * 不挂会话，用占位 live 即可。
 * The registrar demands a live binding (component pages are the only production
 * shape); these cases only exercise catalog/matching contracts and never mount
 * a session, so a placeholder live is enough.
 */
const stubLive: PageLiveBinding = { mount: () => { throw new Error('not mounted in this spec') } }

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
    registry.register(ListPage, stubLive)
    registry.register(DetailPage, stubLive)

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
    const dispose = registry.register(ListPage, stubLive)
    expect(registry.catalog()).toEqual([{ name: 'list', url: '/task-list', description: '任务列表页' }])
    dispose()
    expect(registry.catalog()).toEqual([])
    expect(registry.resolve('/task-list')).toBeNull()
  })

  it('重名/URL 模式冲突 fail loud', () => {
    const registry = new PageRegistry()
    registry.register(ListPage, stubLive)
    expect(() => registry.register(ListPage, stubLive)).toThrow(/duplicate page name/)
    expect(() => registry.register(DetailPage, stubLive)).not.toThrow()
    expect(() => registry.register({
      ...ListPage, name: 'list2', url: '/task-list/',
    }, stubLive)).toThrow(/duplicate page url/)
  })

  it('缺 live 的注册 fail loud（页面 = 组件页，无静态页形态）', () => {
    const registry = new PageRegistry()
    expect(() => registry.register(ListPage, undefined as never)).toThrow(/live binding/)
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
