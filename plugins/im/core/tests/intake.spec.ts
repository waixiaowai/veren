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
import { STRANGER_INTAKE_ASK } from '../src/intake.ts'
import type { ImStrangerIntakeConfig } from '../src/intake.ts'
import { Config } from '../src/index.ts'
import type { Config as ImConfig } from '../src/index.ts'
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

/**
 * Parse a partial config through the real schema. The `z<Config>` call face
 * demands a fully populated Config, but every field carries a `.default`, so
 * the runtime fills missing fields — this helper only widens the spec's input
 * type so defaults can actually be tested.
 * 经真实 schema 解析部分配置。`z<Config>` 的调用面要求全量 Config，但每个字段
 * 都带 `.default`，运行时会补齐缺省——本助手只放宽测试入参的类型，让缺省值
 * 可被真实地测到。
 */
function parseConfig(
  input: Partial<Omit<ImConfig, 'strangerIntake'>> & { strangerIntake?: Partial<ImStrangerIntakeConfig> },
): ImConfig {
  return Config(input as ImConfig)
}

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
    expect(parseConfig({}).strangerIntake).toEqual({
      enabled: true,
      replyWindowMs: 120_000,
      maxAsksPerHour: 10,
      minAskIntervalMs: 10_000,
    })
  })

  it('lets the operator switch it off', () => {
    expect(parseConfig({ strangerIntake: { enabled: false } }).strangerIntake.enabled).toBe(false)
  })
})

describe('automatic stranger intake', () => {
  it('asks once, and the model settles the question through the report path', async () => {
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

    // A raw reply is no longer parsed: nothing is written until the model
    // reports through the claim path.
    // 原始回复不再被解析：模型经 claim 路径回报之前，什么都不写。
    await router.handle('fake', message('m2', 'wxid-new', '我叫杨明明'))
    expect(service.sent).toHaveLength(1)
    expect(people.list()[0]?.claimedName).toBeUndefined()

    const claimed = await router.reportPersonClaim(person!.id, {
      name: '杨明明',
      accountId: 'acc',
      conversationId: 'p2p:wxid-new',
      messageId: 'im_person_report',
    })
    expect(claimed.realName).toBeUndefined()
    expect(claimed.aliases).toEqual([])
    expect(claimed.claimedName).toBe('杨明明')
    expect(claimed.identityStatus).toBe('self-reported')
    expect(await router.settleIntake(person!.id, 'answered', 'name')).toBe(true)

    const sent = await router.sendToPerson({
      person: '杨明明',
      content: { type: 'text', text: '在吗' },
    })
    expect(service.sent).toHaveLength(2)
    expect(service.sent[1]?.target).toEqual({ accountId: 'acc', conversationId: 'p2p:wxid-new' })
    expect(sent.recipient).toMatchObject({
      personId: claimed.id,
      matchedBy: 'claimedName',
      matchedValue: '杨明明',
      identityStatus: 'self-reported',
      claimedName: '杨明明',
      conversationId: 'p2p:wxid-new',
    })
  })

  it('records a model-reported contact-only claim without inventing a name', async () => {
    const { store, people, router } = setup()
    await seedAccount(store)
    await router.handle('fake', message('m1', 'wxid-new', '在吗'))
    const person = people.list()[0]!
    await router.reportPersonClaim(person.id, {
      contacts: [{ kind: 'phone', value: '13800138000' }],
      accountId: 'acc',
      conversationId: 'p2p:wxid-new',
      messageId: 'im_person_report',
    })
    await router.settleIntake(person.id, 'answered', 'contact')
    const updated = people.list()[0]
    expect(updated?.claimedName).toBeUndefined()
    expect(updated?.claimedContacts).toEqual([{ kind: 'phone', value: '13800138000' }])
    expect(updated?.realName).toBeUndefined()
    expect(updated?.identityStatus).toBe('self-reported')
    expect(router.intakeStatus().recent[0]?.outcome).toBe('contact')
  })

  it('never rewrites or re-asks after a model settle, and settles only once', async () => {
    const { store, people, router } = setup()
    await seedAccount(store)
    await router.handle('fake', message('m1', 'wxid-new', '在吗'))
    const person = people.list()[0]!
    await router.reportPersonClaim(person.id, {
      name: '杨明明',
      accountId: 'acc',
      conversationId: 'p2p:wxid-new',
      messageId: 'im_person_report',
    })
    expect(await router.settleIntake(person.id, 'answered', 'name')).toBe(true)
    expect(await router.settleIntake(person.id, 'declined')).toBe(false)
    expect(people.intakeOf(person.id)?.status).toBe('answered')
  })

  it('does not ask again on a burst or after the display window', async () => {
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
    // The window is display-only now: the row keeps `asked` until the model
    // settles it; it is shown as expired in the audit view.
    // 窗口现在只作展示：行保持 asked 直到模型收尾；审计视图里显示为 expired。
    expect(people.intakeOf(person!.id)?.status).toBe('asked')
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

  it('closes the question as declined from the model and never asks again', async () => {
    const { store, service, people, router } = setup()
    await seedAccount(store)
    await router.handle('fake', message('m1', 'wxid-new', '在吗'))
    expect(service.sent).toHaveLength(1)
    const person = people.list()[0]
    expect(await router.settleIntake(person!.id, 'declined')).toBe(true)
    expect(people.intakeOf(person!.id)?.status).toBe('declined')
    await router.handle('fake', message('m3', 'wxid-new', '我叫王五'))
    expect(service.sent).toHaveLength(1)
    expect(people.list()[0]?.claimedName).toBeUndefined()
  })

  it('keeps a model-reported self-report out of every send when it collides with a verified name', async () => {
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
    const stranger = people.list().find(item => item.displayName === 'wxid-new')
    expect(stranger).toBeDefined()
    await router.reportPersonClaim(stranger!.id, {
      name: '杨明明',
      accountId: 'acc',
      conversationId: 'p2p:wxid-new',
      messageId: 'im_person_report',
    })
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

  it('exposes the exact question and its audit trail after a model settle', async () => {
    const { store, people, router } = setup()
    await seedAccount(store)
    await router.handle('fake', message('m1', 'wxid-new', '在吗'))
    const person = people.list()[0]!
    await router.reportPersonClaim(person.id, {
      name: '杨明明',
      accountId: 'acc',
      conversationId: 'p2p:wxid-new',
      messageId: 'im_person_report',
    })
    await router.settleIntake(person.id, 'answered', 'name')
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
