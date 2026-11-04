/**
 * 媒体下载器：串行落盘、候选地址链、.part 断点续传、校验与 DASH 合流
 * （design/modules/downloader.md §2–§3）。
 * The media downloader: serial persistence, the candidate chain, .part
 * resumable downloads, verification and DASH merging (design
 * downloader.md §2–§3).
 *
 * 平台无关；下载失败永不中断采集主流程——失败只计入报告。
 * Platform-agnostic; download failures never break the crawl — they only
 * land in the report.
 *
 * @module @veren/crawler/media/downloader
 */
import { mkdir, stat, unlink, appendFile, rename } from 'node:fs/promises'
import { dirname } from 'node:path'
import { CrawlerError } from '../errors.ts'
import { guardWithin, inferExtension, buildMediaPath, type MediaPathPolicy } from './paths.ts'

/** 媒体类型 / the media type */
export type MediaType = 'image' | 'video'

/** 单个媒体项 / one media item */
export interface MediaItem {
  /** 首选地址 / the primary url */
  url: string
  /** 备用地址链（上限三个候选）/ fallback urls (up to three candidates) */
  fallbackUrls: string[]
  type: MediaType
  /** 归属内容 id / the owning content id */
  contentId: string
  /** 音视频分轨标记 / the DASH split-track marker */
  isDash: boolean
  /** 分轨音频地址 / the split audio url */
  audioUrl?: string
}

/** 下载报告：失败只上报不抛出 / the report: failures are reported, never thrown */
export interface DownloadReport {
  succeeded: MediaItem[]
  failed: Array<{ item: MediaItem; reason: string }>
}

/** 媒体字节获取抽象（测试注入）/ the byte-fetch abstraction (injected in tests) */
export type MediaFetcher = (url: string, rangeStart: number) => Promise<{ bytes: Buffer; contentType: string }>

/** DASH 合流抽象（外部工具接入点）/ the DASH merge abstraction (the external-tool seam) */
export type DashMerger = (videoPath: string, audioPath: string) => Promise<void>

/** 下载器选项 / the downloader options */
export interface DownloaderOptions {
  policy: MediaPathPolicy
  fetcher: MediaFetcher
  /** 显式扩展名 / an explicit extension */
  explicitExtension?: string | null
  /** 候选内重试次数 / retries per candidate */
  maxRetries?: number
  /** 休眠实现（测试注入）/ the sleep implementation (injected in tests) */
  sleep?: (ms: number) => Promise<void>
  /** DASH 合流实现 / the DASH merge implementation */
  mergeDash?: DashMerger
}

/** 媒体下载失败错误 / the media-download failure error */
function mediaFailed(contentId: string): CrawlerError {
  return new CrawlerError('MEDIA_DOWNLOAD_FAILED', `媒体下载失败: ${contentId}`, { contentId })
}

/** 已存在完整文件的续传语义：跳过 / the resumable semantics: skip complete files */
async function skipIfComplete(path: string): Promise<boolean> {
  try {
    return (await stat(path)).size > 0
  } catch {
    return false
  }
}

/**
 * 媒体下载器。
 * The media downloader.
 */
export class MediaDownloader {
  constructor(private readonly options: DownloaderOptions) {}

  /** 串行下载全部媒体项，产出报告（验收 2：失败隔离）/ serially downloads all items into a report (acceptance 2: isolation) */
  async downloadAll(items: MediaItem[]): Promise<DownloadReport> {
    const report: DownloadReport = { succeeded: [], failed: [] }
    for (const item of items) {
      try {
        await this.downloadOne(item)
        report.succeeded.push(item)
      } catch (error) {
        report.failed.push({ item, reason: error instanceof Error ? error.message : String(error) })
      }
    }
    return report
  }

  /** 下载单个媒体项：候选链 → 续传 → 校验 → 合流 / download one item: candidate chain → resume → verify → merge */
  private async downloadOne(item: MediaItem): Promise<void> {
    const path = buildMediaPath(this.options.policy, item.contentId, inferName(item))
    guardWithin(this.options.policy.root, path)
    if (await skipIfComplete(path)) return
    for (const url of [item.url, ...item.fallbackUrls]) {
      try {
        await this.fetchToPart(url, path)
        if (item.isDash && item.audioUrl !== undefined) await this.mergeAudio(item, path)
        return
      } catch {
        // 单候选失败换下一候选（§3 失败分支）/ one candidate failed, try the next (§3)
      }
    }
    throw mediaFailed(item.contentId)
  }

  /** 分轨音频下载与合流（验收 5）/ split-audio download and merge (acceptance 5) */
  private async mergeAudio(item: MediaItem, videoPath: string): Promise<void> {
    const audioPath = `${videoPath}.audio.m4a`
    await this.fetchToPart(item.audioUrl ?? '', audioPath)
    const merge = this.options.mergeDash
    if (merge === undefined) throw mediaFailed(item.contentId)
    await merge(videoPath, audioPath)
    await unlink(audioPath).catch(() => undefined)
  }

  /** .part 临时文件 + 续传范围请求 + 零字节校验 / .part temp file + resume range + zero-byte verification */
  private async fetchToPart(url: string, path: string): Promise<void> {
    const part = `${path}.part`
    await mkdir(dirname(path), { recursive: true })
    const resumeFrom = (await stat(part).catch(() => null))?.size ?? 0
    const response = await this.options.fetcher(url, resumeFrom)
    if (response.bytes.length === 0 && resumeFrom === 0) throw mediaFailed('empty')
    await appendFile(part, response.bytes)
    const size = (await stat(part)).size
    if (size === 0) {
      await unlink(part).catch(() => undefined)
      throw mediaFailed('corrupt')
    }
    // 完成后移除 .part（design/data.md §5）/ remove .part on completion (design/data.md §5)
    await rename(part, path)
  }
}

/** 由媒体项推断文件名 / infers the file name from a media item */
function inferName(item: MediaItem): string {
  const explicit = item.isDash ? '.mp4' : null
  const extension = inferExtension(explicit, item.url, item.type === 'video' ? '.mp4' : '.jpg')
  return `${item.contentId}${extension}`
}
