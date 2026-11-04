/**
 * B 站搜索响应解析：x/web-interface/wbi/search/type → 原始条目。
 * Bilibili search response parsing: x/web-interface/wbi/search/type → raw
 * items.
 *
 * 响应形状：result[]（bvid/title/author/mid/like/play/reply/pubdate/pic，
 * 与 design/data.md 字段映射）。
 * Response shape: result[] mapped onto the design/data.md fields.
 *
 * @module @veren/crawler/platform/bili/parse
 */
import type { RawItem } from '../../crawler/contract.ts'

/** 单条结果的宽松形状 / the loose shape of one result */
interface BiliResult {
  bvid?: string
  title?: string
  description?: string
  author?: string
  mid?: number | string
  like?: number
  reply?: number
  favorite?: number
  pubdate?: number
  pic?: string
}

/** 搜索响应的宽松形状 / the loose shape of a search response */
interface BiliSearchResponse {
  code?: number
  data?: { result?: BiliResult[] }
}

/** 单条结果转原始条目 / one result to a raw item */
function resultToRawItem(result: BiliResult): RawItem | null {
  if (result.bvid === undefined || result.mid === undefined) return null
  return {
    id: result.bvid,
    title: stripEm(result.title ?? null),
    desc: result.description ?? null,
    url: `https://www.bilibili.com/video/${result.bvid}`,
    publishTime: result.pubdate === undefined ? null : String(result.pubdate),
    likedCount: result.like ?? null,
    commentCount: result.reply ?? null,
    collectedCount: result.favorite ?? null,
    shareCount: null,
    imageList: result.pic === undefined ? [] : [result.pic],
    videoUrl: null,
    tagList: null,
    creatorId: String(result.mid),
    nickname: result.author ?? '',
  }
}

/** 去掉标题里的 <em class="keyword"> 高亮标签 / strips the <em> highlight tags from titles */
function stripEm(title: string | null): string | null {
  return title === null ? null : title.replace(/<\/?em[^>]*>/g, '')
}

/**
 * 解析 B 站搜索响应；code!==0 或空结果返回空数组（空页终止）。
 * Parses a bilibili search response; code!==0 or empty results yield an
 * empty array (the empty-page stop).
 */
export function parseBiliSearchResponse(payload: unknown): RawItem[] {
  if (payload === null || typeof payload !== 'object') return []
  const response = payload as BiliSearchResponse
  if (response.code !== 0) return []
  const items: RawItem[] = []
  for (const result of response.data?.result ?? []) {
    const parsed = resultToRawItem(result)
    if (parsed !== null) items.push(parsed)
  }
  return items
}

/** 是否还有下一页：code=0 且本页有条目 / whether a next page exists: code=0 with items */
export function biliHasMore(payload: unknown): boolean {
  if (payload === null || typeof payload !== 'object') return false
  const response = payload as BiliSearchResponse
  return response.code === 0 && (response.data?.result?.length ?? 0) > 0
}
