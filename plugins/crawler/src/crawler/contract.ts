/**
 * 爬取器契约：统一骨架接口、签名器抽象与平台工厂（design/modules/crawler.md）。
 * Crawler contracts: the unified skeleton interfaces, the signer abstraction
 * and the platform factory (design/modules/crawler.md).
 *
 * 爬取器只生产内存数据，不触碰落地介质；登录凭证由 auth 模块供给。
 * Crawlers only produce in-memory data and never touch persistence media;
 * credentials come from the auth module.
 *
 * @module @veren/crawler/crawler/contract
 */
import type { CrawlerType, Platform } from '../types.ts'

export type { CrawlerType, Platform }

/** 签名结果：追加到请求头的签名字段与追加到参数的签名字段 / signer output: extra headers and params */
export interface SignResult {
  headers: Record<string, string>
  params: Record<string, string>
}

/** 签名输入上下文 / signer payload context */
export interface PayloadContext {
  /** 当前登录 Cookie 串 / the current login cookie string */
  cookies: string
  /** 请求体（适用时）/ the request body when applicable */
  body: string | null
  /** 时间戳源（测试可注入）/ timestamp source (injectable in tests) */
  now: () => number
}

/** 签名器：输入请求要素 → 输出签名头/参数 / signer: request elements in, signature out */
export type SignProvider = (method: string, uri: string, payload: PayloadContext) => Promise<SignResult>

/** 翻页游标：页码、游标、会话串联三种形态统一表达 / pagination cursor unifying page-number, cursor and session chaining */
export interface PageCursor {
  /** 页码形态 / page number when the platform pages by number */
  page: number | null
  /** 游标形态 / opaque cursor token when the platform pages by cursor */
  cursor: string | null
  /** 会话串联 id / session id chained from the previous page */
  sessionId: string | null
}

/** 单页抓取结果 / one fetched page */
export interface CrawledPage {
  /** 本页原始内容条目 / raw content items of this page */
  items: RawItem[]
  /** 是否还有下一页 / whether a next page exists */
  hasMore: boolean
  /** 下一页游标 / the next-page cursor */
  next: PageCursor
}

/** 平台爬取器生产的原始条目（整形前）/ raw item before shaping */
export interface RawItem {
  id: string
  title?: string | null
  desc?: string | null
  url?: string
  publishTime?: string | null
  likedCount?: number | null
  commentCount?: number | null
  collectedCount?: number | null
  shareCount?: number | null
  imageList?: string[] | null
  videoUrl?: string | null
  tagList?: string[] | null
  /** xhs 访问令牌随条目带出 / xhs access token carried with the item */
  xsecToken?: string | null
  /** 明文创作者标识 / plain creator identifier */
  creatorId: string
  /** 明文昵称 / plain nickname */
  nickname: string
}

/**
 * 统一爬取器骨架：七平台各自实现，采集动作只回吐内存数据。
 * The unified crawler skeleton: implemented per platform; crawl actions
 * only hand back in-memory data through the sink.
 */
export interface AbstractCrawler {
  /** 当前平台 / the platform this crawler serves */
  readonly platform: Platform
  /** 启动浏览器 → 校验登录 → 按模式分发采集 → 清理 / launch browser, verify login, crawl by mode, clean up */
  start(sink: DataSink): Promise<void>
  /** 搜索模式 / search mode */
  search(keyword: string, sink: DataSink): Promise<void>
  /** 详情模式 / detail mode */
  detail(id: string, sink: DataSink): Promise<void>
  /** 创作者模式 / creator mode */
  creator(creatorId: string, sink: DataSink): Promise<void>
}

/** 数据汇：爬取器向存储适配交出数据的唯一通道 / the data sink: the only channel from crawlers to the storage adapter */
export interface DataSink {
  /** 交出一条内容 / hand over one content item */
  content(item: RawItem): Promise<void>
  /** 交出一条评论 / hand over one comment item */
  comment(item: RawComment): Promise<void>
}

/** 平台爬取器生产的原始评论条目 / raw comment item before shaping */
export interface RawComment {
  id: string
  contentId: string
  parentCommentId?: string | null
  content: string
  likeCount?: number | null
  subCommentCount?: number | null
  pictures?: string[] | null
  publishTime?: string | null
  creatorId: string
  nickname: string
}

/** 爬取器工厂契约：平台标识 → 实现；未注册平台抛 INVALID_PLATFORM / crawler factory contract; unknown platforms throw INVALID_PLATFORM */
export type CrawlerFactory = (platform: Platform) => AbstractCrawler

/** 模式分发：统一骨架按采集类型调用对应方法 / mode dispatch: the skeleton calls the method matching the crawler type */
export async function crawlByType(
  crawler: AbstractCrawler,
  type: CrawlerType,
  target: string,
  sink: DataSink,
): Promise<void> {
  if (type === 'search') await crawler.search(target, sink)
  else if (type === 'detail') await crawler.detail(target, sink)
  else await crawler.creator(target, sink)
}
