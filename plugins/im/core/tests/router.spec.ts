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
import { ImPeople } from '../src/people.ts'
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
  cancels = 0
  async submitCode(): Promise<void> {}
  async wait(): Promise<ImAccount> {
    return { id: 'acc', displayName: 'Account', status: 'online' }
  }
  async cancel(): Promise<void> {
    this.cancels += 1
  }
}

class TestService implements ImService {
  readonly features = FEATURES
  started = 0
  stopped = 0
  bindCalls = 0
  lastAttempt: TestAttempt | undefined
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
    const attempt = new TestAttempt()
    this.lastAttempt = attempt
    return attempt
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
  const newId = (prefix: string): string => `${prefix}-${++counter}`
  const people = new ImPeople({ store, logger, newId })
  router = new ImRouter({
    store,
    registry,
    gateway,
    credentials,
    people,
    logger,
    config: { autoCreateSession: options.autoCreateSession ?? false },
    newId,
  })
  return { ctx, store, people, service: service as TestService, gateway, removed, registry, router }
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

  it('drops remembered bind attempts on dispose without cancelling them', async () => {
    const { router, service } = setup()
    const attempt = await router.beginBind('fake', { method: 'qrcode' })
    expect(attempt.status).toBe('pending')
    router.dispose()
    await expect(router.pollBind(attempt.bindId)).rejects.toMatchObject({ code: 'IM_NOT_FOUND' })
    expect(service.lastAttempt?.cancels).toBe(0)
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

  it('sends to a person and reports exactly who matched', async () => {
    const { router, store, people, service } = setup()
    await seedAccount(store)
    await people.save({
      address: { provider: 'fake', accountId: 'acc', conversationId: 'p2p:u1', externalId: 'u1' },
      displayName: '明明',
      realName: '杨明明',
      aliases: ['杨总'],
    })
    const sent = await router.sendToPerson({
      person: '杨总',
      content: { type: 'text', text: '在吗' },
    })
    expect(service.sent).toHaveLength(1)
    expect(service.sent[0]?.target).toEqual({ accountId: 'acc', conversationId: 'p2p:u1' })
    expect(sent.recipient).toMatchObject({
      displayName: '明明',
      matchedBy: 'alias',
      matchedValue: '杨总',
      accountId: 'acc',
      conversationId: 'p2p:u1',
    })
  })

  it('refuses two people with the same name and sends nothing', async () => {
    const { router, store, people, service } = setup()
    await seedAccount(store)
    await people.save({
      address: { provider: 'fake', accountId: 'acc', conversationId: 'p2p:u1', externalId: 'u1' },
      displayName: '杨明明',
    })
    await people.save({
      address: { provider: 'fake', accountId: 'acc', conversationId: 'p2p:u2', externalId: 'u2' },
      displayName: '杨明明',
    })
    await expect(router.sendToPerson({
      person: '杨明明',
      content: { type: 'text', text: '在吗' },
    })).rejects.toMatchObject({
      code: 'IM_AMBIGUOUS',
      details: { query: '杨明明', status: 'ambiguous' },
    })
    expect(service.sent).toHaveLength(0)
  })

  it('reports not-found with suggestions and sends nothing', async () => {
    const { router, store, people, service } = setup()
    await seedAccount(store)
    await people.save({
      address: { provider: 'fake', accountId: 'acc', conversationId: 'p2p:u1', externalId: 'u1' },
      displayName: '杨明明',
    })
    await expect(router.sendToPerson({
      person: '杨明',
      content: { type: 'text', text: '在吗' },
    })).rejects.toMatchObject({
      code: 'IM_NOT_FOUND',
      details: { query: '杨明', status: 'not-found' },
    })
    expect(service.sent).toHaveLength(0)
  })

  it('refuses a person with more than one reachable address', async () => {
    const { router, store, people, service } = setup()
    await seedAccount(store)
    const person = await people.save({
      address: { provider: 'fake', accountId: 'acc', conversationId: 'p2p:u1', externalId: 'u1' },
      displayName: '杨明明',
    })
    await people.save({
      personId: person.id,
      address: { provider: 'fake', accountId: 'acc', conversationId: 'p2p:u2', externalId: 'u2' },
    })
    await expect(router.sendToPerson({
      person: '杨明明',
      content: { type: 'text', text: '在吗' },
    })).rejects.toMatchObject({ code: 'IM_AMBIGUOUS', details: { reason: 'address' } })
    expect(service.sent).toHaveLength(0)
  })

  it('reports IM_NO_ADDRESS instead of guessing another account', async () => {
    const { router, store, people, service } = setup()
    await seedAccount(store)
    await store.putAccount({ id: 'acc-2', provider: 'fake', token_ref: 'im/y' })
    await people.save({
      address: { provider: 'fake', accountId: 'acc', conversationId: 'p2p:u1', externalId: 'u1' },
      displayName: '杨明明',
    })
    await expect(router.sendToPerson({
      person: '杨明明',
      accountId: 'acc-2',
      content: { type: 'text', text: '在吗' },
    })).rejects.toMatchObject({ code: 'IM_NO_ADDRESS' })
    expect(service.sent).toHaveLength(0)
  })

  it('pins an address query and never redirects it to another address', async () => {
    const { router, store, people, service } = setup()
    await seedAccount(store)
    await store.putAccount({ id: 'acc-2', provider: 'fake', token_ref: 'im/y' })
    const person = await people.save({
      address: { provider: 'fake', accountId: 'acc', conversationId: 'p2p:u1', externalId: 'u1' },
      displayName: '杨明明',
    })
    await people.save({
      personId: person.id,
      address: { provider: 'fake', accountId: 'acc-2', conversationId: 'p2p:u2', externalId: 'u2' },
    })
    await expect(router.sendToPerson({
      person: 'p2p:u1',
      accountId: 'acc-2',
      content: { type: 'text', text: '在吗' },
    })).rejects.toMatchObject({ code: 'IM_NO_ADDRESS' })
    expect(service.sent).toHaveLength(0)
  })

  it('registers an inbound sender in the directory before routing', async () => {
    const { router, store, people } = setup()
    await seedAccount(store)
    await router.handle('fake', message('m1'))
    const listed = people.list()
    expect(listed).toHaveLength(1)
    expect(listed[0]?.displayName).toBe('u1')
    expect(listed[0]?.addresses).toEqual([{
      provider: 'fake',
      accountId: 'acc',
      conversationId: 'p2p:u1',
      externalId: 'u1',
    }])
  })

  it('shows the known sender name in the routed prompt', async () => {
    const { router, store, gateway, people } = setup()
    await seedAccount(store)
    await router.link({ accountId: 'acc', conversationId: 'p2p:u1', sessionId: 's1', active: true })
    const person = people.list()[0]
    expect(person).toBeDefined()
    await people.save({ personId: person!.id, displayName: '杨明明' })
    await router.handle('fake', message('m1'))
    expect(gateway.asks[0]?.prompt).toContain('sender: 杨明明 (u1)')
  })

  it('keeps person profiles but drops addresses when an account is removed', async () => {
    const { router, store, people } = setup()
    await seedAccount(store)
    await router.link({ accountId: 'acc', conversationId: 'p2p:u1', sessionId: 's1' })
    expect(people.list()[0]?.addresses).toHaveLength(1)
    await router.unbindAccount('acc')
    expect(people.list()).toHaveLength(1)
    expect(people.list()[0]?.addresses).toHaveLength(0)
  })
})
