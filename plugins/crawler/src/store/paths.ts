/**
 * 数据目录布局：数据根/平台/介质/采集模式_实体类型_日期.扩展名。
 * Data directory layout: dataRoot/platform/media/mode_entity_date.ext
 * (design/data.md §5 naming rules).
 *
 * @module @veren/crawler/store/paths
 */
import { join } from 'node:path'
import { invalidSaveOption } from '../errors.ts'
import type { CrawlerType, Platform, SaveDataOption } from '../types.ts'

/** 文件介质到目录名的映射 / file media to directory name mapping */
const MEDIA_DIR: Partial<Record<SaveDataOption, string>> = {
  csv: 'csv',
  json: 'json',
  jsonl: 'jsonl',
}

/**
 * 解析某平台某介质的数据输出目录：数据根/平台/介质目录。
 * Resolves the output directory for a platform and file medium:
 * dataRoot/platform/mediaDir.
 *
 * 库类与 Excel 介质不落此目录，返回 null 表示无文件输出。
 * Database and Excel media do not write here; null means no file output.
 */
export function dataDirOf(dataRoot: string, platform: Platform, option: SaveDataOption): string | null {
  const dir = MEDIA_DIR[option]
  if (dir === undefined) return null
  return join(dataRoot, platform, dir)
}

/**
 * 生成数据文件名：采集模式_实体类型_日期.扩展名。
 * Builds the data file name: mode_entity_date.ext.
 */
export function dataFileName(crawlerType: CrawlerType, entity: 'contents' | 'comments', day: string, ext: string): string {
  return `${crawlerType}_${entity}_${day}.${ext}`
}

/** 介质对应的文件扩展名 / file extension per medium */
export function extensionOf(option: SaveDataOption): string {
  if (option === 'csv') return 'csv'
  if (option === 'json') return 'json'
  if (option === 'jsonl') return 'jsonl'
  throw invalidSaveOption(option)
}
