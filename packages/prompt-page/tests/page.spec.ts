import { describe, expect, it } from 'vitest'
import { createElement } from '@veren/prompt-core'
import { definePage, formatPath, matchPath, mountPage, normalizePath, PageRegistry, splitUrl } from '../src/index.ts'
import type { PageDefinition } from '../src/types.ts'

interface AppState {
  items: { id: string; title: string }[]
}

function makeStore(initial: AppState) {
  let state = initial
  const listeners = new Set<() => void>()
  return {
    getState: () => state,
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    set(next: AppState): void {
      state = next
      for (const listener of listeners) listener()
    },
  }
}

const ListPage: PageDefinition<AppState> = definePage({
  name: 'list',
  url: '/task-list',
  description: '任务列表页',
  tree: (_params, state) => state.items.map((item) =>
    createElement('item', { key: item.id, path: 'tasks', value: item })),
})

const DetailPage: PageDefinition<AppState> = definePage({
  name: 'detail',
  url: '/task-detail/:taskId',
  description: '任务详情页',
  tree: (params, state) => {
    const task = state.items.find((item) => item.id === params.taskId)
    return [
      createElement('static', { content: `详情 ${params.taskId}` }),
      createElement('data', { key: 'title', path: 'task.title', value: task?.title ?? null }),
    ]
  },
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
    const registry = new PageRegistry<AppState>()
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
    const registry = new PageRegistry<AppState>()
    const dispose = registry.register(ListPage)
    expect(registry.catalog()).toEqual([{ name: 'list', url: '/task-list', description: '任务列表页' }])
    dispose()
    expect(registry.catalog()).toEqual([])
    expect(registry.resolve('/task-list')).toBeNull()
  })

  it('重名/URL 模式冲突 fail loud', () => {
    const registry = new PageRegistry<AppState>()
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
    expect(() => definePage({ name: '', url: '/a', description: 'x', tree: () => [] })).toThrow()
    expect(() => definePage({ name: 'p', url: '/a', description: '', tree: () => [] })).toThrow()
    expect(() => definePage({ name: 'p', url: 'a/b', description: 'x', tree: () => [] })).toThrow()
    expect(() => definePage({ name: 'p', url: '/a?b=1', description: 'x', tree: () => [] })).toThrow()
    expect(() => definePage({ name: 'p', url: '/a/:x/:x', description: 'x', tree: () => [] })).toThrow()
    expect(() => definePage({ name: 'p', url: '/a/:', description: 'x', tree: () => [] })).toThrow()
  })
})

describe('mountPage', () => {
  it('一页一会话：指针消息携带具体 URL，状态变化自动渲染', () => {
    const store = makeStore({ items: [{ id: 'a', title: 'A' }] })
    const session = mountPage({ page: ListPage, store })
    expect(session.pointerMessage).toBe('OPEN /task-list {}')
    expect(session.syncText()).toContain('"items":[{"id":"a","title":"A"}]')

    const v0 = session.version
    store.set({ items: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }] })
    expect(session.version).toBeGreaterThan(v0)
    expect(session.syncText(v0)).toContain('"id":"b"')
    session.unsubscribe()
    store.set({ items: [] })
    expect(session.version).toBe(2)
  })

  it('props 指针参与组件树：详情页按路径参数取数', () => {
    const store = makeStore({ items: [{ id: 't-9', title: '九' }] })
    const session = mountPage({ page: DetailPage, store, params: { taskId: 't-9' } })
    expect(session.pointerMessage).toBe('OPEN /task-detail/t-9 {"taskId":"t-9"}')
    expect(session.syncText()).toContain('详情 t-9')
    expect(session.syncText()).toContain('"value":"九"')
    session.unsubscribe()
  })
})
