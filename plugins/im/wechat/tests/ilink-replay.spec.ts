/**
 * iLink send-face replay against the recorded corpus (L2, TS side).
 *
 * The same JSONL backs the Go suite in `cms/internal/imhub`: the corpus is the
 * contract, and each client's classifier is pinned to its own expected column.
 * The sendmessage -14 row is intentionally divergent — Go maps it to
 * auth-required, the TS control group maps it to IM_SEND_REJECTED — and this
 * suite records that difference instead of hiding it.
 *
 * iLink 发送面录制语料回放（L2，TS 侧）。同一份 JSONL 支撑 Go 侧套件：语料即契约，
 * 每个客户端按其 expect 列钉死。sendmessage -14 一行故意分歧——Go 归登录失效，
 * TS 对照组归投递拒绝——本套件把差异钉住，而不是藏起来。
 */

import { describe, expect, it } from 'vitest'
import { WechatApi } from '../src/api.ts'
import { assertWireShape, corpusCase, loadCorpus, recordedResponse } from './ilink-corpus.ts'

const cases = loadCorpus()

/** One api over a fetch that returns the recorded response and captures the request. */
function replayed(item: Parameters<typeof recordedResponse>[0]) {
  let captured: RequestInit | undefined
  const api = new WechatApi({
    baseUrl: 'https://ilinkai.weixin.qq.com/',
    fetchImpl: async (_input, init) => {
      captured = init
      return recordedResponse(item)
    },
  })
  return { api, request: () => {
    if (captured === undefined) throw new Error(`${item.id}: no request captured`)
    return captured
  } }
}

describe('recorded iLink corpus', () => {
  it('is readable and covers the success and rejection branches', () => {
    expect(cases.length).toBeGreaterThanOrEqual(6)
    const ids = cases.map(item => item.id)
    expect(ids).toContain('sendmessage-ok')
    expect(ids).toContain('sendmessage-ret-14')
    expect(ids).toContain('sendmessage-ret-3')
  })

  it('sendmessage-ok: success, and the generated frame matches the recorded shape', async () => {
    const item = corpusCase(cases, 'sendmessage-ok')
    const { api, request } = replayed(item)
    const result = await api.sendText('token-1', 'user-1', 'hi', 'ctx-1')
    expect(result.id).toContain('im-wechat-')
    assertWireShape(item, request())
  })

  it('sendmessage-ok-4102: upstream tolerated 4102, the client still pins 132102', async () => {
    const item = corpusCase(cases, 'sendmessage-ok-4102')
    const { api, request } = replayed(item)
    await expect(api.sendText('token-1', 'user-1', 'hi', 'ctx-1')).resolves.toBeTruthy()
    assertWireShape(item, request())
  })

  it('sendmessage-ret-14: the TS control group reports IM_SEND_REJECTED with providerCode -14', async () => {
    const item = corpusCase(cases, 'sendmessage-ret-14')
    const { api, request } = replayed(item)
    await expect(api.sendText('token-1', 'user-1', 'hi', 'ctx-1')).rejects.toMatchObject({
      code: 'IM_SEND_REJECTED',
      providerCode: '-14',
    })
    assertWireShape(item, request())
  })

  it('sendmessage-ret-3: unresolvable recipient is a delivery rejection, not an auth failure', async () => {
    const item = corpusCase(cases, 'sendmessage-ret-3')
    const { api, request } = replayed(item)
    await expect(api.sendText('token-1', 'user-1', 'hi', 'ctx-1')).rejects.toMatchObject({
      code: 'IM_SEND_REJECTED',
      providerCode: '-3',
    })
    assertWireShape(item, request())
  })

  it('notifystart-ok: opens the message session', async () => {
    const item = corpusCase(cases, 'notifystart-ok')
    const { api, request } = replayed(item)
    await expect(api.notifyStart('token-1')).resolves.toBeUndefined()
    assertWireShape(item, request())
  })

  it('notifystart-ret-14: a stale login is IM_AUTH_REQUIRED', async () => {
    const item = corpusCase(cases, 'notifystart-ret-14')
    const { api, request } = replayed(item)
    await expect(api.notifyStart('token-1')).rejects.toMatchObject({
      code: 'IM_AUTH_REQUIRED',
      providerCode: '-14',
    })
    assertWireShape(item, request())
  })
})
