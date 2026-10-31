import { describe, expect, it } from 'vitest'
import type { ImMessage } from '@veren/im'
import { WechatApi } from '../src/api.ts'
import {
  hangUntilAbort, jsonResponse, mockFetch, seedAccount, setupProvider, until,
} from './support.ts'

describe('WeChat inbound', () => {
  it('deduplicates by message_id, ignores own echo, and caches context_token in the domain', async () => {
    let updates = 0
    const { provider, store, secrets } = await setupProvider((url, init) => {
      if (url.pathname.endsWith('/notifystart')) return jsonResponse({ ret: 0 })
      if (url.pathname.endsWith('/notifystop')) return jsonResponse({ ret: 0 })
      if (url.pathname.endsWith('/sendmessage')) return jsonResponse({ ret: 0 })
      if (url.pathname.endsWith('/getupdates')) {
        updates += 1
        if (updates > 1) return hangUntilAbort(init)
        return jsonResponse({
          ret: 0,
          msgs: [
            {
              message_id: 'm1',
              from_user_id: 'user-1',
              message_type: 1,
              create_time_ms: 1_000,
              context_token: 'ctx-new',
              item_list: [{ type: 1, text_item: { text: 'hello' } }],
            },
            {
              message_id: 'm1',
              from_user_id: 'user-1',
              message_type: 1,
              item_list: [{ type: 1, text_item: { text: 'hello' } }],
            },
            {
              message_id: 'm2',
              from_user_id: 'user-1',
              message_type: 2,
              item_list: [{ type: 1, text_item: { text: 'echo' } }],
            },
          ],
          get_updates_buf: 'cursor-2',
        })
      }
      return jsonResponse({})
    })
    await seedAccount(store, secrets)
    const received: ImMessage[] = []
    provider.listen(message => { received.push(message) })
    await provider.start()
    await until(() => received.length > 0)
    expect(received).toHaveLength(1)
    expect(received[0]).toMatchObject({
      id: 'm1',
      accountId: 'acc-1',
      conversationId: 'p2p:user-1',
      content: { type: 'text', text: 'hello' },
    })
    await until(() => store.contextToken('acc-1', 'user-1') === 'ctx-new')
    const state = store.states().find(candidate => candidate.accountId === 'acc-1')
    expect(state?.seen).toContain('m1')
    expect(state?.cursor).toBe('cursor-2')
    await provider.stop()
  })
})

describe('WeChat connection errors', () => {
  it('maps -14 to a fatal runtime and stops after the first poll', async () => {
    let updates = 0
    const { provider, store, secrets } = await setupProvider((url) => {
      if (url.pathname.endsWith('/notifystart')) return jsonResponse({ ret: 0 })
      if (url.pathname.endsWith('/notifystop')) return jsonResponse({ ret: 0 })
      if (url.pathname.endsWith('/getupdates')) {
        updates += 1
        return jsonResponse({ ret: -14 })
      }
      return jsonResponse({ ret: 0 })
    })
    await seedAccount(store, secrets)
    await provider.start()
    await until(async () => (await provider.accounts())[0]?.status === 'error')
    await provider.stop()
    expect(updates).toBe(1)
  })

  it('treats a long-poll timeout as an empty batch', async () => {
    const api = new WechatApi({
      fetchImpl: mockFetch((_url, init) => hangUntilAbort(init)),
      longPollTimeoutMs: 20,
    })
    await expect(api.getUpdates('token-1', 'cursor-1')).resolves.toEqual({ messages: [], cursor: 'cursor-1' })
  })
})
