/**
 * 微博评论伴随采集：解析与游标分页（crawler.md「评论采集作为内容采集
 * 的伴随动作，由开关控制」）。
 * Weibo companion comment collection: parsing and cursor pagination
 * (crawler.md: comments accompany contents, gated by switches).
 *
 * 接口：m.weibo.cn comments/hotflow（mid=内容 id，max_id 游标）。
 * Endpoint: m.weibo.cn comments/hotflow (mid = content id, max_id cursor).
 *
 * @module @veren/crawler/platform/wb/comments
 */
import type { RawComment } from '../../crawler/contract.ts'
import type { FetchJson } from './crawler.ts'

/** 单条评论的宽松形状 / the loose shape of one comment */
interface WbComment {
  id?: string | number
  text?: string
  like_count?: number
  total_number?: number
  user?: { idstr?: string; screen_name?: string }
}

/** 评论响应的宽松形状 / the loose shape of a comments response */
interface WbCommentsResponse {
  ok?: number
  max_id?: number | string
  max_id_type?: number
  data?: WbComment[]
}

/** 评论游标 / the comment cursor */
export interface CommentCursor {
  maxId: number | string | null
  maxIdType: number
}

/** 初始评论游标 / the initial comment cursor */
export const INITIAL_COMMENT_CURSOR: CommentCursor = { maxId: 0, maxIdType: 0 }

/** 评论响应 → 原始评论条目 / maps a comments response onto raw comments */
export function parseWbComments(contentId: string, payload: unknown): RawComment[] {
  if (payload === null || typeof payload !== 'object') return []
  const response = payload as WbCommentsResponse
  const comments: RawComment[] = []
  for (const comment of response.data ?? []) {
    if (comment.id === undefined || comment.user?.idstr === undefined) continue
    comments.push({
      id: String(comment.id),
      contentId,
      parentCommentId: null,
      content: comment.text ?? '',
      likeCount: comment.like_count ?? null,
      subCommentCount: comment.total_number ?? null,
      pictures: null,
      publishTime: null,
      creatorId: comment.user.idstr,
      nickname: comment.user.screen_name ?? '',
    })
  }
  return comments
}

/** 提取下一页游标；耗尽返回 null / extracts the next cursor; null when exhausted */
export function nextCommentCursor(payload: unknown): CommentCursor | null {
  if (payload === null || typeof payload !== 'object') return null
  const response = payload as WbCommentsResponse
  if (response.ok !== 1 || response.max_id === undefined || Number(response.max_id) === 0) return null
  return { maxId: response.max_id, maxIdType: response.max_id_type ?? 0 }
}

/**
 * 采集一条内容的评论：游标分页直到数量上限或游标耗尽。
 * Collects one content's comments: cursor pages until the count cap or
 * cursor exhaustion.
 */
export async function collectWbComments(options: {
  contentId: string
  fetchJson: FetchJson
  sink: { comment(comment: RawComment): Promise<void> }
  maxCount: number
  startCursor?: CommentCursor
}): Promise<number> {
  let cursor: CommentCursor | null = options.startCursor ?? INITIAL_COMMENT_CURSOR
  let collected = 0
  while (collected < options.maxCount && cursor !== null) {
    const url = commentUrl(options.contentId, cursor)
    const payload = await options.fetchJson(url)
    for (const raw of parseWbComments(options.contentId, payload)) {
      if (collected >= options.maxCount) break
      await options.sink.comment(raw)
      collected += 1
    }
    cursor = nextCommentCursor(payload)
  }
  return collected
}

/** 评论接口地址 / the comments endpoint url */
function commentUrl(contentId: string, cursor: CommentCursor): string {
  return `https://m.weibo.cn/comments/hotflow?id=${contentId}&mid=${contentId}&max_id=${cursor.maxId ?? 0}&max_id_type=${cursor.maxIdType}`
}
