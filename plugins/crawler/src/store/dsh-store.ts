/**
 * dsh 存储介质实现：统一实体写入宿主存储域（意见 2）。
 * The dsh storage medium: unified records persisted into the host storage
 * domain (directive 2).
 *
 * 语义与库类介质一致：主键存在即更新（put 覆盖写），重跑幂等。
 * Semantics match the database media: put-overwrite by business key,
 * idempotent across reruns.
 *
 * @module @veren/crawler/store/dsh-store
 */
import { commentKey, contentKey, type CrawlerStore } from './domain.ts'
import type { CommentRecord, ContentRecord } from '../types.ts'

/** dsh 介质构造参数 / dsh-medium construction options */
export interface DshStoreOptions {
  /** 已打开的宿主存储域 / the opened host storage domain */
  domain: CrawlerStore
  /** 目标平台（入行键）/ the target platform (into row keys) */
  platform: string
}

/**
 * dsh 存储介质：内容与评论按业务主键 upsert 进宿主存储域。
 * The dsh medium: contents and comments upserted by business key into the
 * host storage domain.
 */
export class DshStore {
  constructor(private readonly options: DshStoreOptions) {}

  /** upsert 一条内容 / upsert one content */
  async storeContent(contentItem: ContentRecord): Promise<void> {
    await this.options.domain.table('contents').put(contentKey(this.options.platform, contentItem.id), contentItem)
  }

  /** upsert 一条评论 / upsert one comment */
  async storeComment(commentItem: CommentRecord): Promise<void> {
    await this.options.domain
      .table('comments')
      .put(commentKey(this.options.platform, commentItem.contentId, commentItem.id), commentItem)
  }

  /** 存储域由宿主管理，介质无收尾动作 / the domain is host-managed; no finalize */
  async finalize(): Promise<void> {}
}
