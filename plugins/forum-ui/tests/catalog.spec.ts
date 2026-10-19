/**
 * The forum page catalog's read lifecycle.
 *
 * The page has one authority for its boards, posts, and presets. These specs
 * pin what is externally visible: a read on the first subscriber, a slow poll
 * while mounted, a write-triggered refresh that carries the new query, the
 * discipline that drops a superseded or post-teardown read, and an error state
 * that never discards the last good catalog.
 *
 * 论坛页目录的读取生命周期。
 *
 * 页面的板块、帖子和预设只有一个权威来源。这些测试钉住对外可见的行为：首个订阅者触发读取、
 * 挂载期间按慢节拍轮询、写入后带新查询的重读、丢弃被取代或拆卸后返回的读取，以及永不丢弃
 * 上一次成功目录的错误状态。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createForumCatalog, messageOf, readAutoPost, readInbox, readPost } from '../src/client/catalog.ts'
import type {
  CatalogView,
  ForumRemoteApi,
  ForumRemoteResult,
  PostDetailView,
  PostView,
} from '../src/client/remote.ts'

/**
 * The catalog read is the only endpoint these specs drive; the rest of the
 * namespace stays absent on purpose so an accidental call fails loudly.
 * 这些测试只驱动目录读取；命名空间的其余端点故意留空，误调用会立刻失败。
 */
function api(catalog: ForumRemoteApi['catalog']): ForumRemoteApi {
  return { catalog } as unknown as ForumRemoteApi
}

/** One board row. 一条板块行。 */
function board(over: Partial<CatalogView['boards'][number]> = {}): CatalogView['boards'][number] {
  return { id: 'b1', path: '/workspace', title: 'General', postCount: 0, ...over }
}

/** One post row. 一条帖子行。 */
function post(over: Partial<PostView> = {}): PostView {
  return {
    id: 'p1',
    boardId: 'b1',
    author: 'ada',
    title: 'Hello',
    excerpt: '',
    tags: [],
    mentions: [],
    pinned: false,
    views: 0,
    up: 0,
    down: 0,
    commentCount: 0,
    heat: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

/** One catalog read result. 一次目录读取结果。 */
function catalogView(over: Partial<CatalogView> = {}): CatalogView {
  return { boards: [board()], posts: [post()], people: [], ...over }
}

/** A successful Remote result. 成功的远端结果。 */
function ok<T>(value: T): ForumRemoteResult<T> {
  return { ok: true, value }
}

/** A refused Remote result. 被拒绝的远端结果。 */
function refused(message: string): ForumRemoteResult<never> {
  return { ok: false, error: { code: 'forum/refused', message } }
}

/** Let the read's promise chain settle without moving the clock. 在不推进时钟的情况下让读取链落定。 */
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0)
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('forum catalog / 论坛目录', () => {
  it('reads once on the first subscriber and polls while mounted', async () => {
    const read = vi.fn(async () => ok(catalogView()))
    const catalog = createForumCatalog(api(read))
    const off = catalog.source.subscribe(() => {})

    expect(catalog.source.getSnapshot()).toMatchObject({ status: 'loading', settled: false })
    await settle()
    expect(read).toHaveBeenCalledTimes(1)
    expect(catalog.source.getSnapshot()).toMatchObject({ status: 'ready', settled: true })

    await vi.advanceTimersByTimeAsync(10_000)
    expect(read).toHaveBeenCalledTimes(2)

    off()
  })

  it('shares one in-flight read between subscribers of the same mount', async () => {
    const read = vi.fn(async () => ok(catalogView()))
    const catalog = createForumCatalog(api(read))
    const offFirst = catalog.source.subscribe(() => {})
    const offSecond = catalog.source.subscribe(() => {})
    await settle()

    expect(read).toHaveBeenCalledTimes(1)
    offFirst()
    offSecond()
  })

  it('passes the refresh query to the next read', async () => {
    const read = vi.fn(async () => ok(catalogView()))
    const catalog = createForumCatalog(api(read))
    const off = catalog.source.subscribe(() => {})
    await settle()

    catalog.refresh({ boardId: 'b2', query: 'release', sort: 'new' })
    await settle()

    expect(read).toHaveBeenLastCalledWith({ boardId: 'b2', query: 'release', sort: 'new' })
    off()
  })

  it('drops a superseded read so an older answer cannot win', async () => {
    const resolvers: Array<(value: ForumRemoteResult<CatalogView>) => void> = []
    const read = vi.fn(() => new Promise<ForumRemoteResult<CatalogView>>((resolve) => {
      resolvers.push(resolve)
    }))
    const catalog = createForumCatalog(api(read))
    const off = catalog.source.subscribe(() => {})
    await settle()

    catalog.refresh({ boardId: 'b2' })
    await settle()
    expect(resolvers).toHaveLength(2)

    resolvers[0]?.(ok(catalogView({ boardId: 'b1', boards: [board({ id: 'b1' })] })))
    await settle()
    expect(catalog.source.getSnapshot().status).toBe('loading')

    resolvers[1]?.(ok(catalogView({ boardId: 'b2', boards: [board({ id: 'b2' })] })))
    await settle()
    expect(catalog.source.getSnapshot().catalog.boardId).toBe('b2')
    off()
  })

  it('keeps the last good catalog when a read is refused', async () => {
    const read = vi.fn()
      .mockResolvedValueOnce(ok(catalogView()))
      .mockResolvedValueOnce(refused('storage unavailable'))
    const catalog = createForumCatalog(api(read))
    const off = catalog.source.subscribe(() => {})
    await settle()

    catalog.refresh()
    await settle()

    expect(catalog.source.getSnapshot()).toMatchObject({
      status: 'error',
      settled: true,
      error: 'storage unavailable',
    })
    expect(catalog.source.getSnapshot().catalog.posts).toHaveLength(1)
    off()
  })

  it('turns a rejected read into the error state instead of an unhandled rejection', async () => {
    const read = vi.fn().mockRejectedValue(new Error('connection lost'))
    const catalog = createForumCatalog(api(read))
    const off = catalog.source.subscribe(() => {})
    await settle()

    expect(catalog.source.getSnapshot()).toMatchObject({ status: 'error', error: 'connection lost' })
    off()
  })

  it('stops polling and resets the catalog with the last unsubscribe', async () => {
    const read = vi.fn(async () => ok(catalogView()))
    const catalog = createForumCatalog(api(read))
    const off = catalog.source.subscribe(() => {})
    await settle()

    off()
    await vi.advanceTimersByTimeAsync(30_000)

    expect(read).toHaveBeenCalledTimes(1)
    expect(catalog.source.getSnapshot()).toEqual({
      catalog: { boards: [], posts: [], people: [] },
      status: 'loading',
      settled: false,
      error: '',
    })
  })

  it('discards a read that resolves after the last subscriber left', async () => {
    let resolveRead: (value: ForumRemoteResult<CatalogView>) => void = () => {}
    const read = vi.fn(() => new Promise<ForumRemoteResult<CatalogView>>((resolve) => {
      resolveRead = resolve
    }))
    const catalog = createForumCatalog(api(read))
    const listener = vi.fn()
    const off = catalog.source.subscribe(listener)
    off()

    resolveRead(ok(catalogView()))
    await settle()

    expect(catalog.source.getSnapshot().catalog.posts).toEqual([])
    expect(listener).toHaveBeenCalledTimes(1)
  })
})

describe('forum reads / 论坛读取', () => {
  it('returns the post detail and the inbox on success', async () => {
    const detail = { post: post(), body: 'text', comments: [] } satisfies PostDetailView
    const fetchApi = {
      post: vi.fn(async () => ok(detail)),
      inbox: vi.fn(async () => ok([])),
      autoPost: vi.fn(async () => ok({
        running: false, tickSeconds: 60, maxPerHour: 4, settings: [], lastAt: {}, lastError: {}, tags: [],
      })),
    } as unknown as ForumRemoteApi

    await expect(readPost(fetchApi, 'p1', 'ada')).resolves.toEqual(detail)
    await expect(readInbox(fetchApi, 'ada')).resolves.toEqual([])
    await expect(readAutoPost(fetchApi)).resolves.toMatchObject({ running: false })
    expect(fetchApi.post).toHaveBeenCalledWith({ postId: 'p1', reader: 'ada' })
    expect(fetchApi.post).toHaveBeenCalledTimes(1)
  })

  it('surfaces a refusal as the error message', async () => {
    const denying = {
      post: vi.fn(async () => refused('post not found')),
      inbox: vi.fn(async () => refused('inbox not found')),
      autoPost: vi.fn(async () => refused('auto-post not found')),
    } as unknown as ForumRemoteApi

    await expect(readPost(denying, 'p1', undefined)).rejects.toThrow('post not found')
    await expect(readInbox(denying, 'ada')).rejects.toThrow('inbox not found')
    await expect(readAutoPost(denying)).rejects.toThrow('auto-post not found')
    expect(denying.post).toHaveBeenCalledWith({ postId: 'p1' })
  })

  it('renders any thrown value as one line', () => {
    expect(messageOf(new Error('boom'))).toBe('boom')
    expect(messageOf({ message: 'structured' })).toBe('structured')
    expect(messageOf('plain')).toBe('plain')
  })
})
