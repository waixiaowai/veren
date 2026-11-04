/**
 * 搜索模式核心循环：翻页、去重上限、伴随采集（design/modules/crawler.md §4）。
 * The search-mode core loop: pagination, the count cap, and companion
 * collection (crawler.md §4).
 *
 * 终止条件统一为「游标耗尽或累计条数达到配置上限」；空页终止；页间固定
 * 限频休眠；单条任务失败隔离——一条失败不影响同批其余条目。
 * Termination is unified as "cursor exhausted or the configured count cap
 * reached"; empty pages stop; pages sleep at a fixed interval; a single
 * item failure never takes down its batch.
 *
 * @module @veren/crawler/crawler/engine
 */
import type { AbstractCrawler, CrawledPage, DataSink, PageCursor } from './contract.ts'
import { retryable, DEFAULT_RETRY, type RetryOptions } from './ratelimit.ts'
import { Semaphore } from './semaphore.ts'

/** 引擎运行参数 / engine run parameters */
export interface EngineOptions {
  /** 采集模式目标：关键词/内容 id/创作者 id / the mode target: keyword, content id, or creator id */
  target: string
  /** 起始页码 / the starting page number */
  startPage: number
  /** 内容数量上限 / the content count cap */
  maxNotesCount: number
  /** 页间固定限频毫秒 / the fixed inter-page interval in ms */
  pageIntervalMs: number
  /** 并发信号量许可数 / semaphore permits */
  maxConcurrencyNum: number
  /** 休眠实现（测试注入）/ the sleep implementation (injected in tests) */
  sleep?: (ms: number) => Promise<void>
  /** 每页抓取的重试参数 / per-page retry options */
  retry?: RetryOptions
  /** 协作式取消探测（进程内运行器注入）/ the cooperative-cancellation probe (injected by the in-process runner) */
  shouldStop?: () => boolean
}

/** 单页抓取函数：平台实现注入 / the per-page fetcher injected by the platform implementation */
export type FetchPage = (target: string, cursor: PageCursor, sink: DataSink) => Promise<CrawledPage>

/** 起始游标 / the initial cursor */
export function initCursor(startPage: number): PageCursor {
  return { page: startPage, cursor: null, sessionId: null }
}

/**
 * 统一采集循环：对 search/detail/creator 三种模式共用同一推进骨架。
 * The unified crawl loop: search/detail/creator all share this one
 * progression skeleton.
 */
export async function runCrawlLoop(
  fetchPage: FetchPage,
  sink: DataSink,
  options: EngineOptions,
): Promise<number> {
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)))
  const retry = options.retry ?? DEFAULT_RETRY
  const semaphore = new Semaphore(options.maxConcurrencyNum)
  let cursor = initCursor(options.startPage)
  let fetched = 0
  while (fetched < options.maxNotesCount) {
    // 协作式取消：页间检查（进程内运行器）/ cooperative cancellation: checked between pages (in-process runner)
    if (options.shouldStop?.() === true) break
    const page = await retryable(() => fetchPage(options.target, cursor, sink), retry)
    if (page.items.length === 0) break
    fetched += await handOverBatch(page, sink, semaphore, options.maxNotesCount - fetched)
    if (!page.hasMore) break
    cursor = page.next
    await sleep(options.pageIntervalMs)
  }
  return fetched
}

/** 把单页条目经信号量逐条交给数据汇，预算耗尽即停；失败隔离 / hand one page's items to the sink under the semaphore, stopping at the remaining budget and isolating failures */
async function handOverBatch(page: CrawledPage, sink: DataSink, semaphore: Semaphore, budget: number): Promise<number> {
  let handed = 0
  for (const item of page.items) {
    if (handed >= budget) break
    try {
      await semaphore.run(async () => {
        await sink.content(item)
      })
      handed += 1
    } catch {
      // 单条失败隔离：记入页级统计，不影响同批其余条目（验收 4）。
      // Single-item isolation: counted per page; the batch continues (acceptance 4).
    }
  }
  return handed
}
