import { readFile, rm } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import type { ImMessage } from '@veren/im'
import { WechatApi } from '../src/api.ts'
import { WEIXIN_FEATURES, WechatProvider, splitText } from '../src/provider.ts'
import {
  MemorySecrets, MemoryWechatStore, bodyOf, hangUntilAbort, jsonResponse, mockFetch, seedAccount,
  seedContext, testLogger, until,
} from './support.ts'
import type { FetchHandler } from './support.ts'

const qrImages: string[] = []

afterEach(async () => {
  for (const path of qrImages.splice(0)) await rm(path, { force: true })
})

async function setup(handler: FetchHandler, options: { longPollTimeoutMs?: number } = {}) {
  const store = new MemoryWechatStore()
  const secrets = new MemorySecrets()
  const provider = new WechatProvider({
    store,
    secrets,
    fetchImpl: mockFetch(handler),
    longPollTimeoutMs: options.longPollTimeoutMs ?? 20,
    pollIntervalMs: 5,
    qrTtlMs: 60_000,
    logger: testLogger(),
  })
  return { provider, store, secrets }
}

describe('WeChat QR authorization', () => {
  it('writes a local PNG, polls to confirmed, and stores state in the domain without the token', async () => {
    let polls = 0
    let updates = 0
    const { provider, store, secrets } = await setup((url, init) => {
      if (url.pathname.endsWith('/get_bot_qrcode')) {
        return jsonResponse({ qrcode: 'qr-1', qrcode_img_content: 'https://ilinkai.weixin.qq.com/qr' })
      }
      if (url.pathname.endsWith('/get_qrcode_status')) {
        polls += 1
        return jsonResponse(polls === 1 ? { status: 'wait' } : {
          status: 'confirmed',
          bot_token: 'token-1',
          ilink_bot_id: 'acc-1',
          ilink_user_id: 'owner-1',
          baseurl: 'https://ilinkai.weixin.qq.com/',
        })
      }
      if (url.pathname.endsWith('/notifystart')) return jsonResponse({ ret: 0 })
      if (url.pathname.endsWith('/getupdates')) {
        updates += 1
        return updates === 1
          ? jsonResponse({ ret: 0, msgs: [], get_updates_buf: 'cursor-1' })
          : hangUntilAbort(init)
      }
      if (url.pathname.endsWith('/notifystop')) return jsonResponse({ ret: 0 })
      return jsonResponse({})
    })

    const attempt = await provider.bind({ method: 'qrcode' })
    expect(attempt.status).toBe('pending')
    const imagePath = attempt.challenge?.imagePath
    expect(imagePath).toBeTruthy()
    qrImages.push(imagePath as string)
    const png = await readFile(imagePath as string)
    expect(png.subarray(1, 4).toString('ascii')).toBe('PNG')
    expect(attempt.challenge?.url).toBeUndefined()

    const account = await attempt.wait()
    expect(account.id).toBe('acc-1')
    expect(attempt.status).toBe('bound')
    const stored = await secrets.read('acc-1')
    expect(stored?.token).toBe('token-1')

    const state = store.states().find(candidate => candidate.accountId === 'acc-1')
    expect(state?.displayName).toBe('WeChat acc-1')
    expect(JSON.stringify(state)).not.toContain('token-1')
    expect(JSON.stringify(state)).not.toContain('context_token')

    await provider.stop()
  })
})

describe('WeChat sending', () => {
  it('segments at 1,800 code units and reuses the cached context_token', async () => {
    const bodies: Record<string, unknown>[] = []
    const { provider, store, secrets } = await setup((url, init) => {
      if (url.pathname.endsWith('/notifystart')) return jsonResponse({ ret: 0 })
      if (url.pathname.endsWith('/getupdates')) return hangUntilAbort(init)
      if (url.pathname.endsWith('/notifystop')) return jsonResponse({ ret: 0 })
      if (url.pathname.endsWith('/sendmessage')) {
        bodies.push(bodyOf(init))
        return jsonResponse({ ret: 0 })
      }
      return jsonResponse({})
    })
    await seedAccount(store, secrets)
    await seedContext(store, 'acc-1', 'user-1', 'ctx-1')
    await provider.start()

    const text = 'x'.repeat(4_000)
    await provider.send({
      target: { accountId: 'acc-1', conversationId: 'p2p:user-1' },
      content: { type: 'text', text },
    })

    expect(bodies).toHaveLength(3)
    expect(bodies.map(body => bodyLength(body))).toEqual([1_800, 1_800, 400])
    for (const body of bodies) {
      const msg = body.msg as Record<string, unknown>
      expect(msg.to_user_id).toBe('user-1')
      expect(msg.context_token).toBe('ctx-1')
      expect(msg.message_type).toBe(2)
    }
    await provider.stop()
  })

  it('rejects ret=-2 once as IM_SEND_REJECTED and does not retry', async () => {
    let sendCalls = 0
    const { provider, store, secrets } = await setup((url, init) => {
      if (url.pathname.endsWith('/notifystart')) return jsonResponse({ ret: 0 })
      if (url.pathname.endsWith('/getupdates')) return hangUntilAbort(init)
      if (url.pathname.endsWith('/notifystop')) return jsonResponse({ ret: 0 })
      if (url.pathname.endsWith('/sendmessage')) {
        sendCalls += 1
        return jsonResponse({ ret: -2 })
      }
      return jsonResponse({})
    })
    await seedAccount(store, secrets)
    await provider.start()
    await expect(provider.send({
      target: { accountId: 'acc-1', conversationId: 'p2p:user-1' },
      content: { type: 'text', text: 'hi' },
    })).rejects.toMatchObject({ code: 'IM_SEND_REJECTED', providerCode: '-2' })
    expect(sendCalls).toBe(1)
    await provider.stop()
  })

  it('rejects image and file content in V1', async () => {
    const { provider, store, secrets } = await setup((url, init) => {
      if (url.pathname.endsWith('/notifystart')) return jsonResponse({ ret: 0 })
      if (url.pathname.endsWith('/getupdates')) return hangUntilAbort(init)
      if (url.pathname.endsWith('/notifystop')) return jsonResponse({ ret: 0 })
      return jsonResponse({})
    })
    await seedAccount(store, secrets)
    await provider.start()
    await expect(provider.send({
      target: { accountId: 'acc-1', conversationId: 'p2p:user-1' },
      content: { type: 'file', mime: 'text/plain', name: 'a.txt', load: async () => Buffer.from('a') },
    })).rejects.toMatchObject({ code: 'IM_UNSUPPORTED' })
    await provider.stop()
  })
})

describe('WeChat inbound', () => {
  it('deduplicates by message_id, ignores own echo, and caches context_token in the domain', async () => {
    let updates = 0
    const { provider, store, secrets } = await setup((url, init) => {
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
    const { provider, store, secrets } = await setup((url) => {
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

describe('WeChat lifecycle', () => {
  it('fails start with a structured error when the storage domain is unavailable', async () => {
    const { provider, store } = await setup((url) => {
      if (url.pathname.endsWith('/notifystop')) return jsonResponse({ ret: 0 })
      return jsonResponse({ ret: 0 })
    })
    store.break('domain im_wechat is closed')
    await expect(provider.start()).rejects.toMatchObject({
      code: 'IM_INTERNAL',
      message: expect.stringContaining('domain im_wechat is closed'),
    })
  })

  it('does not start monitors when stop lands during start', async () => {
    let updates = 0
    const { provider, store, secrets } = await setup((url) => {
      if (url.pathname.endsWith('/notifystop')) return jsonResponse({ ret: 0 })
      if (url.pathname.endsWith('/getupdates')) updates += 1
      return jsonResponse({ ret: 0 })
    })
    await seedAccount(store, secrets)
    const starting = provider.start()
    await provider.stop()
    await starting
    expect(await provider.accounts()).toHaveLength(0)
    // Give any leaked monitor a chance to poll; it must never have started.
    // 给可能泄漏的 monitor 一次轮询机会；它绝不应启动过。
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(updates).toBe(0)
  })

  it('keeps other waiters settled when one waiter aborts', async () => {
    let confirm = false
    const { provider, store, secrets } = await setup((url, init) => {
      if (url.pathname.endsWith('/get_bot_qrcode')) {
        return jsonResponse({ qrcode: 'qr-1', qrcode_img_content: 'https://ilinkai.weixin.qq.com/qr' })
      }
      if (url.pathname.endsWith('/notifystart')) return jsonResponse({ ret: 0 })
      if (url.pathname.endsWith('/notifystop')) return jsonResponse({ ret: 0 })
      if (url.pathname.endsWith('/getupdates')) return hangUntilAbort(init)
      if (url.pathname.endsWith('/get_qrcode_status')) {
        return jsonResponse(confirm
          ? {
              status: 'confirmed',
              bot_token: 'token-1',
              ilink_bot_id: 'acc-x',
              ilink_user_id: 'owner-1',
              baseurl: 'https://ilinkai.weixin.qq.com/',
            }
          : { status: 'wait' })
      }
      return jsonResponse({})
    })
    await seedAccount(store, secrets)
    await provider.start()
    const attempt = await provider.bind({ method: 'qrcode' })
    const imagePath = attempt.challenge?.imagePath
    if (imagePath !== undefined) qrImages.push(imagePath)
    const controller = new AbortController()
    const aborted = attempt.wait(controller.signal)
    const kept = attempt.wait()
    controller.abort()
    await expect(aborted).rejects.toMatchObject({ code: 'IM_BIND_EXPIRED' })
    confirm = true
    await until(() => attempt.status === 'bound')
    await expect(kept).resolves.toMatchObject({ id: 'acc-x' })
    await provider.stop()
  })

  it('removes one account: monitor stopped, state and contexts deleted, others kept', async () => {
    const { provider, store, secrets } = await setup((url, init) => {
      if (url.pathname.endsWith('/notifystart')) return jsonResponse({ ret: 0 })
      if (url.pathname.endsWith('/notifystop')) return jsonResponse({ ret: 0 })
      if (url.pathname.endsWith('/getupdates')) return hangUntilAbort(init)
      return jsonResponse({})
    })
    await seedAccount(store, secrets)
    await seedContext(store, 'acc-1', 'user-1', 'ctx-1')
    await store.putState({
      accountId: 'acc-2',
      displayName: 'Second',
      ownerId: 'owner-2',
      baseUrl: 'https://ilinkai.weixin.qq.com/',
      cursor: '',
      seen: [],
    })
    await secrets.write('acc-2', { token: 'token-2' })
    await provider.start()
    expect((await provider.accounts()).map(account => account.id)).toEqual(['acc-1', 'acc-2'])

    await provider.removeAccount('acc-1')

    expect((await provider.accounts()).map(account => account.id)).toEqual(['acc-2'])
    expect(store.statesById.has('acc-1')).toBe(false)
    expect(store.contextToken('acc-1', 'user-1')).toBeUndefined()
    expect(store.statesById.get('acc-2')).toMatchObject({ accountId: 'acc-2' })
    await provider.stop()
  })
})

describe('real account', () => {
  const enabled = process.env.IM_WECHAT_REAL === '1'
  it.skipIf(!enabled)('runs only when IM_WECHAT_REAL=1', () => {
    expect(enabled).toBe(true)
  })
})

/** One sendmessage text length. */
function bodyLength(body: Record<string, unknown>): number {
  const msg = body.msg as { item_list?: Array<{ text_item?: { text?: string } }> } | undefined
  return msg?.item_list?.[0]?.text_item?.text?.length ?? 0
}

describe('splitText', () => {
  it('keeps the total text and respects the limit', () => {
    const text = 'a'.repeat(4_000)
    const chunks = splitText(text, 1_800)
    expect(chunks.join('')).toBe(text)
    expect(chunks.map(chunk => chunk.length)).toEqual([1_800, 1_800, 400])
    expect(WEIXIN_FEATURES.limits.textChars).toBe(1_800)
  })
})
