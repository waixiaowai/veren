import { Context } from '@deepseek-ai/cordis'
import type { LoggerService } from '@deepseek-ai/cordis'
import { WECHAT_CONTEXT_LIMIT } from '../src/state.ts'
import type { WechatSecretStore, WechatSecrets, WechatState, WechatStore } from '../src/state.ts'

/**
 * A silent but genuine host logger for provider specs.
 * Cordis' built-in exporter only buffers, so nothing reaches stdout.
 *
 * 供 provider 测试使用的静默真实宿主日志器；cordis 内置导出器只写缓冲区，不会输出到 stdout。
 */
export function testLogger(): LoggerService {
  return new Context().logger
}

/** In-memory credential seam for provider specs. */
export class MemorySecrets implements WechatSecretStore {
  readonly records = new Map<string, WechatSecrets>()

  async read(accountId: string): Promise<WechatSecrets | undefined> {
    const value = this.records.get(accountId)
    return value === undefined ? undefined : structuredClone(value)
  }

  async write(accountId: string, secrets: WechatSecrets): Promise<void> {
    this.records.set(accountId, structuredClone(secrets))
  }

  async remove(accountId: string): Promise<void> {
    this.records.delete(accountId)
  }
}

/** One cached context token in the fake store. */
interface MemoryContext {
  accountId: string
  userId: string
  token: string
  updatedAt: number
}

/** Stable key for one account/user context, matching the real store's key shape. */
function contextKey(accountId: string, userId: string): string {
  return `${accountId}\u0000${userId}`
}

/**
 * In-memory stand-in for the WeChat storage domain.
 *
 * The provider consumes only the narrow {@link WechatStore} seam, so specs run
 * without a storage backend while still exercising the same copy, pruning, and
 * delete semantics as the domain implementation.
 * 微信存储域的内存替身。provider 只依赖窄接口 {@link WechatStore}，因此测试无需存储后端，
 * 又覆盖与 domain 实现相同的拷贝、裁剪与删除语义。
 */
export class MemoryWechatStore implements WechatStore {
  readonly statesById = new Map<string, WechatState>()
  readonly contexts = new Map<string, MemoryContext>()
  /** Set by {@link break} to simulate a closed or unavailable domain. */
  #failure: string | undefined

  states(): WechatState[] {
    this.#assertUsable()
    return [...this.statesById.values()].map(state => structuredClone(state))
  }

  async putState(state: WechatState): Promise<void> {
    this.#assertUsable()
    this.statesById.set(state.accountId, structuredClone(state))
  }

  async deleteState(accountId: string): Promise<void> {
    this.#assertUsable()
    this.statesById.delete(accountId)
    await this.deleteContexts(accountId)
  }

  contextToken(accountId: string, userId: string): string | undefined {
    this.#assertUsable()
    return this.contexts.get(contextKey(accountId, userId))?.token
  }

  async putContextToken(accountId: string, userId: string, token: string, now: number): Promise<void> {
    this.#assertUsable()
    this.contexts.set(contextKey(accountId, userId), { accountId, userId, token, updatedAt: now })
    const own = [...this.contexts.entries()].filter(([, context]) => context.accountId === accountId)
    if (own.length <= WECHAT_CONTEXT_LIMIT) return
    own.sort((left, right) => left[1].updatedAt - right[1].updatedAt)
    for (const [key] of own.slice(0, own.length - WECHAT_CONTEXT_LIMIT)) this.contexts.delete(key)
  }

  async deleteContexts(accountId: string): Promise<void> {
    this.#assertUsable()
    for (const [key, context] of [...this.contexts]) {
      if (context.accountId === accountId) this.contexts.delete(key)
    }
  }

  async close(): Promise<void> {
    this.closed = true
  }

  /** Whether the plugin disposed the store. */
  closed = false

  /** Make every later operation throw, like a closed or unavailable domain. */
  break(message = 'wechat storage is closed'): void {
    this.#failure = message
  }

  /** Throw when the fake is broken. */
  #assertUsable(): void {
    if (this.#failure !== undefined) throw new Error(this.#failure)
  }
}

/** One mocked fetch handler. */
export type FetchHandler = (url: URL, init: RequestInit) => Response | Promise<Response>

/** Build a Response carrying JSON. */
export function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** Wrap a handler as the fetch implementation. */
export function mockFetch(handler: FetchHandler): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url,
    )
    return handler(url, init ?? {})
  }) as typeof fetch
}

/** A request that never settles until its signal aborts. */
export function hangUntilAbort(init: RequestInit): Promise<Response> {
  return new Promise<Response>((_resolve, reject) => {
    const signal = init.signal
    const fail = (): void => reject(new DOMException('Aborted', 'AbortError'))
    if (signal?.aborted) {
      fail()
      return
    }
    signal?.addEventListener('abort', fail, { once: true })
  })
}

/** Seed one authorized account's state and secrets. */
export async function seedAccount(
  store: MemoryWechatStore,
  secrets: MemorySecrets,
  overrides: Partial<WechatState> = {},
): Promise<WechatState> {
  const state: WechatState = {
    accountId: 'acc-1',
    displayName: 'Test Account',
    ownerId: 'owner-1',
    baseUrl: 'https://ilinkai.weixin.qq.com/',
    cursor: '',
    seen: [],
    ...overrides,
  }
  await store.putState(state)
  await secrets.write(state.accountId, { token: 'token-1' })
  return state
}

/** Seed one context token directly through the store's write path. */
export async function seedContext(
  store: MemoryWechatStore,
  accountId: string,
  userId: string,
  token: string,
  now = 1,
): Promise<void> {
  await store.putContextToken(accountId, userId, token, now)
}

/** Poll a predicate until it holds or the deadline passes. */
export async function until(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 2_000,
): Promise<void> {
  const started = Date.now()
  while (!(await predicate())) {
    if (Date.now() - started > timeoutMs) throw new Error('condition was not met in time')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

/** Read one JSON request body. */
export function bodyOf(init: RequestInit): Record<string, unknown> {
  if (typeof init.body !== 'string') throw new Error('expected a string request body')
  const value: unknown = JSON.parse(init.body)
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('expected a JSON object body')
  }
  return value as Record<string, unknown>
}
