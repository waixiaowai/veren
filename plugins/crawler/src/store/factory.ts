/**
 * 介质工厂：按配置选择实现，未知介质在首条数据写入前报错。
 * The media factory: selects the implementation per configuration; unknown
 * options fail loudly before any data is written (no half-made files).
 *
 * @module @veren/crawler/store/factory
 */
import { invalidSaveOption } from '../errors.ts'
import type { SaveDataOption } from '../types.ts'
import { CsvStore } from './csv-store.ts'
import type { AbstractStore, StoreFactory } from './contract.ts'
import { DshStore } from './dsh-store.ts'
import { FileStore } from './file-stores.ts'
import type { CrawlerStore } from './domain.ts'

/** 工厂公共参数 / factory-wide options */
export interface StoreFactoryOptions {
  /** 数据输出根目录 / data output root */
  dataRoot: string
  /** 目标平台 / target platform */
  platform: string
  /** 采集模式（入文件名）/ crawling mode (into file names) */
  crawlerType: string
  /** 日期串 yyyy-MM-dd / date string yyyy-MM-dd */
  day: string
  /** 已打开的宿主存储域（`dsh` 介质必需）/ the opened host storage domain (required by the `dsh` medium) */
  domain?: CrawlerStore
}

/**
 * 创建介质实现。db/sqlite/mongodb/postgres/excel 属后续迭代，
 * 当前明确拒绝而不是静默降级；`dsh` 介质需要宿主存储域句柄。
 * Creates a medium implementation. db/sqlite/mongodb/postgres/excel land in
 * later iterations and are rejected loudly for now; the `dsh` medium
 * requires the host storage-domain handle.
 */
export const createStoreFactory =
  (options: StoreFactoryOptions): StoreFactory =>
  (option: SaveDataOption): AbstractStore => {
    switch (option) {
      case 'json':
      case 'jsonl':
        return new FileStore({ ...options, option })
      case 'csv':
        return new CsvStore(options)
      case 'dsh':
        if (options.domain === undefined) throw invalidSaveOption('dsh（需要宿主存储域）')
        return new DshStore({ domain: options.domain, platform: options.platform })
      default:
        throw invalidSaveOption(option)
    }
  }
