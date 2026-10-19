/**
 * Reusable provider conformance suite.
 *
 * The suite is protocol-agnostic: a provider supplies a driver that can emit an
 * inbound message and confirm a pending bind. Every case asserts one clause of
 * the @veren/im contract, so a new channel can be compared against the same
 * behavior the fake provider already proves.
 *
 * 可复用的 provider 契约测试套件。
 *
 * 套件与具体协议无关：provider 提供驱动，用来注入入站消息并确认待完成的绑定。每个用例断言
 * @veren/im 契约的一条行为，新渠道因此可以和假 provider 已经证明的行为逐条对照。
 *
 * @module @veren/im-testkit/conformance
 */

import { beforeEach, describe, expect, it } from 'vitest'
import type { ImAccount, ImMessage, ImProvider, ImSendRequest } from '@veren/im'

/** Test driver a provider supplies to the conformance suite. */
export interface ImConformanceTarget {
  provider: ImProvider
  /** Recorded sends, in order. */
  sent: readonly ImSendRequest[]
  /** Emit one inbound message; returns false when deduplicated. */
  emit(message: ImMessage): boolean | Promise<boolean>
  /** Confirm the pending bind attempt and return the bound account. */
  confirmBind(account?: Partial<ImAccount>): ImAccount | Promise<ImAccount>
}

/** Conformance options. */
export interface ImConformanceOptions {
  /** Suite name, usually the provider id. */
  name: string
  /** Build a fresh driver for each case. */
  create(): ImConformanceTarget | Promise<ImConformanceTarget>
}

const ACCOUNT: ImAccount = {
  id: 'acc-1',
  displayName: 'Conformance Account',
  status: 'online',
}

/** One inbound message for the fixed test account. */
function message(id: string, text = 'hello'): ImMessage {
  return {
    id,
    accountId: ACCOUNT.id,
    conversationId: 'p2p:user-1',
    sender: { id: 'user-1' },
    sentAt: 1_700_000_000_000,
    content: { type: 'text', text },
  }
}

/**
 * Declare the shared conformance cases.
 * @param options - suite name and driver factory.
 */
export function defineImConformance(options: ImConformanceOptions): void {
  describe(`${options.name} conformance`, () => {
    let target: ImConformanceTarget

    beforeEach(async () => {
      target = await options.create()
      await target.provider.service.start()
    })

    it('lists stable accounts after authorization', async () => {
      await target.provider.service.bind({ method: 'qrcode' })
      const account = await target.confirmBind(ACCOUNT)
      const first = await target.provider.service.accounts()
      const second = await target.provider.service.accounts()
      expect(first.map(item => item.id)).toContain(account.id)
      expect(second.map(item => item.id)).toEqual(first.map(item => item.id))
    })

    it('delivers one inbound message once', async () => {
      const delivered: ImMessage[] = []
      target.provider.service.listen(item => { delivered.push(item) })
      expect(await target.emit(message('m-1'))).toBe(true)
      expect(await target.emit(message('m-1'))).toBe(false)
      expect(delivered).toHaveLength(1)
      expect(delivered[0]?.id).toBe('m-1')
    })

    it('walks pending -> bound and resolves waiters', async () => {
      const attempt = await target.provider.service.bind({ method: 'qrcode' })
      expect(attempt.status).toBe('pending')
      expect(attempt.challenge?.kind).toBe('qrcode')
      const account = await target.confirmBind(ACCOUNT)
      expect(attempt.status).toBe('bound')
      await expect(attempt.wait()).resolves.toMatchObject({ id: account.id })
    })

    it('cancels an authorization attempt', async () => {
      const attempt = await target.provider.service.bind({ method: 'qrcode' })
      await attempt.cancel()
      expect(attempt.status).toBe('expired')
    })

    it('honors the explicit target and segments long text', async () => {
      const limit = target.provider.features.limits.textChars ?? 1800
      const text = 'x'.repeat(limit * 2 + 5)
      const result = await target.provider.service.send({
        target: { accountId: ACCOUNT.id, conversationId: 'p2p:user-1' },
        content: { type: 'text', text },
      })
      expect(result.id).toBeTruthy()
      const sent = target.sent.filter(item => item.target.accountId === ACCOUNT.id)
      expect(sent.length).toBeGreaterThan(1)
      expect(sent.every(item => item.target.conversationId === 'p2p:user-1')).toBe(true)
      expect(sent.map(item => item.content.type === 'text' ? item.content.text : '').join('')).toBe(text)
      for (const item of sent) {
        if (item.content.type === 'text') expect(item.content.text.length).toBeLessThanOrEqual(limit)
      }
    })

    it('stops delivery after the listener disposer runs', async () => {
      const delivered: ImMessage[] = []
      const dispose = target.provider.service.listen(item => { delivered.push(item) })
      dispose()
      await target.emit(message('m-2'))
      expect(delivered).toHaveLength(0)
    })
  })
}
