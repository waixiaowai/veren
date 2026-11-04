/**
 * 文件介质实现：json / jsonl（design/modules/store.md §5 存储矩阵）。
 * File media implementations: json and jsonl (storage matrix, design
 * modules/store.md §5).
 *
 * - json：全量读入追加后重写，单文件对象数组，格式化缩进。
 *   json: full read, append, rewrite — one array file, indented.
 * - jsonl：逐行追加，词云读取的唯一来源。
 *   jsonl: line-appended; the only source wordcloud reads.
 *
 * @module @veren/crawler/store/file-stores
 */
import { mkdir, readFile, appendFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { CommentRecord, ContentRecord } from '../types.ts'
import type { AbstractStore } from './contract.ts'
import { dataDirOf, dataFileName, extensionOf } from './paths.ts'

/** 文件介质构造参数 / file store construction options */
export interface FileStoreOptions {
  /** 数据输出根目录 / data output root */
  dataRoot: string
  /** 目标平台 / target platform */
  platform: string
  /** 保存介质（仅 json/jsonl）/ save option (json or jsonl only) */
  option: 'json' | 'jsonl'
  /** 采集模式（入文件名）/ crawling mode (goes into the file name) */
  crawlerType: string
  /** 日期串 yyyy-MM-dd（入文件名）/ date string yyyy-MM-dd (into the file name) */
  day: string
}

/** 读已有对象数组（json）；文件缺失视为空 / read the existing json array; a missing file is empty */
async function readJsonArray(file: string): Promise<Record<string, unknown>[]> {
  try {
    const text = await readFile(file, 'utf8')
    const parsed: unknown = JSON.parse(text)
    return Array.isArray(parsed) ? (parsed as Record<string, unknown>[]) : []
  } catch {
    return []
  }
}

/**
 * json/jsonl 文件存储。
 * The json/jsonl file store.
 */
export class FileStore implements AbstractStore {
  private readonly dir: string
  private readonly contentsFile: string
  private readonly commentsFile: string

  constructor(private readonly options: FileStoreOptions) {
    const dir = dataDirOf(options.dataRoot, options.platform as never, options.option)
    this.dir = dir ?? '.'
    const ext = extensionOf(options.option)
    this.contentsFile = join(this.dir, dataFileName(options.crawlerType as never, 'contents', options.day, ext))
    this.commentsFile = join(this.dir, dataFileName(options.crawlerType as never, 'comments', options.day, ext))
  }

  /** json 重写整文件；jsonl 追加一行 / json rewrites the file; jsonl appends a line */
  async storeContent(contentItem: ContentRecord): Promise<void> {
    await this.write(this.contentsFile, contentItem)
  }

  /** 写入一条评论 / persist one comment */
  async storeComment(commentItem: CommentRecord): Promise<void> {
    await this.write(this.commentsFile, commentItem)
  }

  /** 文件介质无需收尾 / file media need no finalize */
  async finalize(): Promise<void> {}

  /** 按介质语义写入 / write per the medium semantics */
  private async write(file: string, record: ContentRecord | CommentRecord): Promise<void> {
    await mkdir(this.dir, { recursive: true })
    if (this.options.option === 'jsonl') {
      await appendFile(file, `${JSON.stringify(record)}\n`, 'utf8')
      return
    }
    const rows = await readJsonArray(file)
    rows.push(record as unknown as Record<string, unknown>)
    await writeFile(file, `${JSON.stringify(rows, null, 2)}\n`, 'utf8')
  }
}
