import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ImRegistry } from '../src/contract.ts'
import type { ImDirectoryRemote, ImDirectorySnapshot, ImDirectoryUpsert, ImFeatures, ImMessage } from '../src/contract.ts'
import { ImRouter } from '../src/router.ts'
import type { ImSessionGateway } from '../src/runtime-seams.ts'
import { ImPeople } from '../src/people.ts'
import { MemoryStore } from './memory-store.ts'

/** 云端目录假实现：记录上报、返回脚本化快照。 */
class FakeDirectory implements ImDirectoryRemote {
  readonly upserts: ImDirectoryUpsert[] = []
  constructor(private readonly snapshot: ImDirectorySnapshot) {}
  async upsert(entry: ImDirectoryUpsert): Promise<void> {
    this.upserts.push(entry)
  }
  async pull(): Promise<ImDirectorySnapshot> {
    return this.snapshot
  }
}

/** 最小网关：ask 即回答。 */
class EchoGateway implements ImSessionGateway {
  async ensureSession(): Promise<{ sessionId: string; created: boolean }> {
    return { sessionId: 'session-x', created: true }
  }
  async ask(): Promise<string | undefined> {
    return '回'
  }
  dispose(): void {}
}

let clock = 5_000
function message(text: string): ImMessage {
  clock += 1
  return {
    id: `m${clock}`,
    accountId: 'acc',
    conversationId: 'p2p:u1@im.wechat',
    sender: { id: 'u1@im.wechat' },
    sentAt: clock,
    content: { type: 'text', text },
  }
}

function snapshotOf(displayName: string): ImDirectorySnapshot {
  return {
    people: [{
      id: 'person_1', owner_id: 'o1@im.wechat', display_name: displayName,
      claimed_name: '', identity_status: 'self-reported', note: '', updated_at: 1,
    }],
    addresses: {
      person_1: [{
        person_id: 'person_1', provider: 'fake', external_id: 'u1@im.wechat',
        display_name: displayName, updated_at: 1,
      }],
    },
  }
}

function build(snapshot: ImDirectorySnapshot): { router: ImRouter; people: ImPeople; directory: FakeDirectory; detach: () => void } {
  const store = new MemoryStore()
  const people = new ImPeople({ store, logger: silent })
  const directory = new FakeDirectory(snapshot)
  const registry = new ImRegistry(new Context(), () => {}, undefined, people)
  const detach = registry.attachDirectory(directory, { provider: 'fake', accountId: 'acc' })
  registry.register({ id: 'fake', displayName: 'Fake', features: FEATURES, service: {
    async start() {}, async stop() {}, async accounts() { return [] }, listen: () => () => {},
    async bind() { throw new Error('no bind') }, async send() { return { id: 's1', sentAt: 1 } },
  } })
  const router = new ImRouter({
    store, registry, gateway: new EchoGateway(),
    credentials: { async remove() {} },
    people, logger: silent, config: {},
  })
  return { router, people, directory, detach }
}

const FEATURES: ImFeatures = {
  direct: true, group: false, threads: false, markdown: false,
  media: { image: false, file: false }, typing: false, auth: ['qrcode'],
  limits: {},
}

/** 静默 logger（与 router.spec 同款）。 */
const silent = { info: () => {}, warn: () => {}, error: () => {} } as never

describe('cloud directory seam', () => {
  it('attaching adopts the pulled snapshot into the local cache', async () => {
    const { people } = build(snapshotOf('杨明明'))
    await vi.waitFor(() => {
      const views = people.list()
      expect(views.length).toBe(1)
      expect(views[0]?.displayName).toBe('杨明明')
    })
  })

  it('observing a sender pushes the identity upstream', async () => {
    const { router, directory } = build(snapshotOf('杨明明'))
    await router.handle('fake', message('你好'))
    expect(directory.upserts.length).toBe(1)
    expect(directory.upserts[0]?.provider).toBe('fake')
    expect(directory.upserts[0]?.externalId).toBe('u1@im.wechat')
  })

  it('detaching clears the remote so later observes stay local', async () => {
    const { router, directory, detach } = build(snapshotOf('杨明明'))
    await vi.waitFor(() => expect(directory.upserts.length).toBe(0))
    detach()
    await router.handle('fake', message('第二条'))
    expect(directory.upserts.length).toBe(0)
  })
})
