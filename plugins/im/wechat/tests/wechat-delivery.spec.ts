import { Context } from '@deepseek-ai/cordis'
import type { LoggerService } from '@deepseek-ai/cordis'
import { ImRegistry } from '@veren/im'
import type { ImAccount, ImSendRequest, ImService } from '@veren/im'
import type { ImMessageNew } from '@veren/im-conversation'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { channelTargetOf, deliverRoomMessage } from '../src/delivery.ts'
import { WEIXIN_FEATURES } from '../src/provider.ts'

/**
 * Outbound delivery: agent-authored room messages on WeChat-backed rooms reach
 * the provider's send; everything else (internal rooms, other providers,
 * human/system authors) is skipped, and every failure stays a warning.
 * 出站投递：微信背书房间里智能体写的消息到达 provider 的发送；其余一切（内部房间、其他
 * provider、人类/系统作者）都被跳过，且所有失败都只停留在警告。
 */

/** A recording ImService stub: only send is exercised by the delivery. */
/** 一只记录用的 ImService 桩：投递只会用到 send。 */
class RecordingService implements ImService {
  readonly sent: ImSendRequest[] = []
  /** When set, the next send rejects with this error. */
  /** 置位时，下一次发送以该错误拒绝。 */
  failWith: Error | undefined

  async start(): Promise<void> {}
  async stop(): Promise<void> {}
  async accounts(): Promise<ImAccount[]> { return [] }
  listen(): () => void { return () => {} }
  async bind(): Promise<never> { throw new Error('not used in this spec') }
  async send(request: ImSendRequest): Promise<{ id: string; sentAt: number }> {
    if (this.failWith !== undefined) throw this.failWith
    this.sent.push(request)
    return { id: `sent-${this.sent.length}`, sentAt: 1 }
  }
}

/** One committed room message payload. */
/** 一条已提交房间消息的载荷。 */
function payload(roomId: string, authorId: string, body = '回复正文'): ImMessageNew {
  return {
    room: { id: roomId, kind: 'direct', members: [], createdAt: 1, updatedAt: 1 },
    message: { id: 'm-1', roomId, authorId, kind: 'text', body, sequence: 2, createdAt: 2 },
  }
}

/** A silent logger recording warnings for assertions (hub spec precedent). */
/** 一只安静的日志器：记录警告供断言使用（沿用 hub 规格的写法）。 */
function silentLogger(): LoggerService {
  return { warn() {}, info() {}, error() {} } as never
}

describe('channelTargetOf', () => {
  it('accepts an agent message on a wechat room', () => {
    expect(channelTargetOf(payload('chan:wechat:acc-1:p2p:u1', 'agent:alice'), 'wechat'))
      .toEqual({ accountId: 'acc-1', conversationId: 'p2p:u1' })
  })

  it('skips internal rooms, other providers, and non-agent authors', () => {
    expect(channelTargetOf(payload('conv:internal-1', 'agent:alice'), 'wechat')).toBeUndefined()
    expect(channelTargetOf(payload('chan:hub:main:p2p:u1', 'agent:alice'), 'wechat')).toBeUndefined()
    expect(channelTargetOf(payload('chan:wechat:acc-1:p2p:u1', 'human:owner'), 'wechat')).toBeUndefined()
    expect(channelTargetOf(payload('chan:wechat:acc-1:p2p:u1', 'system'), 'wechat')).toBeUndefined()
  })
})

describe('deliverRoomMessage', () => {
  let registry: ImRegistry
  let service: RecordingService
  let logger: LoggerService

  beforeEach(() => {
    registry = new ImRegistry(new Context())
    service = new RecordingService()
    logger = silentLogger()
    registry.register({ id: 'wechat', displayName: 'WeChat', features: WEIXIN_FEATURES, service })
  })

  it('sends the degraded body to the recovered channel coordinates', async () => {
    await deliverRoomMessage(
      { providerId: 'wechat', registry, logger },
      payload('chan:wechat:acc-1:p2p:u1', 'agent:alice'),
    )
    expect(service.sent).toHaveLength(1)
    expect(service.sent[0]).toEqual({
      target: { accountId: 'acc-1', conversationId: 'p2p:u1' },
      content: { type: 'text', text: '回复正文' },
      replyToMessageId: undefined,
    })
  })

  it('skips messages that do not qualify without touching the provider', async () => {
    await deliverRoomMessage(
      { providerId: 'wechat', registry, logger },
      payload('conv:internal-1', 'agent:alice'),
    )
    await deliverRoomMessage(
      { providerId: 'wechat', registry, logger },
      payload('chan:wechat:acc-1:p2p:u1', 'human:owner'),
    )
    expect(service.sent).toHaveLength(0)
  })

  it('warns instead of throwing when the send fails', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    service.failWith = new Error('channel closed')
    await expect(deliverRoomMessage(
      { providerId: 'wechat', registry, logger },
      payload('chan:wechat:acc-1:p2p:u1', 'agent:alice'),
    )).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledOnce()
    expect(warn.mock.calls[0]?.[0]).toContain('channel closed')
  })

  it('warns instead of throwing when the provider is not registered', async () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    const empty = new ImRegistry(new Context())
    await expect(deliverRoomMessage(
      { providerId: 'wechat', registry: empty, logger },
      payload('chan:wechat:acc-1:p2p:u1', 'agent:alice'),
    )).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledOnce()
  })
})
