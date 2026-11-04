/**
 * 贴吧评论解析：mo/q/getpb 服务端渲染页的楼层 `<li>` 提取
 * （design/modules/crawler.md §5：tieba 大量数据经页面取回——评论走
 * 服务端渲染页，楼层结构稳定可解析）。
 * Tieba comment parsing: floor `<li>` extraction from the server-rendered
 * mo/q/getpb page (crawler.md §5: much tieba data comes from pages; the
 * floor structure is stable and parseable).
 *
 * 楼层锚点：`<li tid=...>` 块内 `data-info="{json}"`（pid/用户名/楼号）；
 * 正文取 li 块内去标签文本。
 * Floor anchors: the `<li tid=...>` blocks carry `data-info="{json}"`
 * (pid, user, floor); the body text is the tag-stripped li block.
 *
 * @module @veren/crawler/platform/tieba/comments
 */
import type { RawComment } from '../../crawler/contract.ts'

/** 评论页锚点 / the comment-page anchor */
const LI_ANCHOR = '<li tid='

/** HTML 反转义（JSON 字符串内的实体先还原再 parse）/ unescape html entities before JSON.parse */
function unescapeJson(raw: string): string {
  return raw
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')
}

/** 去 HTML 标签与压缩空白得正文文本 / strips tags and collapses whitespace into plain text */
function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 单楼块的宽松字段 / loose fields of one floor block */
interface FloorFields {
  pid: string | null
  user: string | null
  nickname: string | null
}

/** 从楼块提取 data-info 字段 / extracts the data-info fields from a floor block */
function floorFields(block: string): FloorFields {
  const info = block.match(/data-info="([^"]+)"/)?.[1]
  if (info === undefined) return { pid: null, user: null, nickname: null }
  try {
    const parsed = JSON.parse(unescapeJson(info)) as { pid?: number | string; un?: string; name_show?: string }
    return {
      pid: parsed.pid === undefined ? null : String(parsed.pid),
      user: parsed.un ?? null,
      nickname: parsed.name_show ?? null,
    }
  } catch {
    return { pid: null, user: null, nickname: null }
  }
}

/**
 * 从 getpb HTML 解析楼层评论：锚点定位 → data-info 字段 → 去标签正文。
 * Parses floors from the getpb html: anchor split → data-info fields →
 * tag-stripped body.
 */
export function parseTiebaComments(contentId: string, html: string): RawComment[] {
  const comments: RawComment[] = []
  let cursor = html.indexOf(LI_ANCHOR)
  while (cursor >= 0) {
    const end = html.indexOf('</li>', cursor)
    if (end < 0) break
    const block = html.slice(cursor, end)
    const fields = floorFields(block)
    if (fields.pid !== null) {
      comments.push({
        id: fields.pid,
        contentId,
        parentCommentId: null,
        content: stripTags(block).slice(0, 2000),
        likeCount: null,
        subCommentCount: null,
        pictures: null,
        publishTime: null,
        creatorId: fields.user ?? fields.pid,
        nickname: fields.nickname ?? fields.user ?? '',
      })
    }
    cursor = html.indexOf(LI_ANCHOR, end)
  }
  return comments
}

/** 评论分页地址（pn 从 1 起）/ the comments page url (pn starts at 1) */
export function tiebaCommentsUrl(contentId: string, page: number): string {
  return `https://tieba.baidu.com/mo/q/getpb?kz=${contentId}&pn=${page}`
}

/** 是否还有下一页：本页有楼层即继续（getpb 无显式 has_more）/ more pages while the page had floors */
export function tiebaCommentsHasMore(html: string): boolean {
  return html.includes(LI_ANCHOR)
}

/** 评论文本获取抽象 / the raw-text fetch abstraction */
export type FetchText = (url: string) => Promise<string>

/**
 * 伴随采集一条帖子的评论：游标分页直到数量上限或无楼层。
 * Collects one thread's comments: pages until the count cap or no floors.
 */
export async function collectTiebaComments(options: {
  contentId: string
  fetchText: FetchText
  sink: { comment(comment: RawComment): Promise<void> }
  maxCount: number
}): Promise<number> {
  let page = 1
  let collected = 0
  while (collected < options.maxCount) {
    const html = await options.fetchText(tiebaCommentsUrl(options.contentId, page))
    const floors = parseTiebaComments(options.contentId, html)
    if (floors.length === 0) break
    for (const floor of floors) {
      if (collected >= options.maxCount) break
      await options.sink.comment(floor)
      collected += 1
    }
    if (!tiebaCommentsHasMore(html)) break
    page += 1
  }
  return collected
}
/**
 * 从 getpb 页解析帖子详情：页面标题 + 首楼正文与作者。
 * Parses the thread detail from a getpb page: the page title plus the
 * first floor's body and author.
 *
 * @returns 原始内容条目；无首楼时为 null / the raw item, or null when the page has no first floor
 */
export function parseTiebaThreadDetail(tid: string, html: string): {
  id: string
  title: string | null
  desc: string | null
  url: string
  publishTime: string | null
  likedCount: number | null
  commentCount: number | null
  collectedCount: null
  shareCount: null
  imageList: string[]
  videoUrl: null
  tagList: null
  creatorId: string
  nickname: string
} | null {
  const title = html.match(/<title>([^<]+)<\/title>/)?.[1]?.replace(/_贴吧.*$/, '').trim() ?? null
  const anchor = html.indexOf('<li tid=')
  if (anchor < 0) return null
  const end = html.indexOf('</li>', anchor)
  const block = html.slice(anchor, end < 0 ? html.length : end)
  const info = block.match(/data-info="([^"]+)"/)?.[1]
  let user = ''
  let nickname = ''
  if (info !== undefined) {
    try {
      const parsed = JSON.parse(unescapeJson(info)) as { un?: string; name_show?: string }
      user = parsed.un ?? ''
      nickname = parsed.name_show || parsed.un || ''
    } catch {
      user = ''
    }
  }
  const body = stripTags(block)
  const desc = title !== null && body.startsWith(title) ? body.slice(title.length).trim() : body
  return {
    id: tid,
    title,
    desc: desc.length > 0 ? desc : null,
    url: `https://tieba.baidu.com/p/${tid}`,
    publishTime: null,
    likedCount: null,
    commentCount: null,
    collectedCount: null,
    shareCount: null,
    imageList: [],
    videoUrl: null,
    tagList: null,
    creatorId: user,
    nickname,
  }
}