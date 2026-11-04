/**
 * 贴吧搜索响应解析：mo/q/search/thread 帖子列表 → 原始条目
 * （design/modules/crawler.md §5：tieba 无加密签名，免登录 JSON 通道）。
 * Tieba search response parsing: the mo/q/search/thread thread list → raw
 * items (crawler.md §5: tieba has no encrypted signature and this json
 * channel needs no login).
 *
 * @module @veren/crawler/platform/tieba/parse
 */
import type { RawItem } from '../../crawler/contract.ts'

/** 单条帖子的宽松形状 / the loose shape of one thread */
interface TiebaThread {
  tid?: string | number
  title?: string
  content?: string
  time?: number | string
  like_num?: number
  post_num?: number
  user?: { id?: string | number; user_name?: string; show_name?: string }
  media?: Array<{ big_pic?: string; small_pic?: string; water_pic?: string }>
}

/** 搜索响应的宽松形状 / the loose shape of a search response */
interface TiebaSearchResponse {
  no?: number
  data?: { has_more?: number; post_list?: TiebaThread[] }
}

/** 媒体地址聚合（大图优先）/ aggregates media urls (big pic first) */
function mediaOf(thread: TiebaThread): string[] {
  return (thread.media ?? [])
    .map((media) => media.big_pic ?? media.small_pic ?? media.water_pic ?? '')
    .filter((url) => url.length > 0)
}

/** 单帖转原始条目 / one thread to a raw item */
function threadToRawItem(thread: TiebaThread): RawItem | null {
  if (thread.tid === undefined || thread.user === undefined) return null
  const creatorId = thread.user.id !== undefined ? String(thread.user.id) : thread.user.user_name ?? ''
  return {
    id: String(thread.tid),
    title: thread.title ?? null,
    desc: typeof thread.content === 'string' && thread.content.length > 0 ? thread.content : thread.title ?? null,
    url: `https://tieba.baidu.com/p/${String(thread.tid)}`,
    publishTime: thread.time === undefined ? null : String(thread.time),
    likedCount: thread.like_num ?? null,
    commentCount: thread.post_num ?? null,
    collectedCount: null,
    shareCount: null,
    imageList: mediaOf(thread),
    videoUrl: null,
    tagList: null,
    creatorId,
    nickname: thread.user.show_name || thread.user.user_name || '',
  }
}

/**
 * 解析贴吧搜索响应为原始条目列表；空页/失败响应返回空数组（空页终止）。
 * Parses a tieba search response into raw items; empty or failed payloads
 * yield an empty array (the empty-page stop).
 */
export function parseTiebaSearchResponse(payload: unknown): RawItem[] {
  if (payload === null || typeof payload !== 'object') return []
  const response = payload as TiebaSearchResponse
  if (response.no !== 0) return []
  const items: RawItem[] = []
  for (const thread of response.data?.post_list ?? []) {
    const parsed = threadToRawItem(thread)
    if (parsed !== null) items.push(parsed)
  }
  return items
}

/** 是否还有下一页：no=0 且 has_more=1 / whether a next page exists: no=0 and has_more=1 */
export function tiebaHasMore(payload: unknown): boolean {
  if (payload === null || typeof payload !== 'object') return false
  const response = payload as TiebaSearchResponse
  return response.no === 0 && response.data?.has_more === 1
}
