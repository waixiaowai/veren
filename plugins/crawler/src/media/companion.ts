/**
 * 媒体伴随包装：内容落库后按媒体开关串行下载图片/视频（SYS-04；旁路
 * 失败不中断采集主流程——失败只计入下载报告）。
 * The media companion wrapper: after each content persists, images and
 * videos download serially when the media switch is on (SYS-04; a bypass
 * failure never breaks the crawl — failures only land in the report).
 *
 * @module @veren/crawler/media/companion
 */
import { MediaDownloader, type MediaItem } from './downloader.ts'
import type { DataSink, RawItem } from '../crawler/contract.ts'

/** 内部数据汇（被包装的存储汇）/ the inner sink (the wrapped storage sink) */
type InnerSink = DataSink & { contentsWritten(): number }

/**
 * 媒体伴随数据汇：透传内容/评论到内部汇，内容侧附带媒体下载。
 * The companion sink: passes contents/comments through to the inner sink,
 * attaching media downloads on the content side.
 */
export class MediaCompanionSink implements DataSink {
  private readonly inner: DataSink
  private readonly downloader: MediaDownloader

  constructor(inner: DataSink, downloader: MediaDownloader) {
    this.inner = inner
    this.downloader = downloader
  }

  /** 内容：先落库，再串行下载其媒体（失败隔离在下载器内）/ content: persist first, then download its media serially (failures isolated inside) */
  async content(item: RawItem): Promise<void> {
    await this.inner.content(item)
    const items = toMediaItems(item)
    if (items.length === 0) return
    await this.downloader.downloadAll(items)
  }

  /** 评论直通 / comments pass through */
  async comment(item: Parameters<DataSink['comment']>[0]): Promise<void> {
    await this.inner.comment(item)
  }
}

/** 由原始条目推断媒体项列表 / derives media items from a raw item */
export function toMediaItems(item: RawItem): MediaItem[] {
  const items: MediaItem[] = []
  const imageList = typeof item.imageList === 'string' ? item.imageList : (item.imageList ?? []).join(',')
  const images = imageList
    .split(',')
    .map((url) => url.trim())
    .filter((url) => url.length > 0)
  for (const url of images) {
    items.push({ url, fallbackUrls: [], type: 'image', contentId: item.id, isDash: false })
  }
  if (item.videoUrl !== null && item.videoUrl !== undefined && item.videoUrl.length > 0) {
    items.push({ url: item.videoUrl, fallbackUrls: [], type: 'video', contentId: item.id, isDash: false })
  }
  return items
}
