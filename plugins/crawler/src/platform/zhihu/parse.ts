/**
 * zhihu 搜索响应解析：web 搜索 API v3 → 原始条目。
 * Zhihu search response parsing: web search api v3 → raw items.
 *
 * 响应形状：data[]（每项含 type:search_result 包装，实际内容在 object 中；
 * object.type 分为 answer/article/video 三类，字段名不同）。
 * Response shape: data[] (each item wrapped in type:search_result, actual
 * content in object; object.type is answer/article/video with different
 * field names).
 *
 * @module @veren/crawler/platform/zhihu/parse
 */
import type { RawItem } from '../../crawler/contract.ts'

/** 搜索结果包装 / the search result wrapper */
interface ZhihuResultItem {
  type?: string
  object?: ZhihuObject
}

/** 知乎对象的宽松形状（answer/article/video 共有字段 + 各自特有）/ the loose shape of a zhihu object */
interface ZhihuObject {
  type?: string
  id?: number | string
  title?: string
  excerpt?: string
  content?: string
  url?: string
  author?: { name?: string; url_token?: string; headline?: string }
  created_time?: number
  updated_time?: number
  voteup_count?: number
  comment_count?: number
  favorite_count?: number
  question?: { id?: number | string; title?: string }
}

/** 搜索响应的宽松形状 / the loose shape of a search response */
interface ZhihuSearchResponse {
  data?: ZhihuResultItem[]
  paging?: { is_end?: boolean }
}

/** 作者信息提取 / extracts author info */
function authorOf(obj: ZhihuObject): { creatorId: string; nickname: string } {
  return {
    creatorId: obj.author?.url_token ?? obj.author?.name ?? '',
    nickname: obj.author?.name ?? '',
  }
}

/** 互动计数提取 / extracts interaction counters */
function countersOf(obj: ZhihuObject): { liked: number | null; comment: number | null; collected: number | null } {
  return {
    liked: obj.voteup_count ?? null,
    comment: obj.comment_count ?? null,
    collected: obj.favorite_count ?? null,
  }
}

/** 知乎对象 URL 构造（按类型分发）/ builds the url by object type */
function urlOf(obj: ZhihuObject): string {
  if (obj.type === 'article') return obj.url ?? `https://zhuanlan.zhihu.com/p/${obj.id ?? ''}`
  if (obj.question?.id !== undefined) return `https://www.zhihu.com/question/${obj.question.id}/answer/${obj.id ?? ''}`
  return obj.url ?? ''
}

/** 单对象转原始条目 / one zhihu object to a raw item */
function objToRawItem(obj: ZhihuObject): RawItem | null {
  if (obj.id === undefined) return null
  const author = authorOf(obj)
  const counters = countersOf(obj)
  return {
    id: String(obj.id),
    title: obj.title ?? null,
    desc: obj.excerpt ?? obj.content ?? null,
    url: urlOf(obj),
    publishTime: obj.created_time === undefined ? null : String(obj.created_time),
    likedCount: counters.liked,
    commentCount: counters.comment,
    collectedCount: counters.collected,
    shareCount: null,
    imageList: [],
    videoUrl: null,
    tagList: null,
    creatorId: author.creatorId,
    nickname: author.nickname,
  }
}

/**
 * 解析 zhihu 搜索响应为原始条目列表；空结果返回空数组（空页终止）。
 * Parses a zhihu search response into raw items; empty results yield an
 * empty array (the empty-page stop).
 */
export function parseZhihuSearchResponse(payload: unknown): RawItem[] {
  if (payload === null || typeof payload !== 'object') return []
  const response = payload as ZhihuSearchResponse
  const items: RawItem[] = []
  for (const wrapper of response.data ?? []) {
    if (wrapper.type !== 'search_result' || wrapper.object === undefined) continue
    const parsed = objToRawItem(wrapper.object)
    if (parsed !== null) items.push(parsed)
  }
  return items
}

/** 是否还有下一页：paging.is_end !== true / whether a next page exists: paging.is_end !== true */
export function zhihuHasMore(payload: unknown): boolean {
  if (payload === null || typeof payload !== 'object') return false
  const response = payload as ZhihuSearchResponse
  return response.paging?.is_end !== true
}
