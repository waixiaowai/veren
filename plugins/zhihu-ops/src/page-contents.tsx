/** @jsxRuntime automatic @jsxImportSource @veren/prompt-core */
/**
 * 内容页：账号自己每篇内容的最新表现与区间增量。
 *
 * 正文按区间阅读增量排序——"哪篇在动"排在前面，而不是按绝对阅读量。互动率
 * 是代理指标（赞+评论+收藏 除以阅读），因为官方只读通道没有完读率。
 *
 * The contents page: each of the account's own contents with its latest
 * performance and the window's growth.
 *
 * The body orders by the window's view growth — "which piece is moving" comes
 * first, not the largest absolute count. The engagement rate is a proxy (likes
 * + comments + collects over views), because the read-only official channel
 * carries no read-through rate.
 *
 * @module @veren/zhihu-ops/page-contents
 */
import type { ComponentPageMeta, PageFC } from '@veren/prompt-page'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { contentPerformance, moversOf } from './collect/metrics.ts'
import { toolOf } from './runtime.ts'
import { requireRuntime } from './runtime.ts'
import { STRINGS, URL_PREFIX } from './pages.tsx'

/**
 * 本页挂载的工具：列内容、看单篇趋势。
 * The tools this page mounts: list contents, read one content's trend.
 *
 * @param agent - the page session's agent / 页面会话的 agent
 */
function registerContentTools(agent: Agent): void {
  for (const localName of ['list_contents', 'content_trend']) {
    agent.ctx.tools.register(toolOf(localName))
  }
}

/** 内容页组件体（一次性渲染）/ the contents page's body (the one-shot render) */
export const ContentsPage: PageFC = (_props, agent) => {
  registerContentTools(agent)
  const runtime = requireRuntime()
  const performances = runtime.storage.contents().map((profile) => contentPerformance(profile, runtime.storage.contentStats()))
  const movers = moversOf(performances, 20)
  return (
    <>
      <h1>内容表现</h1>
      <p>按区间阅读增量排序 · 互动率 =（赞 + 评论 + 收藏）/ 阅读</p>
      <ul>
        {movers.map((item) => (
          <li key={item.contentId}>
            <strong>{item.title}</strong>（{item.contentType}）
            {' · '}阅读 {item.viewCount}（{item.viewDelta >= 0 ? '+' : ''}{item.viewDelta}）
            {' · '}赞 {item.likeCount} · 评论 {item.commentCount} · 收藏 {item.collectCount}
            {' · '}互动率 {item.engagementRate}
          </li>
        ))}
        {movers.length === 0 ? <li>{STRINGS.empty.zh}</li> : null}
      </ul>
      <blockquote>{STRINGS.snapshot.zh}</blockquote>
    </>
  )
}

export const ContentsMeta: ComponentPageMeta = {
  name: 'contents',
  url: `${URL_PREFIX}/contents`,
  description: '账号每篇内容的最新表现与区间增量，按增量排序',
  writes: false,
  unattended: {
    serves: '盘点哪几篇内容在涨、哪几篇停了，供选题与复盘决策',
    level: 'L0',
    evidence: 'read-only',
    escape: 'none-needed',
  },
  instructions: [
    '这是内容表现页。正文按区间阅读增量排序，每篇带最新阅读、赞、评论、收藏与互动率。',
    '要机器可读的清单用 list_contents；要某一篇的逐日曲线用 content_trend（参数是内容 id）。',
    '互动率是代理指标（赞+评论+收藏 除以阅读）——官方只读通道不提供完读率与阅读率，不要凭空推断。',
    '正文是打开时刻的快照；区间增量以工具返回为准。',
  ].join(''),
}
