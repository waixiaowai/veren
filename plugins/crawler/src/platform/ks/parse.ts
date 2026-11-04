/**
 * ks 搜索响应解析：GraphQL 搜索 → 原始条目。
 * Kuaishou search response parsing: GraphQL search → raw items.
 *
 * 响应形状：data.visionSearchPhoto.feeds[]（photo{id,caption,likeCount,
 * timestamp,coverUrls,author{name}}）。
 * Response shape: data.visionSearchPhoto.feeds[] (photo objects).
 *
 * @module @veren/crawler/platform/ks/parse
 */
import type { RawItem } from '../../crawler/contract.ts'

/** 单条快手的宽松形状 / the loose shape of one photo */
interface KsFeed {
  photo?: {
    id?: string
    caption?: string
    likeCount?: string | number
    commentCount?: string | number
    timestamp?: number | string
    coverUrls?: Array<{ url?: string }>
    author?: { id?: string; name?: string }
  }
}

/** GraphQL 搜索响应的宽松形状 / the loose shape of a GraphQL search response */
interface KsSearchResponse {
  status?: number
  data?: {
    visionSearchPhoto?: {
      feeds?: KsFeed[]
      pcursor?: string
    }
  }
}

/** like 计数解析（可能为字符串数字）/ parses like count (may be string number) */
function toNum(value: string | number | undefined): number | null {
  if (value === undefined) return null
  const parsed = typeof value === 'number' ? value : parseInt(value, 10)
  return Number.isNaN(parsed) ? null : parsed
}

/** 单条快手转原始条目 / one photo to a raw item */
function feedToRawItem(feed: KsFeed): RawItem | null {
  const photo = feed.photo
  if (photo?.id === undefined || photo.author === undefined) return null
  const coverUrls = (photo.coverUrls ?? [])
    .map((c) => c.url ?? '')
    .filter((url) => url.length > 0)
  return {
    id: photo.id,
    title: null,
    desc: photo.caption ?? null,
    url: `https://www.kuaishou.com/short-video/${photo.id}`,
    publishTime: photo.timestamp === undefined ? null : String(photo.timestamp),
    likedCount: toNum(photo.likeCount),
    commentCount: toNum(photo.commentCount),
    collectedCount: null,
    shareCount: null,
    imageList: coverUrls,
    videoUrl: null,
    tagList: null,
    creatorId: photo.author.id ?? '',
    nickname: photo.author.name ?? '',
  }
}

/**
 * 解析 ks GraphQL 搜索响应为原始条目列表；空结果返回空数组（空页终止）。
 * Parses a ks GraphQL search response into raw items; empty results yield
 * an empty array (the empty-page stop).
 */
export function parseKsSearchResponse(payload: unknown): RawItem[] {
  if (payload === null || typeof payload !== 'object') return []
  const response = payload as KsSearchResponse
  const items: RawItem[] = []
  for (const feed of response.data?.visionSearchPhoto?.feeds ?? []) {
    const parsed = feedToRawItem(feed)
    if (parsed !== null) items.push(parsed)
  }
  return items
}

/** 下一页游标（pcursor，'' 表示末尾）/ the next-page cursor (pcursor, '' = end) */
export function ksNextCursor(payload: unknown): string | null {
  if (payload === null || typeof payload !== 'object') return null
  const response = payload as KsSearchResponse
  const pcursor = response.data?.visionSearchPhoto?.pcursor
  if (pcursor === undefined || pcursor === '' || pcursor === '0') return null
  return pcursor
}
