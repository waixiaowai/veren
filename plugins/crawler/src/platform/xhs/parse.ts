/**
 * xhs 搜索响应解析：web 搜索接口 → 原始条目。
 * Xhs search response parsing: web search api → raw items.
 *
 * 响应形状：data.items[]（id=note_id, note_card{title,desc,user{idstr,nickname},
 * interact_info{liked_count}, image_list[]{url}, xsec_token}）；xsec_token 随
 * 条目带出供详情复用（§5 平台差异）。
 * Response shape: data.items[] (id = note_id, note_card{...}); xsec_token
 * carried per item for detail reuse (§5 platform difference).
 *
 * @module @veren/crawler/platform/xhs/parse
 */
import type { RawItem } from '../../crawler/contract.ts'

/** 单条笔记的宽松形状 / the loose shape of one note */
interface XhsNote {
  id?: string
  note_card?: {
    title?: string
    desc?: string
    user?: { user_id?: string; nickname?: string }
    interact_info?: { liked_count?: string }
    image_list?: Array<{ url?: string }>
  }
  xsec_token?: string
}

/** 搜索响应的宽松形状 / the loose shape of a search response */
interface XhsSearchResponse {
  code?: number
  data?: { items?: XhsNote[]; has_more?: boolean }
}

/** 互动计数解析（字符串数字 → number）/ parses the like count (string number → number) */
function likedCountOf(interact: { liked_count?: string } | undefined): number | null {
  if (interact?.liked_count === undefined) return null
  const parsed = parseInt(interact.liked_count, 10)
  return Number.isNaN(parsed) ? null : parsed
}

/** 单条笔记转原始条目 / one note to a raw item */
function noteToRawItem(note: XhsNote): RawItem | null {
  const card = note.note_card
  if (note.id === undefined || card?.user?.user_id === undefined) return null
  const images = (card.image_list ?? [])
    .map((image) => image.url ?? '')
    .filter((url) => url.length > 0)
  return {
    id: note.id,
    title: card.title ?? null,
    desc: card.desc ?? null,
    url: `https://www.xiaohongshu.com/explore/${note.id}?xsec_token=${note.xsec_token ?? ''}`,
    publishTime: null,
    likedCount: likedCountOf(card.interact_info),
    commentCount: null,
    collectedCount: null,
    shareCount: null,
    imageList: images,
    videoUrl: null,
    tagList: null,
    creatorId: card.user.user_id,
    nickname: card.user.nickname ?? '',
    xsecToken: note.xsec_token ?? null,
  }
}

/**
 * 解析 xhs 搜索响应为原始条目列表；code!==0 或空结果返回空数组（空页终止）。
 * Parses an xhs search response into raw items; nonzero code or empty
 * results yield an empty array (the empty-page stop).
 */
export function parseXhsSearchResponse(payload: unknown): RawItem[] {
  if (payload === null || typeof payload !== 'object') return []
  const response = payload as XhsSearchResponse
  if (response.code !== 0) return []
  const items: RawItem[] = []
  for (const note of response.data?.items ?? []) {
    const parsed = noteToRawItem(note)
    if (parsed !== null) items.push(parsed)
  }
  return items
}

/** 是否还有下一页：code=0 且 has_more=true / whether a next page exists: code=0 and has_more=true */
export function xhsHasMore(payload: unknown): boolean {
  if (payload === null || typeof payload !== 'object') return false
  const response = payload as XhsSearchResponse
  return response.code === 0 && response.data?.has_more === true
}
