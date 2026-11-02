/** Read-only Gitea repository, conversation, and CI status inspection for assessments and workers. */
/** 供评估与执行器只读 Gitea 仓库、会话与 CI 状态。 */
import { z } from 'zod'
import { validItems, type Commands, type Tally } from '../infra/commands.ts'
import { ciCounts, ciSummary, type CiSnapshot } from './github-read.ts'
import { CommentSchema, IssueSchema, UserSchema, isHumanLogin, reviewPlace, type GiteaComment } from './gitea-trigger.ts'
import type { ContextMessage, ThreadContext } from './kind.ts'

/**
 * Gitea has no check-run API: a commit's CI is its commit statuses (`pending`/`success`/`warning`/`failure`/`error`),
 * so a snapshot's `checks` stays empty. `warning` counts as neither failing nor running.
 */
/** Gitea 没有 check-run API：一次提交的 CI 就是它的提交状态（`pending`/`success`/`warning`/`failure`/`error`），快照的 `checks` 恒为空。`warning` 既不算失败也不算进行中。 */
const StatusSchema = z.looseObject({ context: z.string(), status: z.string() })
/** Gitea commit status states that count as failures; `success`, `warning`, and `skipped` do not. */
/** 计为失败的 Gitea 提交状态；`success`、`warning`、`skipped` 不算。 */
const FAILING = new Set(['failure', 'error'])

/** Reads a commit's statuses as a CI snapshot whose `checks` is empty (Gitea has no check runs). */
/** 把一次提交的状态读成 CI 快照，`checks` 恒为空（Gitea 没有 check runs）。 */
export async function pullChecks(commands: Commands, head: string, tally?: Tally): Promise<CiSnapshot> {
  const statuses = await commands.giteaPages(StatusSchema, `commits/${encodeURIComponent(head)}/statuses?limit=50`, tally)
  const latest = new Map<string, string>()
  // Gitea returns newest first, like GitHub; walk in order so the first sighting per context is the latest.
  // Gitea 与 GitHub 一样按最新在前返回；按顺序遍历，每个 context 首次出现即为最新。
  for (const status of statuses) if (!latest.has(status.context)) latest.set(status.context, status.status)
  return { head, checks: [], statuses: [...latest].map(([context, state]) => ({ context, state })).sort((a, b) => a.context.localeCompare(b.context)) }
}
export { ciCounts, ciSummary }
/** The one-line CI summary reads statuses only, since Gitea's snapshot carries no check runs. */
/** 单行 CI 摘要只读状态，因为 Gitea 的快照没有 check runs。 */
export const giteaCiSummary = (snapshot: CiSnapshot, where: string, read: string): string => ciSummary(snapshot, where, read)

/** Reads a non-hidden file or directory listing from the repository's default branch; hidden entries and `node_modules` are rejected. */
/** 读取仓库默认分支上一个非隐藏文件或目录列表；隐藏条目与 `node_modules` 被拒绝。 */
export async function readRepositoryPath(commands: Commands, path: string, kind: 'file' | 'directory'): Promise<string> {
  const parts = path.split('/').filter(part => part && part !== '.')
  if (parts.some(part => part === '..' || part.startsWith('.') || part === 'node_modules')) throw new Error('Only non-hidden repository source paths are available')
  if (kind === 'file') return commands.gitea(`contents/${parts.map(encodeURIComponent).join('/')}?raw=true`)
  const entries = await commands.gitea(z.array(z.looseObject({ name: z.string() })), `contents/${parts.map(encodeURIComponent).join('/')}`)
  return entries.map(entry => entry.name).filter(name => !name.startsWith('.') && name !== 'node_modules').sort().join('\n')
}

/** Formats a Gitea comment, review, or issue as a model-facing ContextMessage, marking bot accounts because bot messages never authorize work. */
/** 把 Gitea 评论、评审或 Issue 格式化为面向模型的 ContextMessage，机器人账号被标记——机器人的话永远不能授权工作。 */
function giteaMessage(item: GiteaComment, text: string, id: string): ContextMessage {
  const line = item.line ?? item.original_line
  return { id, from: item.user.login, at: item.created_at ?? item.submitted_at ?? '', text,
    ...!isHumanLogin(item.user) ? { bot: true } : {}, ...item.html_url ? { url: item.html_url } : {},
    ...item.path ? { path: item.path, ...line != null ? { line } : {} } : {} }
}
const reviewText = (review: GiteaComment): string =>
  [review.state && review.state !== 'COMMENT' ? review.state : '', review.body ?? ''].filter(Boolean).join('\n\n')
/** A Gitea review names its text `content`, and `state` is absent unless it is an approval or a change request. */
/** Gitea 的评审正文叫 `content`，且只有批准或请求修改时才有 `state`。 */
export const ReviewSchema = z.looseObject({ id: z.number(), content: z.string().nullish(), user: UserSchema,
  official: z.boolean().nullish(), created_at: z.string().nullish(), state: z.string().nullish(), commit_id: z.string().nullish(),
  html_url: z.string().nullish(), original_author: z.string().nullish() })
/** Normalizes a Gitea review into the `CommentSchema` shape the trigger builders take. */
/** 把 Gitea 评审归一为 Trigger 构建器接受的 `CommentSchema` 形状。 */
export const reviewOf = (review: z.infer<typeof ReviewSchema>): GiteaComment => ({ id: review.id, body: review.content ?? '',
  user: review.user, html_url: review.html_url ?? null, created_at: review.created_at ?? null, updated_at: null,
  state: review.state ?? null, commit_id: review.commit_id ?? null, path: null, line: null, original_line: null, diff_hunk: null,
  in_reply_to_id: null })
const DescriptionSchema = IssueSchema.extend({
  labels: z.array(z.looseObject({ name: z.string() })).nullish(), draft: z.boolean().nullish(), merged: z.boolean().nullish(),
  head: z.looseObject({ ref: z.string() }).nullish(), base: z.looseObject({ ref: z.string() }).nullish(),
})
/** Reads one page of an Issue or PR conversation (description first on page 1), using comment URLs as message IDs. */
/** 读一页 Issue/PR 会话（第 1 页先给正文），评论 URL 作为消息 ID。 */
async function conversationPage(commands: Commands, number: number, page: number) {
  const messages: ContextMessage[] = []
  if (page === 1) {
    const issue = await commands.gitea(IssueSchema, `issues/${number}`)
    messages.push(giteaMessage(issue, `${issue.title}\n\n${issue.body ?? ''}`, issue.html_url))
  }
  const listed = await commands.gitea(z.array(z.unknown()), `issues/${number}/comments?limit=50&page=${page}`)
  const tally = { skipped: 0 }
  const comments = validItems(CommentSchema, listed, tally)
  messages.push(...comments.map(comment => giteaMessage(comment, comment.body ?? '', comment.html_url ?? String(comment.id))))
  return { messages, next_resource: listed.length === 50 ? String(page + 1) : null, ...tally.skipped ? { skipped: tally.skipped } : {} }
}
/** Gitea has no inline review comments in this Source, so a conversation is flat: page 1 is its root and parent. */
/** 本来源不读 Gitea 的行内评审评论，因此会话是平的：第 1 页即根与父。 */
export const giteaThreadContext: ThreadContext<unknown> = {
  messageId: trigger => trigger.url ?? '',
  read: async (commands, trigger, part, cursor) => {
    // The default branch's CI has no conversation; its Trigger is its context.
    // 默认分支的 CI 没有会话；它的 Trigger 就是它的上下文。
    if (typeof trigger.meta.branch === 'string') {
      const message = { id: trigger.url ?? trigger.id, from: 'CI', at: trigger.at, text: trigger.text, bot: true as const }
      return { messages: [message], body: { status: 'branch_ci', messages: [message] }, status: 'branch_ci' }
    }
    const number = Number(trigger.meta.number)
    const body = await conversationPage(commands, number, Number(cursor ?? '1'))
    return { messages: body.messages, next: body.next_resource ?? undefined, body }
  },
}
/**
 * Reads an Issue or PR, a page of its comments, its reviews, or a CI status snapshot as model-facing
 * `{ id, from, at, text, url }` messages rather than raw Gitea API records. Gitea has no review-comment
 * threads in this Source, so inline review discussion is read as reviews only.
 */
/** 把 Issue/PR、一页评论、评审列表或 CI 状态快照读成面向模型的 `{ id, from, at, text, url }` 消息，而非原始 Gitea API 记录。本来源不读行内评审评论，评审讨论只以评审形式读。 */
export async function readGitea(commands: Commands, resource: string): Promise<unknown> {
  const commit = /^gitea\/commits\/([0-9a-f]{7,40})\/checks$/.exec(resource)
  if (commit) return pullChecks(commands, commit[1]!)
  const match = /^gitea\/(issues|pulls)\/([1-9]\d*)(?:\/(comments|reviews|checks)(?:\/([1-9]\d*))?)?$/.exec(resource)
  if (!match) {
    throw new Error('Use gitea/issues/<number>, gitea/pulls/<number>, or append /comments/<page>, /reviews/<page> or /checks; or gitea/commits/<sha>/checks')
  }
  const [, kind, number, section, page = '1'] = match
  if (kind === 'issues' && (section === 'reviews' || section === 'checks')) throw new Error('Reviews and checks require a pull request')
  const path = `${kind}/${number}`
  if (section === 'checks') {
    const pr = await commands.gitea(z.looseObject({ head: z.looseObject({ sha: z.string() }) }), path)
    return pullChecks(commands, pr.head.sha)
  }
  if (!section) {
    const item = await commands.gitea(DescriptionSchema, path)
    const branches = item.head && item.base ? { head: item.head.ref, base: item.base.ref } : {}
    const labels = item.labels?.length ? { labels: item.labels.map(label => label.name) } : {}
    return { number: item.number, title: item.title, state: item.state, ...item.merged ? { merged: true } : {},
      ...item.draft ? { draft: true } : {}, ...branches, ...labels, ...giteaMessage(item, item.body ?? '', String(item.number)) }
  }
  if (section === 'reviews') {
    const listed = await commands.gitea(z.array(z.unknown()), `pulls/${number}/reviews?limit=50&page=${page}`)
    const tally = { skipped: 0 }
    const reviews = validItems(ReviewSchema, listed, tally)
    const messages = reviews.map(review => giteaMessage(reviewOf(review), reviewText(reviewOf(review)), String(review.id)))
    return { messages, ...tally.skipped ? { skipped: tally.skipped } : {},
      ...listed.length === 50 ? { next_resource: `gitea/pulls/${number}/reviews/${Number(page) + 1}` } : {} }
  }
  const listed = await commands.gitea(z.array(z.unknown()), `${path}/comments?limit=50&page=${page}`)
  const tally = { skipped: 0 }
  const items = validItems(CommentSchema, listed, tally)
  const messages = items.map(item => giteaMessage(item, item.body ?? '', String(item.id)))
  return { messages, ...tally.skipped ? { skipped: tally.skipped } : {},
    ...listed.length === 50 ? { next_resource: `gitea/${kind}/${number}/comments/${Number(page) + 1}` } : {} }
}
