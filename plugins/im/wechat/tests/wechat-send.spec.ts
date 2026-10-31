import { describe, expect, it } from 'vitest'
import { WEIXIN_FEATURES, splitText } from '../src/provider.ts'
import { bodyOf, hangUntilAbort, jsonResponse, seedAccount, seedContext, setupProvider } from './support.ts'

describe('WeChat sending', () => {
  it('segments at 1,800 code units and reuses the cached context_token', async () => {
    const bodies: Record<string, unknown>[] = []
    const { provider, store, secrets } = await setupProvider((url, init) => {
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
    const { provider, store, secrets } = await setupProvider((url, init) => {
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
    const { provider, store, secrets } = await setupProvider((url, init) => {
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

describe('splitText', () => {
  it('keeps the total text and respects the limit', () => {
    const text = 'a'.repeat(4_000)
    const chunks = splitText(text, 1_800)
    expect(chunks.join('')).toBe(text)
    expect(chunks.map(chunk => chunk.length)).toEqual([1_800, 1_800, 400])
    expect(WEIXIN_FEATURES.limits.textChars).toBe(1_800)
  })
})

/** One sendmessage text length. */
/** 一条 sendmessage 文本的长度。 */
function bodyLength(body: Record<string, unknown>): number {
  const msg = body.msg as { item_list?: Array<{ text_item?: { text?: string } }> } | undefined
  return msg?.item_list?.[0]?.text_item?.text?.length ?? 0
}
