/** Normalizes Gitea issues, pull requests, comments, reviews, and CI status transitions into domain Triggers. */
/** 将 Gitea 的 Issue、PR、评论、评审与 CI 状态变化归一为领域 Trigger。 */
import { z } from 'zod'
import { key, type ChannelRef, type Trigger } from '../core/index.ts'
import { escapeRegExp, sameName } from '../infra/text.ts'

export const SOURCE = 'gitea'
/** Gitea reply address: an issue/PR conversation, or a review thread when `url` points at a discussion comment. */
/** Gitea 回复地址：Issue/PR 会话；`url` 指向评审讨论评论时为评审线程。 */
export const giteaChannel = (number: number, url?: string): ChannelRef =>
  ({ source: SOURCE, thread: `gitea:${number}`, address: { number: String(number), ...(url ? { url } : {}) } })
/** Gitea renders a pull request page under `/pulls/`, unlike GitHub's `/pull/`. */
/** Gitea 的 PR 页面路径是 `/pulls/`（GitHub 是 `/pull/`）。 */
export const giteaPage = (host: string, repository: string, number: number, pr = false): string =>
  `${host}/${repository}/${pr ? 'pulls' : 'issues'}/${number}`
/**
 * Parses a web or API URL for an Issue, PR, or review comment on `host` in `repository`; returns undefined for other
 * URLs or repositories. Gitea API URLs carry the `/api/v1/repos` prefix (one more segment than the web form) and
 * often appear in notification subjects.
 */
/** 解析 `host` 上 `repository` 内 Issue/PR/评审评论的网页或 API URL；其他 URL 或仓库返回 undefined。Gitea 的 API URL 带 `/api/v1/repos` 前缀（比网页形态多一段），常出现在通知主题里。 */
export function giteaAddress(url: string, host: string, repository: string): { number: number; pr: boolean; discussion?: number } | undefined {
  const origin = host.replace(/\/+$/, '')
  const address = new RegExp(`^${escapeRegExp(origin)}(?:/api/v1)?(?:/repos)?/([^/]+/[^/]+)/(issues|pulls?)/(\\d+)/?(?:#discussion_r(\\d+)|#[\\w-]*)?$`, 'i')
  const match = address.exec(url)
  if (!match || !sameName(match[1]!, repository)) return undefined
  return { number: Number(match[3]), pr: match[2]!.toLowerCase() !== 'issues', ...match[4] ? { discussion: Number(match[4]) } : {} }
}
/** Gitea returns a deleted account as `null` and displays it as `ghost`, like GitHub. */
/** Gitea 把已删除账号返回为 `null` 并显示为 `ghost`，与 GitHub 一致。 */
export const UserSchema = z.looseObject({ login: z.string(), type: z.string().optional() }).nullable()
  .transform(user => user ?? { login: 'ghost', type: 'User' })
/**
 * A Gitea comment or review; a review carries `state` and `commit_id`, and Gitea reviews name their text `content`
 * rather than `body`, which `ReviewSchema` normalizes before a review reaches `CommentSchema`.
 */
/** Gitea 的评论或评审；评审带 `state` 与 `commit_id`，且 Gitea 评审正文叫 `content` 而非 `body`，由 `ReviewSchema` 先归一再进 `CommentSchema`。 */
export const CommentSchema = z.looseObject({
  id: z.number(), body: z.string().nullish(), user: UserSchema, html_url: z.string().nullish(),
  created_at: z.string().nullish(), updated_at: z.string().nullish(), submitted_at: z.string().nullish(),
  state: z.string().nullish(), commit_id: z.string().nullish(),
  path: z.string().nullish(), line: z.number().nullish(), original_line: z.number().nullish(), diff_hunk: z.string().nullish(),
  in_reply_to_id: z.number().nullish(),
})
export type GiteaComment = z.infer<typeof CommentSchema>
/** An Issue as `issues/<index>` returns it; Gitea sets `pull_request` when the entry is a pull request. */
/** `issues/<index>` 返回的 Issue；条目是 PR 时 Gitea 会设置 `pull_request`。 */
export const IssueSchema = CommentSchema.extend({
  number: z.number(), title: z.string(), state: z.string(), created_at: z.string(), html_url: z.string(),
  pull_request: z.looseObject({ merged: z.boolean().nullish(), merged_at: z.string().nullish() }).nullish(),
})
export type GiteaIssue = z.infer<typeof IssueSchema>
type Opened = Pick<GiteaIssue, 'number' | 'title' | 'body' | 'user' | 'created_at' | 'html_url'>
export interface PullRef { number: number; isPr: boolean; url?: string; prAuthor?: string }
/** True when Gitea reports the account as a regular user rather than a bot or Actions account. */
/** 当 Gitea 报告该账号是普通用户而非机器人或 Actions 账号时为真。 */
export const isHumanLogin = (user: { login: string; type?: string }): boolean =>
  !/\[bot\]$/.test(user.login) && (!user.type || user.type === 'User')
/** Formats a review comment's file:line and diff hunk; Gitea review comments carry `path`/`line` like GitHub's. */
/** 格式化评审评论的文件：行号与 diff 片段；Gitea 的评审评论像 GitHub 一样带 `path`/`line`。 */
export function reviewPlace(comment: GiteaComment): string {
  const line = comment.line ?? comment.original_line
  const hunk = (comment.diff_hunk ?? '').split('\n').slice(-3).join('\n')
  return [`${comment.path}${line != null ? `:${line}` : ''}`, hunk].filter(Boolean).join('\n')
}
function commentText(comment: GiteaComment, kind: 'conversation' | 'review'): string {
  const decided = kind === 'review' && comment.state && comment.state !== 'COMMENT'
  const decision = decided ? `${comment.state} review of commit ${comment.commit_id ?? 'unknown'}` : ''
  return [decision, comment.body ?? ''].filter(Boolean).join('\n\n')
}
export const mentions = (text: string, login: string): boolean =>
  new RegExp(`(?:^|[^a-zA-Z0-9_@])@${escapeRegExp(login)}(?![a-zA-Z0-9_-])`, 'i').test(text)
const author = (user: { login: string; type?: string }, agent: string) =>
  ({ actor: { source: SOURCE, id: user.login }, human: isHumanLogin(user) && !sameName(user.login, agent) })
/** Builds a trigger for a conversation comment or a review; text is empty for a bodyless comment or a `COMMENT` review without content. */
/** 为会话评论或评审构建 Trigger；空评论或无正文的 `COMMENT` 评审文本为空。 */
export function commentTrigger(comment: GiteaComment, ref: PullRef, kind: 'conversation' | 'review', agent: string): Trigger {
  const at = comment.updated_at ?? comment.submitted_at ?? comment.created_at ?? new Date().toISOString()
  const version = comment.updated_at ?? comment.submitted_at ?? ''
  const id = key('gitea-comment', comment.html_url ?? `gitea:${ref.number}`, String(comment.id), version)
  return { id, source: SOURCE, threads: [{ source: SOURCE, id: String(ref.number) }], ...author(comment.user, agent), at,
    text: commentText(comment, kind),
    ...(mentions(comment.body ?? '', agent) ? { addressed: 'mention' as const } : {}),
    channel: giteaChannel(ref.number, comment.html_url ?? ref.url),
    ...(comment.html_url ?? ref.url ? { url: comment.html_url ?? ref.url } : {}),
    meta: { number: ref.number, isPr: ref.isPr, ...(ref.prAuthor ? { prAuthor: ref.prAuthor } : {}), commentId: comment.id, kind } }
}
/**
 * Builds the trigger for a newly opened Issue's title and body. The ID is stable per Issue so re-reads never re-ingest.
 * A mention added by editing the body later is not read: only the author can be the actor of the body.
 */
/** 为新打开 Issue 的标题与正文构建 Trigger。ID 按 Issue 稳定，重读不会重复入库；之后编辑正文加入的 @ 不被读取：正文的执行者只能是作者。 */
export function issueTrigger(issue: Opened, agent: string): Trigger {
  const body = issue.body ?? ''
  return { id: key('gitea-issue', String(issue.number)), source: SOURCE,
    threads: [{ source: SOURCE, id: String(issue.number) }], ...author(issue.user, agent), at: issue.created_at,
    text: `${issue.title}\n\n${body}`,
    ...(mentions(body, agent) ? { addressed: 'mention' as const } : {}),
    channel: giteaChannel(issue.number, issue.html_url), url: issue.html_url, meta: { number: issue.number, isPr: false, kind: 'issue' } }
}
/**
 * Builds the trigger for a newly opened PR's title and description. PR and Issue numbers share one sequence in Gitea and
 * never collide, so this reuses `issueTrigger`'s `gitea-issue` ID format.
 */
/** 为新打开 PR 的标题与描述构建 Trigger。Gitea 的 PR 与 Issue 编号共用一个序列且不会冲突，因此复用 `issueTrigger` 的 `gitea-issue` ID 格式。 */
export function pullTrigger(pull: Opened, agent: string): Trigger {
  return { ...issueTrigger(pull, agent), meta: { number: pull.number, isPr: true, prAuthor: pull.user.login, kind: 'pull' } }
}
/** Builds a trigger for a default-branch CI status transition; default-branch CI has no person to reply to, so it has no `channel`. */
/** 为默认分支 CI 状态变化构建 Trigger；默认分支 CI 没有可回复的人，因此没有 `channel`。 */
export function branchCiTrigger(branch: string, sha: string, revision: number, summary: string, url: string): Trigger {
  return { id: key('gitea-ci', `branch:${branch}`, String(revision)), source: SOURCE,
    threads: [{ source: SOURCE, id: `ci:${branch}` }], actor: { source: SOURCE, id: '' }, human: false, at: new Date().toISOString(),
    text: summary, url, meta: { ci: true, branch, sha, revision } }
}
export function ciTrigger(pr: { number: number; html_url: string; user: { login: string } }, revision: number, summary: string): Trigger {
  return { id: key('gitea-ci', String(pr.number), String(revision)), source: SOURCE, threads: [{ source: SOURCE, id: String(pr.number) }],
    actor: { source: SOURCE, id: '' }, human: false, at: new Date().toISOString(),
    text: summary, channel: giteaChannel(pr.number), url: pr.html_url,
    meta: { number: pr.number, isPr: true, prAuthor: pr.user.login, ci: true, revision } }
}
