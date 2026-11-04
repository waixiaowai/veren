/**
 * 数据汇实现：爬取器内存数据 → 整形脱敏 → 介质落盘的唯一管道
 * （架构铁律 2：数据变更权集中于存储适配）。
 * The data-sink implementation: the only pipeline from crawler memory data
 * through shaping/masking into the media (invariant 2: data mutation
 * rights concentrate in the storage adapter).
 *
 * @module @veren/crawler/sink
 */
import { invalidSaveOption } from './errors.ts'
import type { DataSink, RawComment, RawItem } from './crawler/contract.ts'
import { shapeComment, shapeContent, type ShapeContext } from './store/shape.ts'
import { createStoreFactory } from './store/factory.ts'
import type { AbstractStore } from './store/contract.ts'
import type { CrawlerStore } from './store/domain.ts'
import type { SaveDataOption } from './types.ts'

/** 数据汇构造参数 / sink construction options */
export interface StoreSinkOptions {
  /** 数据输出根目录 / data output root */
  dataRoot: string
  /** 目标平台 / target platform */
  platform: string
  /** 采集模式 / crawling mode */
  crawlerType: string
  /** 来源关键词 / source keyword */
  sourceKeyword: string | null
  /** 保存介质 / save option */
  saveDataOption: SaveDataOption
  /** 日期串 yyyy-MM-dd / date string yyyy-MM-dd */
  day?: string
  /** 当前时刻（测试注入）/ the clock (injected in tests) */
  now?: () => number
  /** 已打开的宿主存储域（`dsh` 介质必需）/ the opened host storage domain (required by the `dsh` medium) */
  domain?: CrawlerStore
}

/**
 * 存储数据汇：把 RawItem/RawComment 整形后交给介质工厂产出实现。
 * The store sink: shapes raw items/comments and hands them to the store
 * produced by the media factory.
 */
export class StoreSink implements DataSink {
  private readonly store: AbstractStore
  private readonly shapeContext: ShapeContext

  constructor(options: StoreSinkOptions) {
    const now = options.now ?? (() => Date.now())
    this.shapeContext = { sourceKeyword: options.sourceKeyword, now }
    const factory = createStoreFactory({
      dataRoot: options.dataRoot,
      platform: options.platform,
      crawlerType: options.crawlerType,
      day: options.day ?? new Date(now()).toISOString().slice(0, 10),
      domain: options.domain,
    })
    this.store = factory(options.saveDataOption)
  }

  /** 交出一条内容：整形 → 介质写入 / hand over one content: shape then persist */
  async content(item: RawItem): Promise<void> {
    await this.store.storeContent(shapeContent({ ...item }, this.shapeContext))
  }

  /** 交出一条评论：整形 → 介质写入 / hand over one comment: shape then persist */
  async comment(item: RawComment): Promise<void> {
    await this.store.storeComment(shapeComment(item, this.shapeContext))
  }

  /** 介质收尾（Excel 落盘等）/ media finalize (excel flush etc.) */
  async finalize(): Promise<void> {
    await this.store.finalize()
  }
}

/** 未实现的介质明确拒绝（fail loud，不静默降级）/ unsupported media reject loudly, never silently degraded */
export function assertStoreSupports(option: SaveDataOption): SaveDataOption {
  if (option === 'db' || option === 'sqlite' || option === 'mongodb' || option === 'excel' || option === 'postgres') {
    throw invalidSaveOption(`${option}（待后续迭代）`)
  }
  return option
}