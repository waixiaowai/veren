import { describe, expect, it } from 'vitest'
import { ImError } from '../src/contract.ts'
import type {
  ImAccount, ImBindAttempt, ImBindRequest, ImFeatures, ImMessage, ImSendRequest, ImSendResult,
} from '../src/contract.ts'
import { Context } from '@deepseek-ai/cordis'
import { ImRegistry } from '../src/contract.ts'
import { ImMessageQueue, ImRouter } from '../src/router.ts'
import type { ImCredentialStore, ImSessionGateway } from '../src/runtime-seams.ts'
import { ImPeople } from '../src/people.ts'
import { MemoryStore } from './memory-store.ts'

/**
 * The message-queue drills, in test form: order, idempotency, crash recovery,
 * and the dead-letter notice. The same drills run again on the live node.
 * 消息队列演练（测试形态）：顺序、幂等、崩溃恢复与死信告知。同样的演练也会在真机执行。
 */

const silent = { info: () => undefined, warn: () => undefined, error: () => undefined }

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

/** A provider that records every send so replies can be asserted in order. */
class RecordingService {
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
    return { id: `sent-${this.sent.length}`, sentAt: 1 }
  }
}

/**
 * A gateway whose answers are scripted; `holdNext` makes turns block until
 * released, which is how an in-flight consume is simulated.
 * 回答脚本化的网关；`holdNext` 让回合阻塞到放行，用来模拟在途消费。
 */
class ScriptedGateway implements ImSessionGateway {
  private pending = 0
  private waiters: Array<() => void> = []
  private answer = '脚本回答'

  /** Make the next `ask` calls block until released. */
  holdNext(count: number): void {
    this.pending += count
  }

  /** Release every held turn. */
  release(): void {
    for (const release of this.waiters.splice(0)) release()
    this.pending = 0
  }

  /** Make every subsequent ask throw (the dead-letter path). */
  failAll = false

  async ensureSession(): Promise<{ sessionId: string; created: boolean }> {
    return { sessionId: 'session-1', created: true }
  }

  async ask(): Promise<string | undefined> {
    if (this.failAll) throw new ImError('IM_INTERNAL', 'the model exploded')
    if (this.pending > 0) {
      this.pending -= 1
      await new Promise<void>(resolve => { this.waiters.push(resolve) })
    }
    return this.answer
  }
}

let clock = 1_000
function message(id: string, text: string, conversationId = 'p2p:human'): ImMessage {
  clock += 1
  return {
    id,
    accountId: 'acc',
    conversationId,
    sender: { id: 'human@im.wechat' },
    sentAt: clock,
    content: { type: 'text', text },
  }
}

/** One router over fresh stores with the scripted gateway. */
function setup(gateway: ImSessionGateway): { router: ImRouter; service: RecordingService; store: MemoryStore } {
  const store = new MemoryStore()
  const service = new RecordingService()
  const registry = new ImRegistry(new Context(), () => {})
  registry.register({ id: 'fake', displayName: 'Fake', features: FEATURES, service })
  const credentials: ImCredentialStore = { async remove() {} }
  const router = new ImRouter({
    store,
    registry,
    gateway,
    credentials,
    people: new ImPeople({ store, logger: silent }),
    logger: silent,
    config: {},
  })
  return { router, service, store }
}

/** The text of every text reply the provider recorded, in order. */
function replyTexts(service: RecordingService): string[] {
  return service.sent
    .filter(request => request.content.type === 'text')
    .map(request => request.content.type === 'text' ? request.content.text : '')
}

describe('message-queue drills', () => {
  it('answers three rapid messages strictly in order', async () => {
    const gateway = new ScriptedGateway()
    const { router, service, store } = setup(gateway)
    await router.handle('fake', message('m1', '一'))
    await router.handle('fake', message('m2', '二'))
    await router.handle('fake', message('m3', '三'))

    const replies = replyTexts(service).filter(text => !text.includes('已收到'))
    expect(replies).toEqual(['脚本回答', '脚本回答', '脚本回答'])
    expect(store.messages().every(row => row.status === 'replied')).toBe(true)
  })

  it('delivers the same message id twice exactly once', async () => {
    const gateway = new ScriptedGateway()
    const { router, service, store } = setup(gateway)
    await router.handle('fake', message('m1', '你好'))
    await router.handle('fake', message('m1', '你好'))

    const replies = replyTexts(service).filter(text => !text.includes('已收到'))
    expect(replies.length).toBe(1)
    expect(store.messages().length).toBe(1)
    expect(store.messages()[0]?.status).toBe('replied')
  })

  it('recovers a row stuck mid-consume when the host restarts', async () => {
    const gateway = new ScriptedGateway()
    const { router, service, store } = setup(gateway)
    // 消费中崩溃的形态：行被认领（consuming）但回合没有完成。
    // The crash shape: the row was claimed (consuming) but the turn never finished.
    clock += 1
    await store.putMessage({
      message_id: 'stuck',
      provider: 'fake',
      account_id: 'acc',
      conversation_id: 'p2p:human',
      sender: 'human@im.wechat',
      text: '崩溃前的那条',
      received_at: clock,
      status: 'consuming',
      attempts: 0,
      updated_at: clock,
    })
    // 重启 = 新的 apply：恢复逻辑把 consuming 行放回排队（队列单元测试已单独覆盖）。
    // A restart means a fresh apply: recovery puts consuming rows back (covered
    // in the queue spec on its own).
    await new ImMessageQueue({ store }).recoverStuck()

    await router.handle('fake', message('m1', '重启后的第一条'))

    const stuck = store.messages().find(row => row.message_id === 'stuck')
    expect(stuck?.status).toBe('replied')
    const replies = replyTexts(service).filter(text => !text.includes('已收到'))
    expect(replies.length).toBe(2)
  })

  it('announces the dead letter once the retry budget is spent', async () => {
    const gateway = new ScriptedGateway()
    gateway.failAll = true
    const { router, service, store } = setup(gateway)

    await router.handle('fake', message('m1', '注定失败'))

    const notices = replyTexts(service).filter(text => text.includes('处理失败'))
    expect(notices.length).toBe(1)
    expect(store.messages()[0]?.status).toBe('dead')
  })

  it('acks a new message while the conversation still has work in flight', async () => {
    const gateway = new ScriptedGateway()
    const { router, service } = setup(gateway)
    gateway.holdNext(1)
    const first = router.handle('fake', message('m1', '占住在途'))
    const second = router.handle('fake', message('m2', '排队的那条'))

    // 等 ack 真正发出（第二条开始消费前它就必须已经在路上）。
    for (let waited = 0; replyTexts(service).every(text => !text.includes('已收到')); waited += 1) {
      if (waited > 100) throw new Error('the queue ack never went out')
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    gateway.release()
    await Promise.all([first, second])

    const acks = replyTexts(service).filter(text => text.includes('已收到'))
    expect(acks.length).toBe(1)
  })
})
