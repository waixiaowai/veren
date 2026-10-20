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
import { ImError, ImRegistry } from '../src/contract.ts'
import { ImPeople } from '../src/people.ts'
import { ImRouter } from '../src/router.ts'
import { STRANGER_INTAKE_ASK, parseSelfReport } from '../src/intake.ts'
import { Config } from '../src/index.ts'
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

const silent: ImLogger = { warn() {}, error() {} }

class RecordingService implements ImService {
  readonly features = FEATURES
  readonly sent: ImSendRequest[] = []

  async start(): Promise<void> {}
  async stop(): Promise<void> {}
  async accounts(): Promise<ImAccount[]> {
    return [{ id: 'acc', displayName: 'Account', status: 'online' }]
  }
  listen(): () => void {
    return () => {}
  }
  async bind(_request: ImBindRequest): Promise<ImBindAttempt> {
    throw new ImError('IM_UNSUPPORTED', 'tests do not bind')
  }
  async send(request: ImSendRequest): Promise<ImSendResult> {
    this.sent.push(request)
    return { id: `sent-${this.sent.length}`, sentAt: now() }
  }
}

class TestGateway implements ImSessionGateway {
  async ensureSession(): Promise<{ sessionId: string; created: boolean }> {
    return { sessionId: 'session-1', created: true }
  }
  async ask(): Promise<string | undefined> {
    return undefined
  }
}

let clock = 1_000
function now(): number {
  return clock
}

function advance(ms: number): void {
  clock += ms
}

function message(id: string, externalId: string, text: string): ImMessage {
  return {
    id,
    accountId: 'acc',
    conversationId: `p2p:${externalId}`,
    sender: { id: externalId },
    sentAt: now(),
    content: { type: 'text', text },
  }
}

function setup(options: {
  enabled?: boolean
  replyWindowMs?: number
  maxAsksPerHour?: number
  minAskIntervalMs?: number
} = {}) {
  clock = 1_000
  const ctx = new Context()
  const store = new MemoryStore()
  const service = new RecordingService()
  const registry = new ImRegistry(ctx, () => {})
  registry.register({ id: 'fake', displayName: 'Fake', features: FEATURES, service })
  let counter = 0
  const newId = (prefix: string): string => `${prefix}-${++counter}`
  const people = new ImPeople({ store, logger: silent, now, newId })
  const credentials: ImCredentialStore = { async remove() {} }
  const router = new ImRouter({
    store,
    registry,
    gateway: new TestGateway(),
    credentials,
    people,
    logger: silent,
    config: {
      autoCreateSession: false,
      strangerIntake: {
        enabled: options.enabled ?? true,
        replyWindowMs: options.replyWindowMs ?? 120_000,
        maxAsksPerHour: options.maxAsksPerHour ?? 10,
        minAskIntervalMs: options.minAskIntervalMs ?? 0,
      },
    },
    now,
    newId,
  })
  return { store, service, people, router }
}

async function seedAccount(store: MemoryStore): Promise<void> {
  await store.putAccount({ id: 'acc', provider: 'fake', token_ref: 'im/x' })
}

describe('intake plugin config', () => {
  it('defaults the switch on with the documented bounds', () => {
    expect(Config({}).strangerIntake).toEqual({
      enabled: true,
      replyWindowMs: 120_000,
      maxAsksPerHour: 10,
      minAskIntervalMs: 10_000,
    })
  })

  it('lets the operator switch it off', () => {
    expect(Config({ strangerIntake: { enabled: false } }).strangerIntake.enabled).toBe(false)
  })
})

describe('parseSelfReport', () => {
  it('accepts a whole-line name or an explicit self-introduction', () => {
    expect(parseSelfReport('杨明明')).toEqual({ name: '杨明明', contacts: [] })
    expect(parseSelfReport('我叫杨明明')).toEqual({ name: '杨明明', contacts: [] })
    expect(parseSelfReport('叫我小明明')).toMatchObject({ name: '小明明' })
    expect(parseSelfReport('名字叫 Tom')).toMatchObject({ name: 'Tom' })
    expect(parseSelfReport('my name is Alice')).toMatchObject({ name: 'Alice' })
    expect(parseSelfReport('This is Bob')).toMatchObject({ name: 'Bob' })
  })

  it('extracts unmistakable contacts alongside a name', () => {
    expect(parseSelfReport('我叫杨明明，电话13800138000')).toEqual({
      name: '杨明明',
      contacts: [{ kind: 'phone', value: '13800138000' }],
    })
    expect(parseSelfReport('13800138000')).toEqual({
      contacts: [{ kind: 'phone', value: '13800138000' }],
    })
    expect(parseSelfReport('a@example.com')).toEqual({
      contacts: [{ kind: 'email', value: 'a@example.com' }],
    })
    expect(parseSelfReport('微信号：yang_mingming')).toEqual({
      contacts: [{ kind: 'wechat', value: 'yang_mingming' }],
    })
  })

  it('never guesses a name from greetings, roles, or prose', () => {
    for (const text of ['好的', '在吗？', '嗯', '😀', '我今年30岁', '我是学生', '杨明明你好', '谁啊', 'hello']) {
      expect(parseSelfReport(text)).toBeUndefined()
    }
  })
})

describe('automatic stranger intake', () => {
  it('asks once, records a self-report, and sends to the claimed name with evidence', async () => {
    const { store, service, people, router } = setup()
    await seedAccount(store)
    await router.handle('fake', message('m1', 'wxid-new', '在吗'))
    expect(service.sent).toHaveLength(1)
    expect(service.sent[0]?.target).toEqual({ accountId: 'acc', conversationId: 'p2p:wxid-new' })
    expect(service.sent[0]?.content).toEqual({ type: 'text', text: STRANGER_INTAKE_ASK })

    const person = people.list()[0]
    expect(person?.displayName).toBe('wxid-new')
    expect(person?.claimedName).toBeUndefined()
    expect(person?.identityStatus).toBe('unverified')

    await router.handle('fake', message('m2', 'wxid-new', '我叫杨明明'))
    expect(service.sent).toHaveLength(1)
    const claimed = people.list()[0]
    expect(claimed?.realName).toBeUndefined()
    expect(claimed?.aliases).toEqual([])
    expect(claimed?.claimedName).toBe('杨明明')
    expect(claimed?.identityStatus).toBe('self-reported')

    const sent = await router.sendToPerson({
      person: '杨明明',
      content: { type: 'text', text: '在吗' },
    })
    expect(service.sent).toHaveLength(2)
    expect(service.sent[1]?.target).toEqual({ accountId: 'acc', conversationId: 'p2p:wxid-new' })
    expect(sent.recipient).toMatchObject({
      personId: claimed?.id,
      matchedBy: 'claimedName',
      matchedValue: '杨明明',
      identityStatus: 'self-reported',
      claimedName: '杨明明',
      conversationId: 'p2p:wxid-new',
    })
  })

  it('records a contact-only answer without inventing a name', async () => {
    const { store, people, router } = setup()
    await seedAccount(store)
    await router.handle('fake', message('m1', 'wxid-new', '在吗'))
    await router.handle('fake', message('m2', 'wxid-new', '我的手机是13800138000'))
    const person = people.list()[0]
    expect(person?.claimedName).toBeUndefined()
    expect(person?.claimedContacts).toEqual([{ kind: 'phone', value: '13800138000' }])
    expect(person?.realName).toBeUndefined()
    expect(person?.identityStatus).toBe('self-reported')
    expect(router.intakeStatus().recent[0]?.outcome).toBe('contact')
  })

  it('does not ask again on a burst or after the reply window', async () => {
    const { store, service, people, router } = setup({ replyWindowMs: 10_000 })
    await seedAccount(store)
    await router.handle('fake', message('m1', 'wxid-new', '在吗'))
    await router.handle('fake', message('m2', 'wxid-new', '在吗'))
    await router.handle('fake', message('m3', 'wxid-new', '在吗'))
    expect(service.sent).toHaveLength(1)

    advance(10_001)
    await router.handle('fake', message('m4', 'wxid-new', '我叫李四'))
    expect(service.sent).toHaveLength(1)
    const person = people.list()[0]
    expect(person?.claimedName).toBeUndefined()
    expect(people.intakeOf(person!.id)?.status).toBe('expired')
    expect(router.intakeStatus().counts.expired).toBe(1)
  })

  it('never asks someone the directory can already identify', async () => {
    const { store, service, people, router } = setup()
    await seedAccount(store)
    await people.save({
      address: {
        provider: 'fake',
        accountId: 'acc',
        conversationId: 'p2p:wxid-known',
        externalId: 'wxid-known',
      },
      displayName: '小林',
    })
    await router.handle('fake', message('m1', 'wxid-known', '在吗'))
    expect(service.sent).toHaveLength(0)
    expect(people.list()).toHaveLength(1)
  })

  it('sends nothing at all when the total switch is off', async () => {
    const { store, service, people, router } = setup({ enabled: false })
    await seedAccount(store)
    await router.handle('fake', message('m1', 'wxid-new', '在吗'))
    expect(service.sent).toHaveLength(0)
    expect(people.list()[0]?.id).toBeDefined()
    expect(people.intakes()).toHaveLength(0)
    expect(router.intakeStatus().enabled).toBe(false)
  })

  it('treats a clear refusal as declined and never asks again', async () => {
    const { store, service, people, router } = setup()
    await seedAccount(store)
    await router.handle('fake', message('m1', 'wxid-new', '在吗'))
    await router.handle('fake', message('m2', 'wxid-new', '不方便'))
    expect(service.sent).toHaveLength(1)
    const person = people.list()[0]
    expect(people.intakeOf(person!.id)?.status).toBe('declined')
    await router.handle('fake', message('m3', 'wxid-new', '我叫王五'))
    expect(service.sent).toHaveLength(1)
    expect(people.list()[0]?.claimedName).toBeUndefined()
  })

  it('keeps a false self-report out of every send when it collides with a verified name', async () => {
    const { store, service, people, router } = setup()
    await seedAccount(store)
    await people.save({
      address: {
        provider: 'fake',
        accountId: 'acc',
        conversationId: 'p2p:wxid-known',
        externalId: 'wxid-known',
      },
      displayName: '明明',
      realName: '杨明明',
    })
    await router.handle('fake', message('m1', 'wxid-new', '在吗'))
    await router.handle('fake', message('m2', 'wxid-new', '杨明明'))
    expect(service.sent).toHaveLength(1)

    await expect(router.sendToPerson({
      person: '杨明明',
      content: { type: 'text', text: '在吗' },
    })).rejects.toMatchObject({
      code: 'IM_AMBIGUOUS',
      details: { query: '杨明明', status: 'ambiguous' },
    })
    expect(service.sent).toHaveLength(1)
    const resolution = people.resolve('杨明明')
    expect(resolution.status).toBe('ambiguous')
    if (resolution.status === 'ambiguous') {
      expect(resolution.candidates).toHaveLength(2)
      expect(resolution.candidates.map(item => item.person.identityStatus).sort())
        .toEqual(['self-reported', 'verified'])
    }
  })

  it('caps questions per account across an hour', async () => {
    const { store, service, router } = setup({ maxAsksPerHour: 1 })
    await seedAccount(store)
    await router.handle('fake', message('m1', 'wxid-a', '在吗'))
    await router.handle('fake', message('m2', 'wxid-b', '在吗'))
    expect(service.sent).toHaveLength(1)
    expect(router.intakeStatus().counts.asked).toBe(1)
  })

  it('exposes the exact question and its audit trail', async () => {
    const { store, router } = setup()
    await seedAccount(store)
    await router.handle('fake', message('m1', 'wxid-new', '在吗'))
    await router.handle('fake', message('m2', 'wxid-new', '我叫杨明明'))
    const status = router.intakeStatus()
    expect(status.enabled).toBe(true)
    expect(status.askText).toBe(STRANGER_INTAKE_ASK)
    expect(status.counts.answered).toBe(1)
    expect(status.recent[0]).toMatchObject({
      status: 'answered',
      accountId: 'acc',
      conversationId: 'p2p:wxid-new',
      askText: STRANGER_INTAKE_ASK,
      outcome: 'name',
      claimedName: '杨明明',
    })
  })
})
