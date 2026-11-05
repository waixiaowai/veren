/**
 * 网关验收：真实 cordis ctx + 真实网关服务 + 假凭据面 + 脚本化 fetch——
 * 登录全链、守门路径、删除凭证恰好集合、领域错误折进业务信封、任务流水线
 * （受理即回执、失败折规范码）。直调方法只经过一层业务信封（GatewayOutcome
 * 本身）；载体的 RemoteResult 包裹只在真实远端通路上出现，由 remote-arity
 * 与真机验收覆盖。
 * Gateway acceptance: a real cordis ctx plus the real gateway service and a
 * fake credential face and a scripted fetch — the full paste-code sign-in,
 * guard paths, the delete voucher's exact set, domain errors folded into the
 * business envelope, and the job pipeline (acceptance answers at once,
 * failures fold into canonical codes). A direct method call sees exactly one
 * envelope (GatewayOutcome itself); the carrier's RemoteResult wrapper only
 * exists on the real Remote path, covered by remote-arity and the real-node
 * acceptance.
 *
 * @module tests/gateway
 */
import { describe, expect, it, vi } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { Context, type Context as CordisContext } from '@deepseek-ai/cordis'
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { BaiduPanGatewayService } from '../src/gateway.js'
import { provideWorld } from '../src/service.js'
import { resolveConfig } from '../src/config.js'
import { readStoredTokens } from '../src/credentials.js'
import { buildWorld, type BaiduPanWorld } from '../src/world.js'
import type { FetchLike } from '../src/wire.js'
import { fakeCredentials, scriptedFetch, tokenResponse, tokenedCredentials, type FetchRoute } from './support/fakes.js'

/** 组装接在假凭据面与脚本化 fetch 上的网关（真实 cordis ctx，真实服务类）。Assembles the gateway over fakes (a real cordis ctx, the real service class). */
function gatewayOf(credentials: CredentialProvider, fetch?: FetchLike): {
  readonly gateway: BaiduPanGatewayService
  readonly ctx: CordisContext
  readonly world: BaiduPanWorld
} {
  const ctx = new Context()
  const world = buildWorld(resolveConfig({ appKey: 'k', secretKey: 's' }), credentials, { list: () => [] }, fetch)
  provideWorld(ctx, world)
  const gateway = new BaiduPanGatewayService(ctx)
  return { gateway, ctx, world }
}

/** 脚本路由：授权码换令牌 + uinfo 在线校验。Scripted routes: code-to-token plus the uinfo online check. */
function signInRoutes(): FetchRoute[] {
  return [
    { match: url => url.includes('oauth/2.0/token'), reply: () => tokenResponse() },
    {
      match: url => url.includes('xpan/nas'),
      reply: () => Response.json({ errno: 0, uk: '123', vip_type: 2, netdisk_name: 'tester' }),
    },
  ]
}

describe('auth state and sign-in', () => {
  it('answers anonymous locally with the configured root', async () => {
    const { gateway } = gatewayOf(fakeCredentials())
    const state = await gateway.authState()
    expect(state.ok).toBe(true)
    if (state.ok) {
      expect(state.value.authorized).toBe(false)
      expect(state.value.root).toBe('/apps/bdpan')
    }
  })

  it('exchanges a pasted code, validates online, and commits', async () => {
    const credentials = fakeCredentials()
    const { gateway } = gatewayOf(credentials, scriptedFetch(signInRoutes()))
    const outcome = await gateway.submitSignInCode({ code: 'abc123' })
    expect(outcome.ok).toBe(true)
    if (outcome.ok) {
      expect(outcome.value.authorized).toBe(true)
      expect(outcome.value.expiring).toBe(false)
    }
    const tokens = await readStoredTokens(credentials)
    expect(tokens?.accessToken).toBe('fresh-access')
  })

  it('refuses an empty code locally before any network', async () => {
    const { gateway } = gatewayOf(fakeCredentials(), scriptedFetch(signInRoutes()))
    const outcome = await gateway.submitSignInCode({ code: '   ' })
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.code).toBe('BDPAN_INVALID_ARG')
  })

  it('signs out by deleting the record', async () => {
    const credentials = tokenedCredentials()
    const { gateway } = gatewayOf(credentials)
    const outcome = await gateway.signOut()
    expect(outcome.ok).toBe(true)
    expect(await readStoredTokens(credentials)).toBeUndefined()
    const state = await gateway.authState()
    if (state.ok) expect(state.value.authorized).toBe(false)
  })
})

describe('reads fold upstream failures', () => {
  it('folds a missing token into BDPAN_AUTH_REQUIRED for whoami', async () => {
    const { gateway } = gatewayOf(fakeCredentials())
    const outcome = await gateway.whoami()
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.code).toBe('BDPAN_AUTH_REQUIRED')
  })

  it('returns profile and quota through the same envelope', async () => {
    const routes: FetchRoute[] = [
      ...signInRoutes(),
      { match: url => url.includes('xpan/api'), reply: () => Response.json({ errno: 0, total: 100, used: 40 }) },
    ]
    const { gateway } = gatewayOf(tokenedCredentials(), scriptedFetch(routes))
    const profile = await gateway.whoami()
    expect(profile.ok).toBe(true)
    if (profile.ok) expect(profile.value.displayName).toBe('tester')
    const quota = await gateway.quota()
    expect(quota.ok).toBe(true)
    if (quota.ok) expect(quota.value.freeBytes).toBe(60)
  })
})

describe('guard paths refuse locally', () => {
  it('bounces out-of-root listings without any request', async () => {
    const fetch = scriptedFetch([])
    const { gateway } = gatewayOf(tokenedCredentials(), fetch)
    const outcome = await gateway.list({ dir: '../../etc' })
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.code).toBe('BDPAN_PATH_OUT_OF_SCOPE')
    expect(fetch.calls).toHaveLength(0)
  })

  it('rejects a rename target with a separator as BDPAN_INVALID_NAME', async () => {
    const { gateway } = gatewayOf(tokenedCredentials(), scriptedFetch([]))
    const outcome = await gateway.rename({ path: '/apps/bdpan/a.txt', newName: 'a/b.txt' })
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.code).toBe('BDPAN_INVALID_NAME')
  })

  it('requires the delete voucher to cover exactly the target set', async () => {
    const routes: FetchRoute[] = [
      { match: url => url.includes('xpan/filemanager'), reply: () => Response.json({ errno: 0 }) },
    ]
    const { gateway } = gatewayOf(tokenedCredentials(), scriptedFetch(routes))
    const mismatch = await gateway.remove({ paths: ['/apps/bdpan/a.txt'], confirmPaths: ['/apps/bdpan/b.txt'] })
    expect(mismatch.ok).toBe(false)
    if (!mismatch.ok) expect(mismatch.code).toBe('BDPAN_CONFIRM_REQUIRED')
    const exact = await gateway.remove({ paths: ['/apps/bdpan/a.txt'], confirmPaths: ['/apps/bdpan/a.txt'] })
    expect(exact.ok).toBe(true)
  })
})

describe('share validation', () => {
  it('folds a missing entry into BDPAN_NOT_FOUND', async () => {
    const routes: FetchRoute[] = [
      { match: url => url.includes('xpan/file'), reply: () => Response.json({ errno: 0, list: [] }) },
    ]
    const { gateway } = gatewayOf(tokenedCredentials(), scriptedFetch(routes))
    const outcome = await gateway.share({ paths: ['/apps/bdpan/ghost.txt'], period: 7 })
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.code).toBe('BDPAN_NOT_FOUND')
  })
})

describe('transfer jobs', () => {
  it('accepts an upload and lands a failed snapshot with a canonical code', async () => {
    const { gateway } = gatewayOf(tokenedCredentials())
    const ghost = join(tmpdir(), `bdp-ghost-${String(Date.now())}.bin`)
    const outcome = await gateway.startUpload({ localPath: ghost, remotePath: '/apps/bdpan/ghost.bin' })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    const jobId = outcome.value.jobId
    expect(jobId.length).toBeGreaterThan(0)
    await vi.waitFor(async () => {
      const snapshot = await gateway.job({ jobId })
      expect(snapshot.ok && snapshot.value.phase === 'failed').toBe(true)
    })
    const snapshot = await gateway.job({ jobId })
    if (snapshot.ok && snapshot.value.failure !== undefined) {
      expect(snapshot.value.failure.code).toBe('BDPAN_UNKNOWN')
    }
    const all = await gateway.jobs()
    expect(all.ok && all.value.jobs.length).toBe(1)
  })

  it('refuses a relative local path before any job starts', async () => {
    const { gateway } = gatewayOf(tokenedCredentials())
    const outcome = await gateway.startUpload({ localPath: 'relative.txt', remotePath: '/apps/bdpan/r.txt' })
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.code).toBe('BDPAN_INVALID_ARG')
    const all = await gateway.jobs()
    expect(all.ok && all.value.jobs.length).toBe(0)
  })

  it('round-trips a real small upload through a scripted wire', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'bdp-upload-'))
    const localPath = join(dir, 'hello.txt')
    writeFileSync(localPath, 'hello netdisk', 'utf8')
    const routes: FetchRoute[] = [
      { match: url => url.includes('xpan/file') && url.includes('precreate'), reply: () => Response.json({ errno: 0, uploadid: 'u1', block_list: [] }) },
      { match: url => url.includes('xpan/file') && url.includes('method=create'), reply: () => Response.json({ errno: 0, fs_id: 42, md5: 'abc' }) },
    ]
    const { gateway } = gatewayOf(tokenedCredentials(), scriptedFetch(routes))
    const outcome = await gateway.startUpload({ localPath, remotePath: '/apps/bdpan/hello.txt' })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    await vi.waitFor(async () => {
      const snapshot = await gateway.job({ jobId: outcome.value.jobId })
      expect(snapshot.ok && snapshot.value.phase === 'done').toBe(true)
    })
  })
})
