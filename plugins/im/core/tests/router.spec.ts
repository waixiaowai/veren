import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type {
  ImAccount,
  ImBindAttempt,
  ImBindRequest,
  ImFeatures,
  ImMessage,
  ImSendRequest,
  ImSendResult,
  ImService,
} from '../src/contract.ts'
import { ImRegistry } from '../src/contract.ts'
import { ImRouter } from '../src/router.ts'
import type { ImCredentialStore, ImLogger, ImSessionGateway } from '../src/router.ts'
import { MemoryStore } from './memory-store.ts'

const FEATURES: ImFeatures = {
  direct: true,
  group: false,
  threads: false,
  markdown: false,
  media: { image: false, file: false },
  typing: false,
  auth: ['qrcode'],
  limits: { textChars: 1_800 },
}

class TestAttempt implements ImBindAttempt {
  readonly bindId = 'bind-1'
  status: 'pending' | 'bound' = 'pending'
  challenge = { kind: 'qrcode' as const }
  async submitCode(): Promise<void> {}
  async wait(): Promise<ImAccount> {
    return { id: 'acc', displayName: 'Account', status: 'online' }
  }
  async cancel(): Promise<void> {}
}

class TestService implements ImService {
  readonly features = FEATURES
  started = 0
  stopped = 0
  bindCalls = 0
  readonly sent: ImSendRequest[] = []
  #handler: ((message: ImMessage) => void | Promise<void>) | undefined

  async start(): Promise<void> { this.started += 1 }
  async stop(): Promise<void> { this.stopped += 1 }
  async accounts(): Promise<ImAccount[]> {
    return [{ id: 'acc', displayName: 'Account', status: 'online' }]
  }
  listen(handler: (message: ImMessage) => void | Promise<void>): () => void {
    this.#handler = handler
    return () => { this.#handler = undefined }
  }
  async bind(_request: ImBindRequest): Promise<ImBindAttempt> {
    this.bindCalls += 1
    return new TestAttempt()
  }
  async send(request: ImSendRequest): Promise<ImSendResult> {
    this.sent.push(request)
    return { id: `sent-${this.sent.length}`, sentAt: 1 }
  }
  async emit(message: ImMessage): Promise<void> {
    await this.#handler?.(message)
  }
}

class TestGateway implements ImSessionGateway {
  readonly asks: Array<{ sessionId: string; prompt: string; source: { conversationId: string } }> = []
  readonly answers = new Map<string, string>()
  #counter = 0
  async ensureSession(request: { sessionId?: string }): Promise<{ sessionId: string; created: boolean }> {
    const sessionId = request.sessionId ?? `session-${++this.#counter}`
    return { sessionId, created: request.sessionId === undefined }
  }
  async ask(request: { sessionId: string; prompt: string; source: { conversationId: string } }): Promise<string | undefined> {
    this.asks.push(request)
    return this.answers.get(request.sessionId) ?? `reply:${request.sessionId}`
  }
}

class RemovingService extends TestService {
  readonly removed: string[] = []
  async removeAccount(accountId: string): Promise<void> {
    this.removed.push(accountId)
  }
}

class SlowGateway extends TestGateway {
  active = 0
  maxActive = 0
  override async ask(request: { sessionId: string; prompt: string; source: { conversationId: string } }): Promise<string | undefined> {
    this.active += 1
    this.maxActive = Math.max(this.maxActive, this.active)
    await new Promise(resolve => setTimeout(resolve, 10))
    this.active -= 1
    return super.ask(request)
  }
}

function message(id: string, conversationId = 'p2p:u1'): ImMessage {
  return {
    id,
    accountId: 'acc',
    conversationId,
    sender: { id: 'u1' },
    sentAt: 1,
    content: { type: 'text', text: id },
  }
}

function setup(options: { autoCreateSession?: boolean; gateway?: TestGateway; registerProvider?: boolean; service?: ImService } = {}) {
  const ctx = new Context()
  const store = new MemoryStore()
  const service = options.service ?? new TestService()
  const gateway = options.gateway ?? new TestGateway()
  const removed: string[] = []
  const credentials: ImCredentialStore = { async remove(accountId) { removed.push(accountId) } }
  const logger: ImLogger = { warn() {}, error() {} }
  let router: ImRouter | undefined
  const registry = new ImRegistry(ctx, (providerId, inbound) => {
    if (router !== undefined) void router.handle(providerId, inbound)
  })
  if (options.registerProvider !== false) {
    registry.register({ id: 'fake', displayName: 'Fake', features: FEATURES, service })
  }
  let counter = 0
  router = new ImRouter({
    store,
    registry,
    gateway,
    credentials,
    logger,
    config: { autoCreateSession: options.autoCreateSession ?? false },
    newId: prefix => `${prefix}-${++counter}`,
  })
  return { ctx, store, service: service as TestService, gateway, removed, registry, router }
}

async function seedAccount(store: MemoryStore): Promise<void> {
  await store.putAccount({ id: 'acc', provider: 'fake', token_ref: 'im/x' })
}

describe('ImRouter', () => {
  it('routes to the active binding and switches after relink', async () => {
    const { router, store, gateway } = setup()
    await seedAccount(store)
    const first = await router.link({ accountId: 'acc', conversationId: 'p2p:u1', sessionId: 's1', active: true })
    await router.handle('fake', message('m1'))
    const second = await router.link({ accountId: 'acc', conversationId: 'p2p:u1', sessionId: 's2', active: true })
    await router.handle('fake', message('m2'))
    expect(gateway.asks[0]?.sessionId).toBe('s1')
    expect(gateway.asks[1]?.sessionId).toBe('s2')
    expect(store.getBinding(first.id)?.active).toBe(false)
    expect(second.active).toBe(true)
  })

  it('replies to the conversation that produced the turn', async () => {
    const { router, store, service } = setup()
    await seedAccount(store)
    await router.link({ accountId: 'acc', conversationId: 'p2p:u1', sessionId: 'shared', active: true })
    await router.link({ accountId: 'acc', conversationId: 'p2p:u2', sessionId: 'shared', active: true })
    await router.handle('fake', message('m1', 'p2p:u1'))
    await router.handle('fake', message('m2', 'p2p:u2'))
    expect(service.sent.map(item => item.target.conversationId)).toEqual(['p2p:u1', 'p2p:u2'])
    expect(service.sent.map(item => item.replyToMessageId)).toEqual(['m1', 'm2'])
  })

  it('serializes messages from one conversation', async () => {
    const gateway = new SlowGateway()
    const { router, store } = setup({ gateway })
    await seedAccount(store)
    await router.link({ accountId: 'acc', conversationId: 'p2p:u1', sessionId: 's1', active: true })
    await Promise.all([
      router.handle('fake', message('m1')),
      router.handle('fake', message('m2')),
    ])
    expect(gateway.maxActive).toBe(1)
  })

  it('auto-creates a binding only when configured', async () => {
    const absent = setup()
    await seedAccount(absent.store)
    await absent.router.handle('fake', message('m1'))
    expect(absent.gateway.asks).toHaveLength(0)
    expect(absent.store.bindings()).toHaveLength(0)

    const enabled = setup({ autoCreateSession: true })
    await seedAccount(enabled.store)
    await enabled.router.handle('fake', message('m1'))
    expect(enabled.gateway.asks).toHaveLength(1)
    expect(enabled.store.bindings()).toHaveLength(1)
    expect(enabled.store.bindings()[0]?.active).toBe(true)
  })

  it('keeps authorization and conversation binding separate', async () => {
    const { router, store, service } = setup()
    await seedAccount(store)
    await router.beginBind('fake', { method: 'qrcode' })
    expect(service.bindCalls).toBe(1)
    expect(store.bindings()).toHaveLength(0)
    await router.link({ accountId: 'acc', conversationId: 'p2p:u1', sessionId: 's1' })
    expect(service.bindCalls).toBe(1)
  })

  it('unbinds an account: stops runtime, removes credential, deletes rows', async () => {
    const { router, store, service, removed } = setup()
    await seedAccount(store)
    await router.link({ accountId: 'acc', conversationId: 'p2p:u1', sessionId: 's1' })
    const result = await router.unbindAccount('acc')
    expect(result.removed).toBe(true)
    expect(result.revoked).toBe(false)
    expect(service.stopped).toBe(1)
    expect(service.started).toBe(1)
    expect(removed).toEqual(['acc'])
    expect(store.accounts()).toHaveLength(0)
    expect(store.bindings()).toHaveLength(0)
  })

  it('prefers single-account removal without stopping the runtime', async () => {
    const service = new RemovingService()
    const { router, store } = setup({ service })
    await seedAccount(store)
    await router.link({ accountId: 'acc', conversationId: 'p2p:u1', sessionId: 's1' })
    const result = await router.unbindAccount('acc')
    expect(result.removed).toBe(true)
    expect(service.removed).toEqual(['acc'])
    // Other accounts are untouched: no stop/start cycle happened.
    // 其他账号不受影响：没有发生 stop/start 循环。
    expect(service.stopped).toBe(0)
    expect(service.started).toBe(0)
    expect(store.accounts()).toHaveLength(0)
    expect(store.bindings()).toHaveLength(0)
  })

  it('keeps exactly one active binding under concurrent links', async () => {
    const { router, store } = setup()
    await seedAccount(store)
    await Promise.all([
      router.link({ accountId: 'acc', conversationId: 'p2p:u1' }),
      router.link({ accountId: 'acc', conversationId: 'p2p:u1' }),
      router.link({ accountId: 'acc', conversationId: 'p2p:u1' }),
    ])
    const active = store.bindings().filter(binding => binding.active)
    expect(store.bindings().length).toBe(3)
    expect(active).toHaveLength(1)
  })

  it('requires an explicit send target and resolves a binding target', async () => {
    const { router, store, service } = setup()
    await seedAccount(store)
    const binding = await router.link({ accountId: 'acc', conversationId: 'p2p:u1', sessionId: 's1' })
    await expect(router.send({ content: { type: 'text', text: 'x' } }))
      .rejects.toMatchObject({ code: 'IM_INVALID_REQUEST' })
    await router.send({ bindingId: binding.id, content: { type: 'text', text: 'x' } })
    expect(service.sent[0]?.target).toEqual({ accountId: 'acc', conversationId: 'p2p:u1' })
  })

  it('degrades markdown to text when the provider has no markdown', async () => {
    const { router, store, service } = setup()
    await seedAccount(store)
    await router.send({
      accountId: 'acc',
      conversationId: 'p2p:u1',
      content: { type: 'markdown', text: '# hi' },
    })
    expect(service.sent[0]?.content).toEqual({ type: 'text', text: '# hi' })
  })

  it('throws IM_NOT_FOUND for an unknown provider', () => {
    const { registry } = setup()
    expect(() => registry.get('missing')).toThrowError(expect.objectContaining({ code: 'IM_NOT_FOUND' }))
  })

  it('persists a bound account once and drops the attempt after the first poll', async () => {
    const { router, store } = setup()
    const attempt = await router.beginBind('fake', { method: 'qrcode' })
    ;(attempt as TestAttempt).status = 'bound'
    const first = await router.pollBind(attempt.bindId)
    expect(first.account?.id).toBe('acc')
    expect(store.accounts().map(row => row.id)).toEqual(['acc'])
    // A second poll must fail loudly instead of re-persisting the same account.
    // 第二次 poll 必须明确失败，而不是重复持久化同一个账号。
    await expect(router.pollBind(attempt.bindId))
      .rejects.toMatchObject({ code: 'IM_NOT_FOUND' })
    expect(store.accounts()).toHaveLength(1)
  })

  it('reports IM_NOT_FOUND when no provider is registered', () => {
    const { router } = setup({ registerProvider: false })
    expect(() => router.resolveProvider()).toThrowError(expect.objectContaining({ code: 'IM_NOT_FOUND' }))
  })
})
