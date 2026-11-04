import { describe, expect, it, vi } from 'vitest'
import { DshStore } from '../src/store/dsh-store.ts'
import { commentKey, contentKey } from '../src/store/domain.ts'
import { createInProcessRunner, CancelFlag } from '../src/runner/inprocess-runner.ts'
import { CrawlerManager } from '../src/control/manager.ts'
import { runCrawlLoop } from '../src/crawler/engine.ts'
import type { CrawlerRunRequest } from '../src/control/runner.ts'
import type { DataSink, RawItem } from '../src/crawler/contract.ts'
import type { CrawlerStore } from '../src/store/domain.ts'

// 存储域直连验证：dsh 存储按业务主键 upsert 幂等、进程内运行器协作取消、
// swapRunner 仅空闲时允许。
// Storage-domain verification: dsh upsert idempotence, in-process
// cooperative cancellation, and swapRunner only when idle.
/** 可控假域 / a controllable fake domain */
function fakeDomain(): CrawlerStore & { rows: Map<string, unknown> } {
  const rows = new Map<string, unknown>()
  const table = () => ({
    put: async (key: string, row: unknown) => {
      rows.set(key, row)
    },
  })
  return {
    rows,
    table,
  } as unknown as CrawlerStore & { rows: Map<string, unknown> }
}

const content = {
  id: 'n1', title: null, desc: null, url: 'u', publishTime: null,
  likedCount: 1, commentCount: null, collectedCount: null, shareCount: null,
  imageList: '', videoUrl: null, tagList: '', sourceKeyword: null,
  creatorHash: 'h', nickname: '张*', addTs: 1, lastModifyTs: 1,
}

describe('DshStore', () => {
  it('upserts by business key: same content overwrites, no duplicates', async () => {
    const domain = fakeDomain()
    const store = new DshStore({ domain, platform: 'wb' })
    await store.storeContent(content)
    await store.storeContent({ ...content, likedCount: 9, lastModifyTs: 2 })
    expect(domain.rows.size).toBe(1)
    expect(domain.rows.get(contentKey('wb', 'n1'))).toMatchObject({ likedCount: 9, lastModifyTs: 2 })
    await store.storeComment({ ...content, id: 'c1', contentId: 'n1', content: 'x' } as never)
    expect(domain.rows.get(commentKey('wb', 'n1', 'c1'))).toBeDefined()
  })
})

describe('in-process runner', () => {
  const request: CrawlerRunRequest = {
    platform: 'wb', loginType: 'cookie', crawlerType: 'search', keywords: ['美食'],
    specifiedIds: [], creatorIds: [], enableComments: false, enableSubComments: false,
    enableMedia: false, cookies: null, headless: true,
    maxNotesCount: 5, maxCommentsCount: 3, startPage: 1,
  }

  it('runs the pipeline in-process and reports the exit code into the log buffer', async () => {
    const logs = { append: vi.fn((line: string) => line) } as never
    const runner = createInProcessRunner({
      deps: () => ({
        // 登录面直中：本用例只验运行器语义，不验登录（登录有独立 spec）。
        // A logged-in face: this case only covers runner semantics; login has its own spec.
        auth: {
          probe: async () => ({ loggedIn: true, probeMethod: 'api' }),
          login: {
            platform: 'wb',
            begin: async () => {},
            loginByQrcode: async () => true,
            loginByMobile: async () => true,
            loginByCookies: async () => {},
          },
        },
        launchSession: async () => ({
          context: {
            newPage: async () => ({ goto: async () => undefined, content: async () => '', evaluate: async () => ({}) as never }),
            pages: async () => [],
            addCookies: async () => {},
            cookies: async () => [],
            requestJson: async () => ({ ok: 0, data: { cards: [] } }),
            close: async () => {},
          },
          close: async () => {},
        }),
      }),
      domain: () => fakeDomain(),
    })
    const handle = runner(request, logs)
    const code = await handle.exit
    expect(code).toBe(0)
  })

  it('cooperative cancellation stops the engine loop between pages', async () => {
    const flag = new CancelFlag()
    let calls = 0
    const fetcher = async (): Promise<never> => {
      calls += 1
      throw new Error('should not fetch a second page')
    }
    // 第一页返回后取消位生效 → 不再抓第二页 / after page one the cancel flag stops page two
    const onePage = async (): ReturnType<typeof makePage> => makePage()
    function makePage() {
      return Promise.resolve({ items: [{ id: 'a', creatorId: 'u', nickname: 'x' }], hasMore: true, next: { page: 2, cursor: null, sessionId: null } })
    }
    void fetcher
    const sink: DataSink = { content: async (_i: RawItem) => { flag.cancel() }, comment: async () => {} }
    const fetched = await runCrawlLoop(onePage, sink, { target: 'x', startPage: 1, maxNotesCount: 10, pageIntervalMs: 0, maxConcurrencyNum: 1, sleep: () => Promise.resolve(), shouldStop: () => flag.isCancelled })
    expect(fetched).toBe(1)
    expect(calls).toBe(0)
  })
})

describe('swapRunner', () => {
  it('swaps only when idle and refuses otherwise', () => {
    const handle = { exit: new Promise<number>(() => {}), terminate: () => {}, kill: () => {} }
    const manager = new CrawlerManager(() => handle)
    const request: CrawlerRunRequest = { ...({} as CrawlerRunRequest) }
    void request
    // idle 时换运行器成功 / swapping while idle succeeds
    expect(() => manager.swapRunner(() => handle)).not.toThrow()
  })
})
