/**
 * 微博搜索响应解析：m.weibo.cn container/getIndex 卡片 → 原始条目
 * （design/modules/crawler.md §5 平台差异：wb 无加密签名、双站 Cookie、
 * 长文截断需补全文）。
 * Weibo search response parsing: m.weibo.cn container/getIndex cards →
 * raw items (crawler.md §5: wb has no encrypted signature, dual-site
 * cookies, and truncated long posts needing full-text fetch).
 *
 * @module @veren/crawler/platform/wb/parse
 */
import type { RawItem } from '../../crawler/contract.ts'

/** mblog 卡片的宽松形状 / the loose shape of an mblog card */
interface WbMblog {
  id: string
  bid?: string
  text?: string
  isLongText?: boolean
  created_at?: string
  user?: { idstr?: string; screen_name?: string }
  attitudes_count?: number
  comments_count?: number
  reposts_count?: number
  pics?: Array<{ large?: { url?: string }; url?: string }>
  page_info?: { media_info?: { stream_url?: string } }
}

/** 搜索响应的宽松形状 / the loose shape of a search response */
interface WbSearchResponse {
  ok?: number
  data?: { cards?: Array<{ mblog?: WbMblog; card_type?: number }> }
}

/** 图片地址列表聚合 / aggregates the picture urls */
function picsOf(mblog: WbMblog): string[] {
  return (mblog.pics ?? [])
    .map((pic) => pic.large?.url ?? pic.url ?? '')
    .filter((url) => url.length > 0)
}

/** 单卡转原始条目；长文标记 isLongText 供上层补全文 / one card to a raw item; long posts are flagged for full-text fetch upstream */
function mblogToRawItem(mblog: WbMblog): RawItem | null {
  if (mblog.id === undefined || mblog.user?.idstr === undefined) return null
  return {
    id: mblog.id,
    title: null,
    desc: mblog.text ?? null,
    url: `https://m.weibo.cn/status/${mblog.bid ?? mblog.id}`,
    publishTime: mblog.created_at ?? null,
    likedCount: mblog.attitudes_count ?? null,
    commentCount: mblog.comments_count ?? null,
    collectedCount: null,
    shareCount: mblog.reposts_count ?? null,
    imageList: picsOf(mblog),
    videoUrl: mblog.page_info?.media_info?.stream_url ?? null,
    tagList: null,
    creatorId: mblog.user.idstr,
    nickname: mblog.user.screen_name ?? '',
  }
}

/**
 * 解析微博搜索响应为原始条目列表；空页返回空数组（空页终止条件）。
 * Parses a weibo search response into raw items; an empty page yields an
 * empty array (the empty-page stop condition).
 */
export function parseWbSearchResponse(payload: unknown): RawItem[] {
  if (payload === null || typeof payload !== 'object') return []
  const response = payload as WbSearchResponse
  const cards = response.data?.cards ?? []
  const items: RawItem[] = []
  for (const card of cards) {
    if (card.mblog === undefined) continue
    const parsed = mblogToRawItem(card.mblog)
    if (parsed !== null) items.push(parsed)
  }
  return items
}

/** 搜索接口是否还有下一页：ok=1 且本页有条目 / whether a next page exists: ok=1 and this page had items */
export function wbHasMore(payload: unknown): boolean {
  if (payload === null || typeof payload !== 'object') return false
  const response = payload as WbSearchResponse
  return response.ok === 1 && (response.data?.cards?.length ?? 0) > 0
}
