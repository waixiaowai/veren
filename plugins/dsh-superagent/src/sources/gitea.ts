/** Gitea source kind definition, its polling loop, and Cordis plugin entry. */
/** Gitea 来源 kind 定义、轮询循环与 Cordis 插件入口。 */
import type { Context } from '@deepseek-ai/cordis'
import { GiteaAccountsSchema } from '../deployment.ts'
import { giteaLink, sendGitea } from './gitea-channel.ts'
import { giteaThreadContext } from './gitea-read.ts'
import { giteaPage, SOURCE } from './gitea-trigger.ts'
import { pollFailure, pollRound } from './gitea-poll.ts'
import { health, sourceContext, type Health, type SourceContext } from './host.ts'
import { pause } from './poll.ts'
import type { Localized, SourceKind } from './kind.ts'
import { z } from 'zod'

export const GiteaConfigSchema = GiteaAccountsSchema.extend({
  pollSeconds: z.number().int().min(60).max(3600).default(60),
  failuresBeforeError: z.number().int().min(1).max(20).default(3),
  observeIssues: z.boolean().default(false), observePulls: z.boolean().default(false),
  observeComments: z.boolean().default(false), observeCi: z.boolean().default(false),
}).strict()
export type GiteaConfig = z.infer<typeof GiteaConfigSchema>
const OBSERVED = { issues: 'observeIssues', pulls: 'observePulls', comments: 'observeComments', ci: 'observeCi' } as const
type Scope = keyof typeof OBSERVED
function scopeOf(meta: Record<string, unknown>): Scope | undefined {
  if (meta.ci === true) return typeof meta.branch === 'string' ? 'ci' : undefined
  if (meta.kind === 'issue') return 'issues'
  if (meta.kind === 'pull') return 'pulls'
  return meta.kind === 'conversation' || meta.kind === 'review' ? 'comments' : undefined
}
export const giteaKind: SourceKind<GiteaConfig> = {
  kind: SOURCE,
  title: { zh: 'Gitea', en: 'Gitea' },
  description: { zh: '智能体的 Gitea 账号；接收仓库里发给它的通知、已订阅 Issue 与 PR 的讨论、CI 状态变化和 PR 合并关闭。', en: 'The agent\'s Gitea account; receives notifications to it in the repository, discussion on subscribed Issues and PRs, CI changes, and PR merge or close.' },
  schema: GiteaConfigSchema,
  fields: [
    { key: 'host', type: 'text', pattern: 'https?://.*', label: { zh: 'Gitea 站点地址', en: 'Gitea host' },
      hint: { zh: '写作 https://gitea.example.com，不带仓库路径。这个来源只监听这个站点。保存时检查智能体账号能否推送到它，然后重启 dsh-superagent。', en: 'Written https://gitea.example.com, without a repository path. This Source listens on this host only. Saving checks that the agent account can push to it, then restarts dsh-superagent.' } },
    { key: 'repository', type: 'text', pattern: '[A-Za-z0-9_.\\-]+/[A-Za-z0-9_.\\-]+', label: { zh: '监听的仓库', en: 'Repository' },
      hint: { zh: '写作 owner/name。这个来源接收这个仓库的通知和讨论；保存时检查智能体账号能否推送到它，然后重启 dsh-superagent。', en: 'Written owner/name. This Source receives the repository\'s notifications and discussion; saving checks that the agent account can push to it, then restarts dsh-superagent.' } },
    { key: 'cli', type: 'text', label: { zh: '智能体的 Gitea CLI', en: 'Agent Gitea CLI' },
      hint: { zh: '命令名或绝对路径，通常是从配置文件读站点与令牌的 gitea 包装脚本。智能体以它登录的账号行事，执行器以 gitea 调用它。保存时检查它登录的账号能否推送到仓库，然后重启 dsh-superagent。', en: 'A command name or absolute path, usually a gitea wrapper that reads its host and token from a config file. The agent acts as the account it is signed in to, and the Executor calls it as gitea. Saving checks that this account can push to the repository, then restarts dsh-superagent.' } },
    { key: 'pollSeconds', type: 'number', advanced: true, min: 60, max: 3600, label: { zh: '轮询间隔 / 秒', en: 'Polling interval / seconds' }, hint: { zh: '本来源的轮询不快于一分钟。', en: 'This Source polls no faster than one minute.' } },
    { key: 'failuresBeforeError', type: 'number', advanced: true, min: 1, max: 20, label: { zh: '连续失败几次后报告异常', en: 'Failed polls before reporting an error' }, hint: { zh: '单次网络中断会在下一次轮询时自动重试，不必报告。', en: 'A single network interruption is retried on the next poll and need not be reported.' } },
    { key: 'observeIssues', type: 'switch', label: { zh: '接收仓库里的新 Issue', en: 'Receive new Issues in the repository' },
      hint: { zh: '打开后，没有 @ 智能体的新 Issue 也会收到，由策略的接收表决定是否成为候选。从打开的时候开始，不读以前的。', en: 'New Issues that do not mention the agent are received too, and the Policy\'s admission table decides whether they become candidates. Starts when switched on; earlier ones are not read.' } },
    { key: 'observePulls', type: 'switch', label: { zh: '接收仓库里的新 PR', en: 'Receive new pull requests in the repository' },
      hint: { zh: '打开后，没有 @ 智能体的新 PR 也会收到，由策略的接收表决定是否成为候选。', en: 'New pull requests that do not mention the agent are received too, and the Policy\'s admission table decides whether they become candidates.' } },
    { key: 'observeComments', type: 'switch', label: { zh: '接收仓库里的评论', en: 'Receive comments in the repository' },
      hint: { zh: '打开后，Issue 和 PR 上没有 @ 智能体的评论也会收到（Gitea 的行内评审评论不在本来源的接收范围），由策略的接收表决定是否成为候选。', en: 'Comments on Issues and PRs that do not mention the agent are received too (Gitea inline review comments are outside this Source\'s scope), and the Policy\'s admission table decides whether they become candidates.' } },
    { key: 'observeCi', type: 'switch', label: { zh: '接收默认分支的 CI', en: 'Receive the default branch\'s CI' },
      hint: { zh: '打开后，默认分支的 CI 失败和恢复会收到，由策略的接收表决定是否成为候选。', en: 'Failures of the default branch\'s CI, and its recovery, are received, and the Policy\'s admission table decides whether they become candidates.' } }],
  // What the Source observes across the repository it receives in full; elsewhere, only what addresses the agent.
  // 来源对整个仓库观察这些；此外只接收发给智能体的内容。
  scope: ({ meta }, config) => {
    const row = scopeOf(meta)
    return { listened: true, observed: row !== undefined && config[OBSERVED[row]], ...row ? { row } : {} }
  },
  health: ['gitea'],
  channel: { send: sendGitea, link: giteaLink },
  threadContext: giteaThreadContext,
  // `#12`, `12`, or the page of an Issue or PR on the configured host, names Thread 12.
  // `#12`、`12` 或所配站点上 Issue/PR 的页面地址，都指向线程 12。
  find: query => {
    const number = /^#?(\d+)$/.exec(query.trim())?.[1] ?? giteaNumberOf(query)
    return { threads: number ? [`${SOURCE}:${number}`] : [], terms: [] }
  },
  policy: {
    schema: z.object({ allowed: z.array(z.object({ id: z.string().regex(/^[A-Za-z0-9-]+$/) }).strict()).default([]),
      bots: z.array(z.object({ id: z.string().regex(/^[A-Za-z0-9-]+(\[bot\])?$/) }).strict()).optional() }).strict(),
    fields: [{ key: 'allowed', type: 'rows', label: { zh: '能发起工作的 Gitea 账号', en: 'Gitea accounts that may originate work' },
      columns: [{ key: 'id', type: 'text', label: { zh: '账号', en: 'Account' }, pattern: '[A-Za-z0-9\\-]+' }] },
    { key: 'bots', type: 'rows', label: { zh: '评论可以成为候选的机器人', en: 'Bots whose comments may become candidates' },
      hint: { zh: '名单里的机器人账号（例如 renovate[bot]）的评论在来源收到时成为推断的候选，交给评估：评论 @ 了智能体，或者打开了“接收仓库里的评论”。它们不能发起明确的请求，也不能停止工单；其他机器人的评论不接收。', en: 'A comment of a bot account on this list, such as renovate[bot], becomes an inferred candidate for an assessment when the Source receives it: when it mentions the agent, or with Receive comments in the repository on. Such a comment never makes an explicit request or stops a ticket; other bots\' comments are not admitted.' },
      columns: [{ key: 'id', type: 'text', label: { zh: '账号', en: 'Account' }, pattern: '[A-Za-z0-9\\-]+(\\[bot\\])?' }] }],
    explicit: { zh: '名单里的账号在 Issue 或评论里 @ 智能体的账号。', en: 'An account on the list mentions the agent\'s account in an Issue or a comment.' },
    rows(stored) {
      const config = GiteaConfigSchema.partial().parse(stored)
      const note = (observed: boolean | undefined) => observed ? { zh: '全部', en: 'All' } : { zh: '仅 @', en: '@ only' }
      const row = (id: Scope, label: { zh: string; en: string }) => ({ id, label, note: note(config[OBSERVED[id]]),
        cells: { listedUnaddressed: !!config[OBSERVED[id]], unlistedAddressed: true, unlistedUnaddressed: !!config[OBSERVED[id]] } })
      return [row('issues', { zh: '新 Issue', en: 'New Issues' }), row('pulls', { zh: '新 PR', en: 'New pull requests' }),
        row('comments', { zh: '评论', en: 'Comments' }),
        // CI has no sender, so only the cell of a sender off the list who does not address the agent applies.
        // CI 没有发送者，因此只有名单外、未 @ 智能体的那格适用。
        { id: 'ci', label: { zh: '默认分支的 CI', en: 'Default branch CI' }, note: config.observeCi ? { zh: '接收', en: 'Received' } : { zh: '不接收', en: 'Not received' },
          cells: { listedUnaddressed: false, unlistedAddressed: false, unlistedUnaddressed: !!config.observeCi } }]
    },
  },
  environment: {
    variables: [
      { key: 'DSH_SUPERAGENT_GITEA_HOST', description: { zh: '这个来源监听的 Gitea 站点地址。智能体在这里开的 PR，分支最后一段是 DSH_SUPERAGENT_NAME 时（例如 agent/$DSH_SUPERAGENT_NAME）会关联到工单', en: 'The Gitea host this Source watches. A PR the agent opens here from a branch whose last path segment is DSH_SUPERAGENT_NAME (for example agent/$DSH_SUPERAGENT_NAME) binds to the ticket' } },
      { key: 'DSH_SUPERAGENT_GITEA_REPOSITORY', description: { zh: '这个来源监听的仓库，owner/name。', en: 'The repository this Source watches, as owner/name.' } },
      { key: 'DSH_SUPERAGENT_GITEA_ACCOUNT', description: { zh: '智能体的 Gitea 账号；gitea CLI 以它行事，除自动合并外的 Gitea 操作都用它，不用其他账号或凭据', en: 'The agent\'s Gitea account. The gitea CLI acts as it; use it for every Gitea operation except auto-merge, and never another account or credential' } },
      { key: 'DSH_SUPERAGENT_GITEA_COMMIT_EMAIL', description: { zh: '智能体账号的提交邮箱。这里的 git 没有身份：按提示词写明的作者提交，没有写明时用智能体账号和这个邮箱', en: 'Commit email of the agent\'s account. git has no identity here: commit as the author these instructions name, or as the agent\'s account with this email when they name none' } },
      { key: 'DSH_SUPERAGENT_GITEA_NUMBER', description: { zh: '接下工单的 Issue 或 PR 编号；工单不是从 Gitea 来的时为空', en: 'Number of the Issue or PR that started the ticket; empty when the ticket did not start on Gitea' } },
      { key: 'DSH_SUPERAGENT_GITEA_PR_HEAD', description: { zh: '接下工单的 PR 的 head 引用 refs/pull/<编号>/head；不是 PR 时为空', en: 'Head ref refs/pull/<number>/head of the PR that started the ticket; empty when it was not a PR' } },
    ],
    values: ({ deployment, trigger }) => {
      const gitea = deployment.gitea
      const number = trigger?.threads[0]?.source === SOURCE ? Number(trigger.meta.number) || 0 : 0
      return { DSH_SUPERAGENT_GITEA_HOST: gitea?.host ?? '', DSH_SUPERAGENT_GITEA_REPOSITORY: gitea?.repository ?? '',
        DSH_SUPERAGENT_GITEA_ACCOUNT: gitea?.login ?? '', DSH_SUPERAGENT_GITEA_COMMIT_EMAIL: gitea?.noreply ?? '',
        DSH_SUPERAGENT_GITEA_NUMBER: number ? String(number) : '',
        DSH_SUPERAGENT_GITEA_PR_HEAD: number && trigger?.meta.isPr === true ? `refs/pull/${number}/head` : '' }
    },
  },
  facts: (deployment): Record<string, Localized | string> => deployment?.gitea ? {
    cli: { zh: `当前账号 @${deployment.gitea.login}（${deployment.gitea.host}）`, en: `Current account @${deployment.gitea.login} (${deployment.gitea.host})` },
  } : {},
}
/** Extracts an Issue or PR number from a Gitea page or API URL on the deployment's host, for `find`. */
/** 从部署站点上的 Gitea 页面或 API URL 里提取 Issue/PR 编号，供 `find` 使用。 */
function giteaNumberOf(query: string): string | undefined {
  const match = /\/(?:issues|pulls?)\/(\d+)/.exec(query)
  return match?.[1]
}
export const name = 'dsh-superagent-gitea'
export const inject = ['orchestrator']
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.orchestrator.sources.register(giteaKind), 'gitea: source kind')
  ctx.effect(() => {
    const source = sourceContext(ctx.orchestrator, giteaKind)
    const controller = new AbortController()
    // Unhandled rejections terminate the DSH process, so a failure escaping the polling loop is reported as source health instead.
    // 未处理的 rejection 会终止 DSH 进程，因此轮询循环里逃逸的失败改报为来源健康。
    const running = watch(source, controller.signal)
      .catch((error: unknown) => { source.report('gitea', { state: 'error', detail: String(error) }) })
    return async () => { controller.abort(); await running }
  })
}
async function watch(ctx: SourceContext, signal: AbortSignal): Promise<void> {
  let interval = 60
  let failures = 0
  await ctx.ready
  // Setup restarts dsh-superagent once it resolves the accounts; until then nothing is polled.
  // 账号解析完成后 setup 会重启 dsh-superagent；在此之前不轮询。
  if (!ctx.configured()) { ctx.report('gitea', health('paused', 'setupPending')); return }
  while (!signal.aborted) {
    const config = ctx.config<GiteaConfig>(SOURCE)
    try {
      if (config && (!config.host || !config.repository || !config.cli)) ctx.report('gitea', health('paused', 'giteaCliUnset'))
      else if (config) interval = await pollRound(ctx, signal)
      else ctx.report('gitea', health('paused', 'sourceOff'))
      failures = 0
    } catch (error) {
      failures += 1
      const failed = pollFailure(failures, config?.failuresBeforeError ?? 1, error)
      if (!signal.aborted && failed) ctx.report('gitea', failed)
    }
    await pause(Math.max(interval, ctx.config<GiteaConfig>(SOURCE)?.pollSeconds ?? 60) * 1000, signal)
  }
}
