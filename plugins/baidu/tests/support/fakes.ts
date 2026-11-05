/**
 * 测试替身：内存凭据库、脚本化 fetch 与工作区注册表假实现
 * （Object.create 保持真实原型链，与 imagegen 测试同型）。
 * Test doubles: the in-memory credential store, a scripted fetch, and a fake
 * workspace registry (Object.create keeps the real prototype chain — the
 * imagegen tests' shape).
 *
 * @module tests/support
 */
import { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import type { CredentialKey, CredentialRecord } from '@deepseek-ai/dsh-credentials'
import type { FetchLike } from '../../src/wire.js'
import type { OAuthTokens } from '../../src/types.js'
import { BAIDU_PAN_RECORD } from '../../src/credentials.js'

/** 记录型凭据假实现：readRecord/modifyRecord/deleteRecord 作用于内存 Map。 */
/** Recording credential fake: readRecord/modifyRecord/deleteRecord operate on an in-memory map. */
export function fakeCredentials(records: Map<CredentialKey, CredentialRecord> = new Map()): CredentialProvider {
  const provider = Object.create(CredentialProvider.prototype) as CredentialProvider
  Object.assign(provider, {
    async readRecord(key: CredentialKey) {
      return records.get(key)
    },
    async modifyRecord(key: CredentialKey, transform: (current: CredentialRecord | undefined) => Promise<CredentialRecord>) {
      records.set(key, await transform(records.get(key)))
      return records.get(key)
    },
    async deleteRecord(key: CredentialKey) {
      records.delete(key)
    },
  })
  return provider
}

/** 远期令牌（测试内永不触发刷新）。The far-future tokens (refresh never fires inside tests). */
export function farFutureTokens(): OAuthTokens {
  return {
    accessToken: 'test-access',
    refreshToken: 'test-refresh',
    expiresAt: new Date(Date.now() + 3600 * 1000).toISOString(),
    scope: 'basic netdisk',
  }
}

/** 已带令牌的凭据假实现。The credential fake preloaded with tokens. */
export function tokenedCredentials(): CredentialProvider {
  return fakeCredentials(new Map([[BAIDU_PAN_RECORD, { kind: 'grant', payload: farFutureTokens() }]]))
}

/** 一条脚本路由。One scripted route. */
export interface FetchRoute {
  readonly match: (url: string) => boolean
  readonly reply: (url: string) => Response
}

/** 脚本化 fetch 假实现：按路由顺序应答并记账全部调用。The scripted fetch fake: answers routes in order and records every call. */
export function scriptedFetch(routes: FetchRoute[]): FetchLike & { calls: string[] } {
  const calls: string[] = []
  const fetchLike = (async (input: unknown) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : String((input as Request).url)
    calls.push(url)
    const route = routes.find(candidate => candidate.match(url))
    if (route === undefined) throw new Error(`no scripted route for ${url}`)
    return route.reply(url)
  }) as FetchLike & { calls: string[] }
  return Object.assign(fetchLike, { calls })
}

/** OAuth 令牌端点的成功应答。The token endpoint's success reply. */
export function tokenResponse(): Response {
  return Response.json({
    access_token: 'fresh-access',
    refresh_token: 'fresh-refresh',
    expires_in: 2592000,
    scope: 'basic netdisk',
  })
}

/** 工作区注册表假实现。The fake workspace registry. */
export function fakeWorkspaceRegistry(entries: ReadonlyArray<{ sessionIds: readonly string[]; path: string }> = []): { list(): typeof entries } {
  return { list: () => entries }
}

/** 现成的测试配置。The ready-made test config. */
export const TEST_CONFIG = {
  appKey: 'test-app-key',
  secretKey: 'test-secret-key',
} as const
