/** Gitea polling loops: notifications, repository streams, the pull requests of open tickets, and subscribed threads. */
/** Gitea 轮询循环：通知、仓库事件流、打开工单的 PR，以及已订阅线程。 */
import { z } from 'zod'
import { key, type Thread } from '../core/index.ts'
import { sameName } from '../infra/text.ts'
import { CliError, validItems, type Tally } from '../infra/commands.ts'
import { ciFact, ciFailures } from './github-read.ts'
import { ciCounts, giteaCiSummary, pullChecks, ReviewSchema, reviewOf } from './gitea-read.ts'
import { branchCiTrigger, ciTrigger, commentTrigger, CommentSchema, giteaAddress, giteaPage, IssueSchema, issueTrigger, pullTrigger,
  SOURCE } from './gitea-trigger.ts'
import type { GiteaComment } from './gitea-trigger.ts'
import { observePull, pullsOf, readPull, type Pull } from './gitea-pull.ts'
import { health, type SourceContext } from './host.ts'
import { KV, type Retry } from '../kv.ts'
import { cursorAt, pause, POLL_HORIZON_MS, pollThreads as pollEach } from './poll.ts'
import type { GiteaConfig } from './gitea.ts'

/** A notification of the agent account; `subject.url` is the API address of its Issue or PR. */
/** 智能体账号的一条通知；`subject.url` 是其 Issue/PR 的 API 地址。 */
const NotificationSchema = z.looseObject({ repository: z.looseObject({ full_name: z.string() }), subject: z.looseObject({ url: z.string().nullish() }) })
const ListedSchema = CommentSchema.extend({ issue_url: z.string().nullish(), pull_request_url: z.string().nullish() })
/** Repository-wide event streams; Gitea's `/issues` endpoint includes PRs, and `/issues/comments` covers issue and PR conversation comments (Gitea has no repository-wide review-comment stream). */
/** 仓库级事件流；Gitea 的 `/issues` 端点包含 PR，`/issues/comments` 覆盖 Issue 与 PR 的会话评论（Gitea 没有仓库级评审评论流）。 */
const STREAMS = [
  { id: 'issues', observed: (config: GiteaConfig) => config.observeIssues || config.observePulls, path: 'issues?state=all&limit=50' },
  { id: 'comments', observed: (config: GiteaConfig) => config.observeComments, path: 'issues/comments?limit=50' },
] as const
const OBSERVED = { issues: 'observeIssues', pulls: 'observePulls', comments: 'observeComments', ci: 'observeCi' } as const
type Scope = keyof typeof OBSERVED
function scopeOf(meta: Record<string, unknown>): Scope | undefined {
  if (meta.ci === true) return typeof meta.branch === 'string' ? 'ci' : undefined
  if (meta.kind === 'issue') return 'issues'
  if (meta.kind === 'pull') return 'pulls'
  return meta.kind === 'conversation' || meta.kind === 'review' ? 'comments' : undefined
}
export function pollFailure(failures: number, threshold: number, error: unknown) {
  return failures >= threshold ? health('error', 'pollFailures', { count: String(failures), error: String(error) }) : undefined
}
export interface Round {
  started: string; signal?: AbortSignal | undefined
  pulls: Map<number, Promise<Pull>>; read: Set<number>; failures: string[]; dropped: number[]; abandoned: number[]
  tally: Tally
}
export const newRound = (signal?: AbortSignal): Round => ({ started: new Date().toISOString(), signal, pulls: new Map(), read: new Set(),
  failures: [], dropped: [], abandoned: [], tally: { skipped: 0 } })
export const stopped = (ctx: SourceContext, round: Round): boolean => !!round.signal?.aborted || !ctx.config(SOURCE)
const RETRY_WINDOW_MS = 24 * 3600_000
/** True when Gitea returns HTTP 410 (Gone); HTTP 404 is retried because it can indicate revoked access to a private repository. */
/** Gitea 返回 HTTP 410（Gone）时为真；404 会重试，因为它可能只是私有仓库的临时权限问题。 */
const deleted = (error: unknown): boolean => error instanceof CliError && error.code === 410
/** Records a failed read on the Thread and in the round; deleted (410) or abandoned (24h+) threads do not fail the round. */
/** 在线程与轮次上记录一次失败读；已删除（410）或已放弃（24h+）的线程不算轮次失败。 */
function failed(ctx: SourceContext, round: Round, number: number, error: unknown, abandoned = false): void {
  if (deleted(error)) round.dropped.push(number)
  else if (abandoned) round.abandoned.push(number)
  else round.failures.push(`#${number}: ${String(error)}`)
  ctx.threads.patch(`gitea:${number}`, { pollError: String(error) })
}
/**
 * Polls one repository-wide event stream (oldest-first pages, Gitea filters server-side by `since`) and steps the cursor
 * to five seconds before the newest item (`cursorAt`), relying on Trigger ID deduplication so repeated messages are no-ops.
 * Items from before their kind was switched on or beyond the horizon are ignored.
 */
/** 轮询一个仓库级事件流（按页最旧在前，Gitea 在服务端按 `since` 过滤），游标推进到最新项前五秒（`cursorAt`），靠 Trigger ID 去重让重复消息成为空操作。开关之前或超出视野的条目被忽略。 */
async function readStream(ctx: SourceContext, round: Round, id: string, path: string, config: GiteaConfig): Promise<void> {
  const name = KV.gitea.stream(id)
  const stored = ctx.state.get(name)
  const kinds = id === 'issues' ? [...config.observeIssues ? ['issues'] : [], ...config.observePulls ? ['pulls'] : []] : ['comments']
  const before = typeof stored?.started === 'object' ? stored.started : {}
  const started: Record<string, string> = Object.fromEntries(kinds.map(kind => [kind, before[kind] ?? round.started]))
  const horizon = Math.floor((Date.parse(round.started) - POLL_HORIZON_MS) / 3_600_000) * 3_600_000
  const since = new Date(Math.max(Date.parse(stored?.since ?? round.started), horizon)).toISOString()
  const listed = `${path}&since=${encodeURIComponent(since)}`
  const items = validItems(ListedSchema, await ctx.commands.withSignal(round.signal).giteaPages(ListedSchema, listed, round.tally), round.tally)
  const { login } = ctx.deployment.gitea!
  const fresh = (at: string | null | undefined, kind: string) =>
    kind in started && Date.parse(at ?? '') >= Math.max(Date.parse(started[kind]!), horizon)
  for (const item of items) {
    // Stopping mid-stream aborts before advancing the cursor so unread items are retried.
    // 流中途中止会在游标推进前抛出，未读条目随后重试。
    if (stopped(ctx, round)) throw new Error('The Gitea Source stopped during the poll')
    if (sameName(item.user.login, login)) continue
    if (id === 'issues') {
      const issue = IssueSchema.safeParse(item)
      const pr = issue.success && !!issue.data.pull_request
      if (!issue.success || !fresh(issue.data.created_at, pr ? 'pulls' : 'issues')) continue
      await ctx.receive(pr ? pullTrigger(issue.data, login) : issueTrigger(issue.data, login))
      nameThread(ctx, issue.data.number, issue.data.title)
      continue
    }
    const number = Number(/\/(?:issues|pulls)\/(\d+)$/.exec((item.issue_url ?? item.pull_request_url) ?? '')?.[1])
    if (!number || !fresh(item.updated_at ?? item.created_at, 'comments')) continue
    const isPr = /\/pulls?\//.test(item.pull_request_url ?? item.html_url ?? '')
    const ref = { number, isPr, ...item.html_url ? { url: item.html_url } : {} }
    const trigger = commentTrigger(item, ref, 'conversation', login)
    if (trigger.text) await ctx.receive(trigger)
  }
  const newest = Math.max(...items.map(item => Date.parse(item.updated_at ?? '')).filter(Number.isFinite))
  const moved = Number.isFinite(newest) ? cursorAt(new Date(newest).toISOString()) : since
  const next = Date.parse(moved) > Date.parse(since) ? moved : since
  ctx.state.set(name, { since: next, started })
}
/** Polls default-branch CI statuses, emitting a trigger only when the set of failing checks changes after the initial baseline. */
/** 轮询默认分支的 CI 状态；只有首次基线之后失败集合变化才发 Trigger。 */
async function pollBranchCi(ctx: SourceContext, round: Round): Promise<void> {
  const commands = ctx.commands.withSignal(round.signal)
  const gitea = ctx.deployment.gitea!
  const { default_branch: branch } = await commands.gitea(z.looseObject({ default_branch: z.string() }), '')
  const head = await commands.gitea(z.looseObject({ sha: z.string() }), `commits/${encodeURIComponent(branch)}`)
  const snapshot = await pullChecks(commands, head.sha, round.tally)
  const previous = ctx.state.get(KV.gitea.branchCi)
  // The first observation after switching on or renaming the default branch establishes the baseline.
  // 打开或更名默认分支后的第一次观察建立基线。
  const known = previous?.branch === branch ? previous.failures : undefined
  const failures = ciFailures(snapshot)
  const counts = ciCounts(snapshot)
  // Retain previous failures while checks are still running so recovery is reported only once all checks pass.
  // 状态仍在进行中时保留上一次失败集合，全部通过后只报告一次恢复。
  const now = failures.length || !counts.running ? failures : known ?? []
  let revision = previous?.revision ?? 0
  if (known && JSON.stringify(now) !== JSON.stringify(known)) {
    revision += 1
    const summary = giteaCiSummary(snapshot, branch, `gitea/commits/${head.sha}/checks`)
    const url = `${gitea.host}/${gitea.repository}/commit/${head.sha}`
    await ctx.receive(branchCiTrigger(branch, head.sha, revision, summary, url))
    ctx.threads.describe(`gitea:ci:${branch}`, { label: `CI on ${branch}`, facts: { ci: ciFact(counts) } })
  }
  ctx.state.set(KV.gitea.branchCi, { branch, failures: now, revision })
}
/**
 * One polling round: notifications, then observed repository streams, then the PRs of open tickets with their CI, then
 * subscribed Threads. Each step and each Issue, PR, or Thread fails independently so all steps run before the round fails.
 * @returns the polling interval in seconds.
 */
/** 一个轮询轮次：通知，然后观察中的仓库流，然后打开工单的 PR 及其 CI，最后已订阅线程。每一步、每个 Issue/PR/线程独立失败，轮次在全部步骤跑完后才失败。@returns 轮询间隔秒数。 */
export async function pollRound(ctx: SourceContext, signal?: AbortSignal): Promise<number> {
  const round = newRound(signal)
  const notified = await pollNotifications(ctx, round).then(value => ({ value }), (error: unknown) => ({ error }))
  await pollRepository(ctx, round)
  await pollTicketPulls(ctx, signal, round)
  await pollThreads(ctx, signal, round)
  if ('error' in notified) throw notified.error
  const interval = 60
  if (signal?.aborted) return interval
  if (round.failures.length) throw new Error(`${round.failures.length} Gitea reads failed: ${round.failures.slice(0, 3).join('; ')}`)
  const named = (numbers: number[]) => [...new Set(numbers)].sort((a, b) => a - b).map(number => `#${number}`).join(', ')
  const dropped = (round.dropped.length ? `; deleted on Gitea: ${named(round.dropped)}` : '')
    + (round.abandoned.length ? `; dropped after their reads kept failing: ${named(round.abandoned)}` : '')
    + (round.tally.skipped ? `; ${round.tally.skipped} unreadable items skipped` : '')
  ctx.report('gitea', { state: 'ready', detail: `${notified.value} notifications; next poll ≥ ${interval}s${dropped}`, at: round.started })
  return interval
}
/** Polls the repository-wide streams; each stream reads from when it was switched on, resets when switched off, and fails independently. */
/** 轮询仓库级流；每条流从打开时开始读，关闭时重置，且各自独立失败。 */
async function pollRepository(ctx: SourceContext, round: Round): Promise<void> {
  const config = ctx.config<GiteaConfig>(SOURCE)
  if (!config) return
  for (const stream of STREAMS) {
    if (stopped(ctx, round)) return
    if (!stream.observed(config)) { ctx.state.set(KV.gitea.stream(stream.id), undefined); continue }
    try { await readStream(ctx, round, stream.id, stream.path, config) }
    catch (error) { if (!stopped(ctx, round)) round.failures.push(`${stream.id}: ${String(error)}`) }
  }
  // When CI observation is turned off, clear the failure baseline but preserve the revision counter so future triggers have unique IDs.
  // 关闭 CI 观察时清空失败基线，但保留 revision 计数，让未来的 Trigger 有唯一 ID。
  if (!config.observeCi) {
    const seen = ctx.state.get(KV.gitea.branchCi)
    ctx.state.set(KV.gitea.branchCi, seen && { revision: seen.revision })
    return
  }
  try { await pollBranchCi(ctx, round) }
  catch (error) { if (!stopped(ctx, round)) round.failures.push(`default branch CI: ${String(error)}`) }
}
/** Reads notifications since the cursor and each Issue or PR they name, advancing the cursor atomically with the retry map for failed reads; deleted (410) Issues are dropped once their error is recorded. */
/** 读取游标以来的通知及其指名的每个 Issue/PR；游标与失败重试表原子推进；已删除（410）的 Issue 在记录错误后丢弃。 */
async function pollNotifications(ctx: SourceContext, round: Round): Promise<number> {
  const { state } = ctx
  const commands = ctx.commands.withSignal(round.signal)
  const since = state.get(KV.gitea.since) ?? round.started
  if (state.get(KV.gitea.since) === undefined) state.set(KV.gitea.since, since)
  const { repository } = ctx.deployment.gitea!
  const path = `notifications?all=true&limit=50&since=${encodeURIComponent(since)}`
  const notifications = (await commands.giteaPages(NotificationSchema, path, round.tally)).reverse()
  const retries = { ...state.get(KV.gitea.retries) }
  // Failed items from the previous round run first, followed by newly notified items in chronological order; each is read once.
  // 上一轮失败的条目先读，随后按时间顺序读新通知的条目；每条只读一次。
  const items = new Map(Object.entries(retries).map(([number, retry]) => [Number(number), retry]))
  for (const notification of notifications) {
    if (!sameName(notification.repository.full_name, repository)) continue
    const gitea = ctx.deployment.gitea!
    const address = giteaAddress(notification.subject.url ?? '', gitea.host, repository)
    if (!address || address.discussion || items.has(address.number)) continue
    const { number, pr } = address
    items.set(number, { since: [state.get(KV.gitea.cursor(number)) ?? since, since].sort().at(-1)!, pr })
  }
  for (const [number, item] of items) {
    if (stopped(ctx, round)) return notifications.length
    round.read.add(number)
    try {
      await readNotified(ctx, round, number, item)
      delete retries[number]
    } catch (error) {
      if (stopped(ctx, round)) return notifications.length
      const retry = { ...item, failedAt: item.failedAt ?? round.started, attempts: (item.attempts ?? 0) + 1 }
      // Abandon notification retries after 24 hours of failures so a permanently unreadable thread does not hold source health in error; its cursor stays so a later notification or thread poll still reads what was missed.
      // 失败满 24 小时后放弃重试，永久不可读的线程不会把来源健康拖成 error；游标保留，之后的通知或线程轮询仍能读到错过的内容。
      const abandoned = Date.parse(round.started) - Date.parse(retry.failedAt) >= RETRY_WINDOW_MS
      failed(ctx, round, number, error, abandoned)
      if (!deleted(error) && !abandoned) { retries[number] = retry; continue }
      delete retries[number]
    }
  }
  ctx.atomic(() => { state.set(KV.gitea.since, cursorAt(round.started)); state.set(KV.gitea.retries, retries) })
  return notifications.length
}
async function readNotified(ctx: SourceContext, round: Round, number: number, item: Retry): Promise<void> {
  const { since } = item
  let isPr = item.pr
  if (!isPr) {
    const issue = await ctx.commands.withSignal(round.signal).gitea(IssueSchema, `issues/${number}`)
    // `issues/<n>` also returns PRs with `pull_request` set; handle them in the PR branch below.
    // `issues/<n>` 也会返回设置了 `pull_request` 的 PR；在下面的 PR 分支处理。
    isPr = !!issue.pull_request
    if (!isPr) {
      // An Issue opened by someone other than the agent since the cursor brings its body so a mention in it reaches the gate.
      // 游标以来由他人打开的 Issue 会带上正文，正文里的 @ 才能到达准入门。
      const { login } = ctx.deployment.gitea!
      const opened = Date.parse(issue.created_at) >= Date.parse(since) && !sameName(issue.user.login, login)
      if (opened) await ctx.receive(issueTrigger(issue, login))
      await intakeComments(ctx, { number, isPr: false, url: issue.html_url }, since, round)
      nameThread(ctx, number, issue.title)
    }
  }
  if (isPr) {
    const pr = await pull(ctx, round, number)
    // Emit a PR description trigger for PRs opened since the cursor; its ID is the same as the one produced by the repository PR stream.
    // 为游标以来打开的 PR 发出描述 Trigger；其 ID 与仓库 PR 流产生的相同。
    const { login } = ctx.deployment.gitea!
    if (pr.created_at && Date.parse(pr.created_at) >= Date.parse(since) && !sameName(pr.user.login, login)) {
      const opened = { number, title: pr.title ?? '', body: pr.body, user: pr.user, created_at: pr.created_at, html_url: pr.html_url }
      await ctx.receive(pullTrigger(opened, login))
    }
    await intakeComments(ctx, { number, isPr: true, url: pr.html_url, prAuthor: pr.user.login }, since, round)
    if (pr.title) nameThread(ctx, number, pr.title)
  }
  ctx.state.set(KV.gitea.cursor(number), cursorAt(round.started))
  ctx.threads.patch(`gitea:${number}`, { pollError: undefined })
}
/** Reads and observes a PR at most once per polling round. */
/** 每个轮询轮次至多读取并观察一次 PR。 */
function pull(ctx: SourceContext, round: Round, number: number): Promise<Pull> {
  let read = round.pulls.get(number)
  if (!read) {
    read = readPull(ctx, number, round.signal).then(async pr => { await observePull(ctx, pr); return pr })
    round.pulls.set(number, read)
  }
  return read
}
async function intakeComments(ctx: SourceContext, ref: { number: number; isPr: boolean; url?: string; prAuthor?: string }, since: string, round: Round): Promise<void> {
  const commands = ctx.commands.withSignal(round.signal)
  const { login } = ctx.deployment.gitea!
  const kinds = ref.isPr ? ['conversation', 'review'] as const : ['conversation'] as const
  for (const kind of kinds) {
    // Gitea's reviews endpoint takes no `since`, so reviews filter by their created time here.
    // Gitea 的评审端点不接受 `since`，评审在这里按创建时间过滤。
    const comments: GiteaComment[] = kind === 'conversation'
      ? await commands.giteaPages(CommentSchema, `issues/${ref.number}/comments?limit=50&since=${encodeURIComponent(since)}`, round.tally)
      : (await commands.giteaPages(ReviewSchema, `pulls/${ref.number}/reviews?limit=50`, round.tally)).map(reviewOf)
    for (const comment of comments) {
      // Stopping mid-read throws so the thread's cursor stays where it was.
      // 读到一半停止会抛出，线程游标保持原位。
      if (stopped(ctx, round)) throw new Error('The Gitea Source stopped during the poll')
      const timestamp = Date.parse(comment.updated_at ?? comment.submitted_at ?? comment.created_at ?? '')
      if (!Number.isFinite(timestamp) || timestamp < Date.parse(since)) continue
      if (sameName(comment.user.login, login)) continue
      const trigger = commentTrigger(comment, ref, kind, login)
      if (trigger.text) await ctx.receive(trigger)
    }
  }
}
export async function pollTicketPulls(ctx: SourceContext, signal?: AbortSignal, round = newRound(signal)): Promise<void> {
  const numbers = [...new Set(ctx.tickets.open().flatMap(ticket => pullsOf(ticket, true)))]
  for (const number of numbers) {
    if (stopped(ctx, round)) return
    try {
      const pr = await pull(ctx, round, number)
      if (pr.state !== 'closed' && !pr.merged) await pollChecks(ctx, round, number, pr)
    } catch (error) { if (!stopped(ctx, round)) failed(ctx, round, number, error) }
  }
}
/** Polls a PR's CI statuses; only changes after the first baseline observation become Triggers. */
/** 轮询 PR 的 CI 状态；只有首次基线观察之后的变化才成为 Trigger。 */
async function pollChecks(ctx: SourceContext, round: Round, number: number, pr: Pull): Promise<void> {
  const snapshot = await pullChecks(ctx.commands.withSignal(round.signal), pr.head.sha, round.tally)
  const fingerprint = key(JSON.stringify(snapshot))
  const previous = ctx.state.get(KV.gitea.ci(number))
  if (previous?.fingerprint === fingerprint) return
  const revision = previous ? previous.revision + 1 : 0
  if (previous) await ctx.receive(ciTrigger(pr, revision, giteaCiSummary(snapshot, `PR #${number}`, `gitea/pulls/${number}/checks`)))
  ctx.state.set(KV.gitea.ci(number), { fingerprint, revision })
  ctx.threads.describe(`gitea:${number}`, { facts: { ci: ciFact(ciCounts(snapshot)) } })
}
function nameThread(ctx: SourceContext, number: number, title: string): void {
  ctx.threads.patch(`gitea:${number}`, { title })
  ctx.threads.describe(`gitea:${number}`, { label: `#${number} ${title}`, facts: { number: { value: `#${number}` } } })
}
/** Polls subscribed Issue and PR Threads not already read in this round; a deleted (410) Issue is still polled within the horizon (costing one read) and does not fail the round. */
/** 轮询本轮未读的已订阅 Issue/PR 线程；已删除（410）的 Issue 在视野内仍会轮询（花一次读）且不算轮次失败。 */
export async function pollThreads(ctx: SourceContext, signal?: AbortSignal, round = newRound(signal)): Promise<void> {
  await pollEach(ctx, SOURCE, () => stopped(ctx, round), async thread => {
    try { await pollThread(ctx, round, thread) }
    catch (error) {
      if (stopped(ctx, round)) throw error
      if (deleted(error)) round.dropped.push(Number(thread.ref.id)); else round.failures.push(`${thread.key}: ${String(error)}`)
      throw error
    }
  }, thread => round.read.has(Number(thread.ref.id)))
}
async function pollThread(ctx: SourceContext, round: Round, thread: Thread): Promise<void> {
  // The default branch's CI Thread has no Issue or PR to read; its CI arrives as Triggers.
  // 默认分支的 CI 线程没有可读的 Issue/PR；它的 CI 以 Trigger 送达。
  if (thread.ref.id.startsWith('ci:')) return
  const number = Number(thread.ref.id)
  if (!number) throw new Error('Subscribed thread has no Gitea issue or PR number')
  round.read.add(number)
  if (typeof thread.meta.isPr !== 'boolean' || typeof thread.meta.title !== 'string') {
    const issue = await ctx.commands.withSignal(round.signal).gitea(IssueSchema, `issues/${number}`)
    ctx.threads.patch(thread.key, { number, isPr: !!issue.pull_request, url: issue.html_url })
    if (issue.title) nameThread(ctx, number, issue.title)
    thread = ctx.threads.get(thread.key) ?? thread
  }
  const checkpoint = KV.gitea.cursor(number)
  const since = ctx.state.get(checkpoint) ?? thread.createdAt
  if (thread.meta.isPr === true) {
    const pr = await pull(ctx, round, number)
    await intakeComments(ctx, { number, isPr: true, url: pr.html_url, prAuthor: pr.user.login }, since, round)
  } else await intakeComments(ctx, { number, isPr: false }, since, round)
  ctx.state.set(checkpoint, cursorAt(round.started))
}
