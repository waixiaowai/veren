/**
 * dy 搜索响应解析：web 搜索 API → 原始条目。
 * Douyin search response parsing: web search api → raw items.
 *
 * 响应形状：data[data[]]（type=1 为视频条目，aweme_info{aweme_id,desc,
 * author{nickname,sec_uid},statistics{digg_count,comment_count},video{...}}）。
 * Response shape: data[data[]] (type=1 video items with aweme_info).
 *
 * @module @veren/crawler/platform/dy/parse
 */
import type { RawItem } from '../../crawler/contract.ts'

/** 单条视频的宽松形状 / the loose shape of one video */
interface DyAweme {
  aweme_id?: string
  desc?: string
  author?: { nickname?: string; sec_uid?: string }
  statistics?: { digg_count?: number; comment_count?: number; collect_count?: number; share_count?: number }
  create_time?: number
  video?: { cover?: string[] | string; play_addr?: string[] | string }
}

/** 搜索响应的宽松形状 / the loose shape of a search response */
interface DySearchResponse {
  status_code?: number
  data?: Array<{ type?: number; aweme_info?: DyAweme }>
}

/** 视频地址提取 / extracts the video url */
function videoUrlOf(video: DyAweme['video']): string | null {
  if (video === undefined) return null
  const playAddr = video.play_addr
  if (playAddr === undefined) return null
  if (typeof playAddr === 'string') return playAddr
  if (Array.isArray(playAddr) && playAddr.length > 0) return playAddr[0]
  return null
}

/** 封面提取 / extracts the cover url */
function coverOf(video: DyAweme['video']): string[] {
  if (video?.cover === undefined) return []
  if (typeof video.cover === 'string') return [video.cover]
  if (Array.isArray(video.cover)) return video.cover.filter((url) => url.length > 0)
  return []
}

/** 单条视频转原始条目 / one video to a raw item */
function awemeToRawItem(aweme: DyAweme): RawItem | null {
  if (aweme.aweme_id === undefined) return null
  const author = aweme.author ?? {}
  const stats = aweme.statistics ?? {}
  return {
    id: aweme.aweme_id,
    title: null,
    desc: aweme.desc ?? null,
    url: `https://www.douyin.com/video/${aweme.aweme_id}`,
    publishTime: aweme.create_time === undefined ? null : String(aweme.create_time),
    likedCount: stats.digg_count ?? null,
    commentCount: stats.comment_count ?? null,
    collectedCount: stats.collect_count ?? null,
    shareCount: stats.share_count ?? null,
    imageList: coverOf(aweme.video),
    videoUrl: videoUrlOf(aweme.video),
    tagList: null,
    creatorId: author.sec_uid ?? '',
    nickname: author.nickname ?? '',
  }
}

/**
 * 解析 dy 搜索响应为原始条目列表；失败或空结果返回空数组（空页终止）。
 * Parses a douyin search response into raw items; failures yield empty
 * arrays (the empty-page stop).
 */
export function parseDySearchResponse(payload: unknown): RawItem[] {
  if (payload === null || typeof payload !== 'object') return []
  const response = payload as DySearchResponse
  if (response.status_code !== 0) return []
  const items: RawItem[] = []
  for (const entry of response.data ?? []) {
    if (entry.type !== 1 || entry.aweme_info === undefined) continue
    const parsed = awemeToRawItem(entry.aweme_info)
    if (parsed !== null) items.push(parsed)
  }
  return items
}

/** 是否还有下一页：status_code=0 且本页有条目 / whether a next page exists */
export function dyHasMore(payload: unknown): boolean {
  if (payload === null || typeof payload !== 'object') return false
  const response = payload as DySearchResponse
  return response.status_code === 0 && (response.data?.length ?? 0) > 0
}
