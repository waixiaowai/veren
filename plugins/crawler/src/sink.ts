/**
 * 数据汇实现：爬取器内存数据 → 整形脱敏 → dsh 存储域的唯一管道。
 * The data-sink implementation: the only pipeline from crawler memory data
 * through shaping/masking into the host storage domain.
 *
 * 存储只认 dsh storageDomain（用户指令：文件/数据库介质是 dsh 其他插件的
 * 事情）；写语义 = 按业务主键 upsert，重跑幂等。
 * Storage is the dsh storageDomain only (directive: file/database media
 * belong to other dsh plugins); write semantics = upsert by business key,
 * idempotent across reruns.
 *
 * @module @veren/crawler/sink
 */
import type { DataSink, RawComment, RawItem } from './crawler/contract.ts'
import { shapeComment, shapeContent, type ShapeContext } from './store/shape.ts'
import { commentKey, contentKey } from './store/domain.ts'
import type { CrawlerStore } from './store/domain.ts'

/** 数据汇构造参数 / sink construction options */
export interface StoreSinkOptions {
  /** 目标平台 / target platform */
  platform: string
  /** 来源关键词 / source keyword */
  sourceKeyword: string | null
  /** 当前时刻（测试注入）/ the clock (injected in tests) */
  now?: () => number
  /** 已打开的宿主存储域 / the opened host storage domain */
  domain: CrawlerStore
}

/**
 * 存储数据汇：把 RawItem/RawComment 整形脱敏后写入宿主存储域。
 * The store sink: shapes and masks raw items/comments, then persists into
 * the host storage domain.
 */
export class StoreSink implements DataSink {
  private readonly shapeContext: ShapeContext
  private readonly domain: CrawlerStore
  private readonly platform: string
  private contentCount = 0
  private commentCount = 0

  constructor(options: StoreSinkOptions) {
    const now = options.now ?? (() => Date.now())
    this.shapeContext = { sourceKeyword: options.sourceKeyword, now }
    this.domain = options.domain
    this.platform = options.platform
  }

  /** 已写内容条数（收尾日志与验收用）/ contents written (for the closing log and acceptance) */
  get contentsWritten(): number {
    return this.contentCount
  }

  /** 已写评论条数 / comments written */
  get commentsWritten(): number {
    return this.commentCount
  }

  /** 交出一条内容：整形 → upsert / hand over one content: shape then upsert */
  async content(item: RawItem): Promise<void> {
    const record = shapeContent({ ...item }, this.shapeContext)
    await this.domain.table('contents').put(contentKey(this.platform, record.id), record)
    this.contentCount += 1
  }

  /** 交出一条评论：整形 → upsert / hand over one comment: shape then upsert */
  async comment(item: RawComment): Promise<void> {
    const record = shapeComment({ ...item }, this.shapeContext)
    await this.domain.table('comments').put(commentKey(this.platform, record.contentId, record.id), record)
    this.commentCount += 1
  }

  /** 存储域由宿主管理，无收尾动作 / the domain is host-managed; no finalize */
  async finalize(): Promise<void> {}
}
