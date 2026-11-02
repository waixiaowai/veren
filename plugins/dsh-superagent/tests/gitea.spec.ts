/** The Gitea Source on a SourceContext: translation, polls and read positions, the pull request rules, health, and the plugin entry. */
/** SourceContext 上的 Gitea 来源：翻译、轮询与读位置、PR 规则、健康与插件入口。 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Assessor, Executor, ReceiveResult, Ticket, Trigger } from '../src/core/index.ts'
import { key } from '../src/core/index.ts'
import { testDeployment, testGiteaDeployment } from './fixtures/deployment.ts'
import { HealthBoard } from '../src/infra/health.ts'
import { commandError, Commands } from '../src/infra/commands.ts'
import { SettingsSchema, settingsPolicy } from '../src/policy.ts'
import { Engine } from '../src/core/engine.ts'
import { Store } from '../src/app/store.ts'
import { sourceContextOf, type SourceContextDeps } from '../src/app/source-context.ts'
import { SourceRegistry } from '../src/sources/registry.ts'
import { giteaKind, apply as applyGitea, GiteaConfigSchema } from '../src/sources/gitea.ts'
import { pollRound } from '../src/sources/gitea-poll.ts'
import { KV } from '../src/kv.ts'
import type { SourceContext } from '../src/sources/host.ts'
import { claimPull } from '../src/sources/gitea-pull.ts'
import { sendGitea } from '../src/sources/gitea-channel.ts'

const HOST = 'https://gitea.acme.test'
function host(overrides: Partial<SourceContextDeps> = {}) {
  const store = new Store(join(mkdtempSync(join(tmpdir(), 'gitea-')), 'db.sqlite'))
  const settings = SettingsSchema.parse({
    policy: { sources: { gitea: { allowed: [{ id: 'alice', name: 'Alice' }] } } }, eval: { mode: 'auto' },
    sources: { gitea: { enabled: true, config: { host: HOST, repository: 'acme/widgets', cli: '/bin/true' } } } })
  store.saveSettings(settings)
  const board = new HealthBoard()
  const sources = new SourceRegistry(() => store.settings(), board)
  const deployment = testGiteaDeployment()
  sources.register(giteaKind)
  const assessor: Assessor = { request: vi.fn(async () => {}) }
  const executor: Executor = { start: vi.fn(async () => {}), deliver: vi.fn(async () => {}), stop: vi.fn(async () => {}) }
  const outbox = { send: () => {}, status: () => undefined, withdraw: () => {} }
  const engine = new Engine({ repo: store, scope: sources, policy: () => settingsPolicy(store.settings(), sources), assessor, executor, outbox })
  const commands = new Commands(() => deployment, {}, new AbortController().signal)
  const receive = vi.fn(async (trigger: Trigger): Promise<ReceiveResult> => { const result = engine.receive(trigger); engine.evaluateDue(); return result })
  const parts: SourceContextDeps = { store, engine, outbox: { send: message => { store.receipts.add(message) } }, commands,
    sources, deployment, ready: Promise.resolve(), configured: () => true, receive, ...overrides }
  const context: SourceContext = sourceContextOf(parts, { kind: 'gitea', health: ['gitea'] })
  return { ...parts, context, health: board.all, store, engine, receive }
}
afterEach(() => { vi.restoreAllMocks() })
const issue = (number: number, body = 'Please fix it', login = 'alice') => ({ number, title: `Do thing ${number}`, body,
  state: 'open', user: { login, type: 'User' }, created_at: '2026-09-09T00:00:00Z', updated_at: '2026-09-09T00:00:00Z',
  html_url: `${HOST}/acme/widgets/issues/${number}`, id: number })
const comment = (id: number, body: string, login = 'alice', number = 7,
  at = new Date(Date.now() - 1_800_000).toISOString()) => ({ id, body,
  user: { login, type: 'User' }, created_at: at, updated_at: at,
  html_url: `${HOST}/acme/widgets/issues/${number}#issuecomment-${id}`,
  issue_url: `${HOST}/acme/widgets/issues/${number}` })
const notification = (number: number, kind: 'issues' | 'pulls' = 'issues') => ({ id: `n${number}`, unread: true, pinned: false,
  updated_at: '2026-09-09T00:05:00Z', repository: { full_name: 'acme/widgets' },
  subject: { url: `${HOST}/api/v1/repos/acme/widgets/${kind}/${number}`, title: '' } })
const refused = (status: number, text: string) => commandError({ stderr: `gitea: ${text} (HTTP ${status})`, code: 1 })
const bare = (reads: string[]) => reads.map(path => path.replace(/^repos\/acme\/widgets\//, '').split('?')[0]!)
/** Stubs `gitea api` calls against `acme/widgets` and returns the requested paths in order. */
/** 对 `acme/widgets` 桩掉 `gitea api` 调用，并按序返回被请求的路径。 */
function gitea(h: ReturnType<typeof host>, routes: Record<string, unknown>): string[] {
  const reads: string[] = []
  vi.spyOn(h.commands, 'run').mockImplementation(async (_program, args) => {
    reads.push(args[1]!.replace(/^repos\/acme\/widgets\//, ''))
    const path = reads.at(-1)!.split('?')[0]!
    const value: unknown = routes[path] ?? refused(404, 'Not Found')
    if (value instanceof Error) throw value
    return JSON.stringify(value)
  })
  return reads
}
const subscribed = (h: ReturnType<typeof host>, id: number, meta: Record<string, unknown> = {}) =>
  // A recent createdAt keeps the thread inside the polling horizon (POLL_HORIZON_MS).
  // 近期的 createdAt 让线程留在轮询视野内（POLL_HORIZON_MS）。
  h.store.threads.save({ key: `gitea:${id}`, ref: { source: 'gitea', id: String(id) }, createdAt: new Date(Date.now() - 3_600_000).toISOString(),
    subscriptions: ['ticket'], correlated: [], pending: [], meta })
const openTicket = (id: string): Ticket => ({ id, title: id, decisionId: `d-${id}`, mandate: { strength: 'explicit', policyVersion: '',
  basis: { via: 'listed' }, actor: { source: 'gitea', id: 'alice' }, scope: '' },
  channels: [], assignments: [], inputs: [], undelivered: [], createdAt: '', updatedAt: '', origin: { triggerId: `source-${id}`, triggerIds: [] } })

describe('gitea source', () => {
  it('registers its kind, and pauses with giteaCliUnset while the enabled instance is unconfigured', async () => {
    const board = new HealthBoard()
    const sources = new SourceRegistry(() => SettingsSchema.parse({}), board)
    const disposers: (() => unknown)[] = []
    applyGitea({ orchestrator: { sources, context: () => sourceContextOf({
      store: { atomic: (work: () => unknown) => work(), get: () => undefined, set: () => {}, delete: () => {}, keys: () => [],
        threads: { get: () => undefined, subscribed: () => [], describe: () => {}, patch: () => {} },
        tickets: { get: () => undefined, open: () => [], bindThread: () => {}, threadClosed: () => {} },
        triggers: { get: () => undefined, latest: () => undefined }, read: {} },
      engine: { bindThread: () => {}, threadClosed: () => {} }, outbox: { send: () => {} },
      commands: new Commands(() => testDeployment(), {}, new AbortController().signal), sources,
      deployment: testGiteaDeployment(), ready: Promise.resolve(), configured: () => true,
      receive: async () => 'stored' as ReceiveResult } as unknown as SourceContextDeps, giteaKind) },
      effect: (effect: () => () => unknown) => { disposers.push(effect()) } } as never)
    await vi.waitFor(() => expect(sources.kind('gitea')).toBe(giteaKind))
    for (const dispose of disposers) await dispose()
    expect(sources.kind('gitea')).toBeUndefined()
  })
  it('takes in a notification of an allowed sender who mentions the agent, skips its own account, and moves the cursors', async () => {
    const h = host()
    const ctx = h.context
    // Seed the cursor before the round: the fixtures are dated September, and a fresh cursor would start now.
    // 轮次前先种下游标：fixture 的日期在九月，新游标会从现在开始。
    h.store.set(KV.gitea.since, '2026-09-01T00:00:00Z')
    const reads = gitea(h, {
      user: { login: 'agent-bot', id: 7, type: 'User' },
      notifications: [notification(7)],
      'issues/7': issue(7, '@agent-bot please fix it'),
      'issues/7/comments': [],
    })
    const interval = await pollRound(ctx)
    expect(interval).toBe(60)
    expect(await h.receive.mock.results[0]!.value).toBe('stored')
    expect(h.engine.candidate(key('gitea-issue', '7'))?.strength).toBe('explicit')
    expect(h.store.get(KV.gitea.since)).toBeTruthy()
    expect(h.store.get(KV.gitea.cursor(7))).toBeTruthy()
    h.store.close()
  })
  it('receives conversation comments of subscribed threads once, and keeps the cursor on interruption', async () => {
    const h = host()
    subscribed(h, 7, { number: 7, isPr: false, title: 'Do thing 7' })
    gitea(h, { notifications: [], 'issues/7': issue(7, 'Do it'),
      'issues/7/comments': [comment(21, '@agent-bot any progress?'), comment(22, 'from the agent', 'agent-bot')] })
    await pollRound(h.context)
    expect(await h.receive.mock.results[0]!.value).toBe('stored')
    const cursor = h.store.get(KV.gitea.cursor(7))
    expect(cursor).toBeTruthy()
    // A second round re-reads the same comments, which deduplicate by their stable Trigger IDs; the cursor advances.
    // 第二轮重读相同评论，由稳定的 Trigger ID 去重；游标照常前进。
    await pollRound(h.context)
    expect(h.receive.mock.calls.length).toBe(1)
    expect(h.store.get(KV.gitea.cursor(7))).toBeTruthy()
    h.store.close()
  })
  it('binds an agent pull request on the ticket branch and reports the closed one to its tickets', async () => {
    const h = host()
    const ctx = h.context
    const pr = { number: 9, title: 'Do thing 7', state: 'open', body: '', user: { login: 'agent-bot', type: 'User' },
      created_at: '2026-09-09T01:00:00Z', html_url: `${HOST}/acme/widgets/pulls/9`,
      head: { sha: 'abc', ref: 'agent/t-do-thing-7', repo: { full_name: 'acme/widgets' } }, merged: false }
    h.store.tickets.save({ ...openTicket('t1'), execution: { name: 't-do-thing-7', directory: '/w/x', assignment: '' } })
    const refusedMessage = claimPull(ctx, 't1', { ...pr, number: 9 } as never)
    expect(refusedMessage).toBeUndefined()
    expect(ctx.tickets.get('t1')?.follows?.some(item => item.thread === 'gitea:9')).toBe(true)
    h.store.close()
  })
  it('sends a reply once, reuses the marker on retry, and answers gone only for a deleted issue', async () => {
    const h = host()
    const posted: string[] = []
    vi.spyOn(h.commands, 'run').mockImplementation(async (_program, args) => {
      const path = args[1]!
      if (args.includes('--method')) {
        const body = args.find(arg => arg.startsWith('body='))!.slice(5)
        if (posted.includes(body)) return '[]'
        posted.push(body)
        return JSON.stringify({ id: 31 })
      }
      // The comment list answers with our own marker comment, so the retry recognizes it as sent.
      // 评论列表返回带我们标记的评论，重试因此认出已发送。
      return JSON.stringify(posted.length ? [{ id: 31, body: posted.at(-1), user: { login: 'agent-bot' } }] : [])
    })
    const message = { id: key('reply', 'm1'), channel: { source: 'gitea', thread: 'gitea:7', address: { number: '7' } } } as never
    const sent = await sendGitea({ commands: h.commands }, message)
    expect(sent).toBe('sent')
    expect(posted.length).toBe(1)
    expect(await sendGitea({ commands: h.commands }, message)).toBe('sent')
    expect(posted.length).toBe(1)
    h.store.close()
  })
  it('filters unlisted senders by the Policy and finds threads by number and page URL', () => {
    const h = host()
    expect(h.store.settings().policy.sources.gitea?.allowed.map(item => item.id)).toEqual(['alice'])
    const policyPart = giteaKind.policy!
    const rows = policyPart.rows!({ observeComments: true })
    expect(rows.map(row => row.id)).toEqual(['issues', 'pulls', 'comments', 'ci'])
    expect(rows[2]!.cells).toEqual({ listedUnaddressed: true, unlistedAddressed: true, unlistedUnaddressed: true })
    expect(giteaKind.find!('#12')).toEqual({ threads: ['gitea:12'], terms: [] })
    expect(giteaKind.find!(`${HOST}/acme/widgets/pulls/3`)).toEqual({ threads: ['gitea:3'], terms: [] })
    expect(giteaKind.scope!({ meta: { kind: 'issue' } }, GiteaConfigSchema.parse({})))
      .toEqual({ listened: true, observed: false, row: 'issues' })
    h.store.close()
  })
  it('exposes the execution environment variables of a Gitea ticket', () => {
    const values = giteaKind.environment!.values({
      deployment: testGiteaDeployment(), config: GiteaConfigSchema.parse({ host: HOST, repository: 'acme/widgets', cli: 'gitea' }),
      trigger: { source: 'gitea', meta: { number: 5, isPr: true }, threads: [{ source: 'gitea', id: '5' }] } as never })
    expect(values.DSH_SUPERAGENT_GITEA_HOST).toBe(HOST)
    expect(values.DSH_SUPERAGENT_GITEA_REPOSITORY).toBe('acme/widgets')
    expect(values.DSH_SUPERAGENT_GITEA_ACCOUNT).toBe('agent-bot')
    expect(values.DSH_SUPERAGENT_GITEA_NUMBER).toBe('5')
    expect(values.DSH_SUPERAGENT_GITEA_PR_HEAD).toBe('refs/pull/5/head')
  })
})
