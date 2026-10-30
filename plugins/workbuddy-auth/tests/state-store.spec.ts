/**
 * 账号仓规格：缝串行化、刷新单飞（N 调用 1 请求）、锁跨网络调用、四类清除、
 * 区域过滤、粘性不粘坏账号。
 * Account-store specs: seam serialization, refresh single flight (N callers →
 * one request), the lock spanning the network call, four-class purge, region
 * filtering, sticky-not-bad.
 */
import { describe, expect, it } from 'vitest'
import { callRefresh, emptyStateDocument, withAccountEntry, type WorkbuddyAccountEntry } from '@veren/workbuddy-protocol'
import { WorkbuddyAccounts, WORKBUDDY_RECORD } from '../src/state-store.ts'
import { createFakeHost, RECORD, type FakeCredentials } from './support/fake-host.ts'

function entry(uid: string, overrides: Partial<WorkbuddyAccountEntry> = {}): WorkbuddyAccountEntry {
  return {
    accessToken: `at-${uid}`, refreshToken: `rt-${uid}`, expiresAtMs: Date.now() + 3_600_000,
    domain: 'codebuddy.cn', uid, ...overrides,
  }
}

/** 灌入初始文档。Seeds the initial document. */
async function seed(credentials: FakeCredentials, ...accounts: WorkbuddyAccountEntry[]): Promise<void> {
  let document = emptyStateDocument()
  for (const account of accounts) document = withAccountEntry(document, account)
  credentials.records.set(RECORD, { kind: 'grant', payload: document })
}

/** 一个可编程的线路刷新替换点（计数 + 可悬停）。A programmable refresh seam (counting + pausable). */
function refreshSeam(options: { hangUntil?: Promise<void>; result?: 'ok' | 'fail' } = {}): typeof callRefresh & { calls(): number } {
  let calls = 0
  const impl = async (): Promise<{ ok: true; tokens: { accessToken: string; refreshToken: string; expiresInSec: number } } | { ok: false; kind: 'server'; message: string }> => {
    calls += 1
    if (options.hangUntil !== undefined) await options.hangUntil
    return options.result === 'fail'
      ? { ok: false, kind: 'server', message: 'boom' }
      : { ok: true, tokens: { accessToken: `at-new-${calls}`, refreshToken: `rt-new-${calls}`, expiresInSec: 3_600 } }
  }
  return Object.assign(impl, { calls: () => calls }) as unknown as typeof callRefresh & { calls(): number }
}

describe('串行化与单飞 / serialization and single flight', () => {
  it('刷新单飞：同 uid 的 N 个并发调用只发一次网络请求，全部拿到同一新凭据', async () => {
    const { ctx, credentials } = createFakeHost()
    await seed(credentials, entry('u-1', { expiresAtMs: Date.now() })) // 已入刷新边际
    const seam = refreshSeam()
    const accounts = new WorkbuddyAccounts(ctx, { refresh: seam })
    const results = await Promise.all(
      Array.from({ length: 5 }, () => accounts.refreshEntry('u-1')),
    )
    expect(seam.calls()).toBe(1)
    for (const result of results) {
      expect(result.status).toBe('refreshed')
      if (result.status === 'refreshed') expect(result.entry.accessToken).toBe('at-new-1')
    }
    const document = await accounts.read()
    expect(document.accounts[0]?.accessToken).toBe('at-new-1')
    expect(document.accounts[0]?.refreshToken).toBe('rt-new-1')
  })

  it('锁跨网络调用：刷新悬停期间第二个 mutate 被串行化在刷新之后（读到新令牌，不重放旧轮换令牌）', async () => {
    const { ctx, credentials } = createFakeHost()
    await seed(credentials, entry('u-1', { expiresAtMs: Date.now() }))
    let releaseNetwork: (() => void) | undefined
    const hangUntil = new Promise<void>(resolve => { releaseNetwork = resolve })
    const seam = refreshSeam({ hangUntil })
    const accounts = new WorkbuddyAccounts(ctx, { refresh: seam })
    const refreshPromise = accounts.refreshEntry('u-1')
    let observedAccessTokenDuringHang: string | undefined
    const observer = accounts.modify(document => {
      // 该 mutate 必须排在刷新之后执行：此刻文档已是新令牌。
      // This mutate runs after the refresh: the document already holds the new token.
      observedAccessTokenDuringHang = document.accounts[0]?.accessToken
      return document
    })
    releaseNetwork?.()
    await Promise.all([refreshPromise, observer])
    expect(seam.calls()).toBe(1)
    expect(observedAccessTokenDuringHang).toBe('at-new-1')
    // 全程没有任何 mutate 重叠执行（缝串行化未被破坏）。
    expect(credentials.peakConcurrentMutates()).toBeLessThanOrEqual(1)
  })

  it('刷新失败不改文档、原因透传；下次仍会重试', async () => {
    const { ctx, credentials } = createFakeHost()
    await seed(credentials, entry('u-1', { expiresAtMs: Date.now() }))
    const accounts = new WorkbuddyAccounts(ctx, { refresh: refreshSeam({ result: 'fail' }) })
    const outcome = await accounts.refreshEntry('u-1')
    expect(outcome).toMatchObject({ status: 'failed', reason: 'boom' })
    const document = await accounts.read()
    expect(document.accounts[0]?.accessToken).toBe('at-u-1')
  })
})

describe('选号 / selection', () => {
  it('区域过滤：cn 凭据绝不服务 global 请求（凭据跨区即鉴权失败）', async () => {
    const { ctx, credentials } = createFakeHost()
    await seed(credentials, entry('u-cn'))
    const accounts = new WorkbuddyAccounts(ctx, { refresh: refreshSeam() })
    await expect(accounts.resolve('global', undefined)).rejects.toMatchObject({ code: 'NOT_SIGNED_IN' })
    const resolved = await accounts.resolve('cn', 'sess-1')
    expect(resolved.uid).toBe('u-cn')
  })

  it('粘性不粘坏账号：钉住账号被冷却后即刻让位健康账号', async () => {
    const { ctx, credentials } = createFakeHost()
    await seed(credentials, entry('u-1'), entry('u-2'))
    const accounts = new WorkbuddyAccounts(ctx, { refresh: refreshSeam() })
    expect((await accounts.resolve('cn', 'sess-1')).uid).toBe('u-1')
    await accounts.noteFailure('u-1', 'hard_credit')
    expect((await accounts.resolve('cn', 'sess-1')).uid).toBe('u-2')
  })

  it('冷却写进文档（跨重启持久）：新仓实例也能看到', async () => {
    const { ctx, credentials } = createFakeHost()
    await seed(credentials, entry('u-1'), entry('u-2'))
    const first = new WorkbuddyAccounts(ctx, { refresh: refreshSeam() })
    await first.noteFailure('u-1', 'soft_rate')
    const document = await first.read()
    expect(document.cooldowns['u-1']).toBeGreaterThan(Date.now())
    // 全冷却类别不写：session_dead 不冷却。
    await first.noteFailure('u-1', 'session_dead')
    const after = await first.read()
    expect(after.cooldowns['u-1']).toBe(document.cooldowns['u-1'])
  })
})

describe('登出四类清除 / four-class logout purge', () => {
  it('remove 一次删净：凭据、冷却、停用、探测（单文档构造上原子）', async () => {
    const { ctx, credentials } = createFakeHost()
    await seed(credentials, entry('u-1'), entry('u-2'))
    const accounts = new WorkbuddyAccounts(ctx, { refresh: refreshSeam() })
    await accounts.noteFailure('u-1', 'hard_credit')
    await accounts.setDisabled('u-1', true)
    await accounts.noteProbe('u-1', 'cn', 'glm-5.3', { validation: 'validating', efforts: ['low'], requests: 7 })
    await accounts.remove('u-1')
    const document = await accounts.read()
    expect(document.accounts.map(account => account.uid)).toEqual(['u-2'])
    expect(document.cooldowns['u-1']).toBeUndefined()
    expect(document.disabled).not.toContain('u-1')
    expect(document.probes['u-1']).toBeUndefined()
  })
})

describe('登录合成 / login merge', () => {
  it('mergeLogin 秒转毫秒一次到位、可选字段按存在附加', () => {
    const { ctx, credentials } = createFakeHost()
    const accounts = new WorkbuddyAccounts(ctx, { refresh: refreshSeam() })
    const now = 1_000_000
    const document = accounts.mergeLogin(emptyStateDocument(), {
      region: 'cn',
      token: { accessToken: 'a', refreshToken: 'r', expiresIn: 60, domain: 'codebuddy.cn' },
      account: { uid: 'u-9', enterpriseId: '', nickname: '13800138000' },
    }, now)
    expect(document.accounts[0]).toMatchObject({
      uid: 'u-9', expiresAtMs: now + 60_000, nickname: '13800138000',
    })
    expect(document.accounts[0]?.enterpriseId).toBeUndefined()
  })
})
