import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WechatStateStore } from '../src/state.ts'
import type { WechatSecretStore, WechatSecrets, WechatState } from '../src/state.ts'

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

/** Create one temporary provider directory. */
export async function tempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'im-wechat-'))
}

/** Remove one temporary directory. */
export async function removeDir(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true })
}

/** Seed one authorized account's state and secrets. */
export async function seedAccount(
  root: string,
  secrets: MemorySecrets,
  overrides: Partial<WechatState> = {},
): Promise<WechatState> {
  const state: WechatState = {
    version: 1,
    accountId: 'acc-1',
    displayName: 'Test Account',
    ownerId: 'owner-1',
    baseUrl: 'https://ilinkai.weixin.qq.com/',
    cursor: '',
    seen: [],
    ...overrides,
  }
  await new WechatStateStore(root).write(state)
  await secrets.write(state.accountId, { token: 'token-1', contexts: {} })
  return state
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
