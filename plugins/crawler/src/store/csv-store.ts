/**
 * csv 介质实现：追加行，首行写表头，带字节序标记便于表格软件打开。
 * The csv medium: appended rows with a header on first write and a BOM so
 * spreadsheet software opens it correctly (storage matrix, design store.md §5).
 *
 * @module @veren/crawler/store/csv-store
 */
import { mkdir, appendFile, access } from 'node:fs/promises'
import { join } from 'node:path'
import type { CommentRecord, ContentRecord } from '../types.ts'
import type { AbstractStore } from './contract.ts'
import { dataDirOf, dataFileName } from './paths.ts'

/** 内容表列序（design/data.md §2）/ content column order (design/data.md §2) */
const CONTENT_COLUMNS = [
  'id', 'title', 'desc', 'url', 'publishTime', 'likedCount', 'commentCount',
  'collectedCount', 'shareCount', 'imageList', 'videoUrl', 'tagList',
  'sourceKeyword', 'creatorHash', 'nickname', 'addTs', 'lastModifyTs',
] as const

/** 评论表列序（design/data.md §3）/ comment column order (design/data.md §3) */
const COMMENT_COLUMNS = [
  'id', 'contentId', 'parentCommentId', 'content', 'likeCount', 'subCommentCount',
  'pictures', 'publishTime', 'sourceKeyword', 'creatorHash', 'nickname', 'addTs', 'lastModifyTs',
] as const

/** csv 单元格转义：引号包裹并双写内部引号 / csv escaping: wrap in quotes and double inner quotes */
function escapeCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value)
  return `"${text.replaceAll('"', '""')}"`
}

/** 单行序列化 / serialize one row */
function toCsvLine(record: Record<string, unknown>, columns: readonly string[]): string {
  return `${columns.map((column) => escapeCell(record[column])).join(',')}\n`
}

/** csv 存储构造参数 / csv store construction options */
export interface CsvStoreOptions {
  dataRoot: string
  platform: string
  crawlerType: string
  day: string
}

/**
 * csv 文件存储：追加语义，首行表头 + BOM 仅写一次。
 * The csv file store: append semantics; header plus BOM written only once.
 */
export class CsvStore implements AbstractStore {
  private readonly dir: string
  private readonly contentsFile: string
  private readonly commentsFile: string

  constructor(options: CsvStoreOptions) {
    this.dir = dataDirOf(options.dataRoot, options.platform as never, 'csv') ?? '.'
    this.contentsFile = join(this.dir, dataFileName(options.crawlerType as never, 'contents', options.day, 'csv'))
    this.commentsFile = join(this.dir, dataFileName(options.crawlerType as never, 'comments', options.day, 'csv'))
  }

  /** 追加一行内容，首行表头 / append one content row, header first */
  async storeContent(contentItem: ContentRecord): Promise<void> {
    await this.append(this.contentsFile, contentItem, CONTENT_COLUMNS)
  }

  /** 追加一行评论，首行表头 / append one comment row, header first */
  async storeComment(commentItem: CommentRecord): Promise<void> {
    await this.append(this.commentsFile, commentItem, COMMENT_COLUMNS)
  }

  /** 文件介质无需收尾 / file media need no finalize */
  async finalize(): Promise<void> {}

  /** 确保目录与表头后追加 / ensure directory and header, then append */
  private async append(file: string, record: ContentRecord | CommentRecord, columns: readonly string[]): Promise<void> {
    await mkdir(this.dir, { recursive: true })
    const header = `﻿${columns.join(',')}\n`
    let payload = toCsvLine(record as unknown as Record<string, unknown>, columns)
    try {
      await access(file)
    } catch {
      payload = header + payload
    }
    await appendFile(file, payload, 'utf8')
  }
}
