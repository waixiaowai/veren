/**
 * 存储契约：统一实体写入接口与介质工厂（design/modules/store.md）。
 * Storage contract: the unified write interface and the media factory
 * (design/modules/store.md).
 *
 * 数据变更权集中于存储适配：采集层只调用本契约，介质差异收敛在实现类内。
 * Data mutation rights are concentrated here: crawlers call only this
 * contract, medium differences stay inside the implementations.
 *
 * @module @veren/crawler/store/contract
 */
import type { CommentRecord, ContentRecord, SaveDataOption } from '../types.ts'

/**
 * 统一存储契约：所有介质实现共享。
 * The unified store contract shared by every medium implementation.
 */
export interface AbstractStore {
  /** 写入/更新一条内容 / persist or update one content record */
  storeContent(contentItem: ContentRecord): Promise<void>
  /** 写入/更新一条评论 / persist or update one comment record */
  storeComment(commentItem: CommentRecord): Promise<void>;
  /** 收尾：Excel 落盘、连接关闭等 / finalize: flush excel, close connections */
  finalize(): Promise<void>
}

/**
 * 按保存介质创建对应实现；未知介质抛 INVALID_SAVE_OPTION。
 * Creates the store for a save option; unknown options throw
 * INVALID_SAVE_OPTION before any data is written (no half-made files).
 */
export type StoreFactory = (option: SaveDataOption) => AbstractStore
