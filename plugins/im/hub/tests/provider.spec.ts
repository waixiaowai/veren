import { afterAll, describe, expect, it } from 'vitest'
import { createServer } from 'node:http'
import type { ImMessage } from '@veren/im'
import { HubProvider } from '../src/provider.ts'
import type { HubCursorStore } from '../src/store.ts'

/**
 * The hub-device provider against a fake hub HTTP server: emit, cursor
 * persistence, fresh-device tail skip, and reply posting — the four behaviors
 * the live node depends on.
 * 假 hub HTTP 服务下的 hub 设备 provider：投递、游标持久化、新设备队尾跳过与回复
 * POST——真机依赖的四个行为。
 */

/** In-memory cursor. */
class MemoryCursor implements HubCursorStore {
  private readonly values = new Map<string, number>()
  after(device: string): number {
    return this.values.get(device) ?? 0
  }

  async save(device: string, after: number): Promise<void> {
    this.values.set(device, after)
  }
}

/** The fake hub: scripted poll responses plus a recorded replies log. */
async function fakeHub(handlers: {
  onPoll?: (after: number) => { messages: Array<Record<string, unknown>>; tail: number }
  onReply?: (body: Record<string, unknown>) => void
}): Promise<{ url: string; close: () => Promise<void>; replies: Array<Record<string, unknown>> }> {
  const replies: Array<Record<string, unknown>> = []
  const server = createServer((request, response) => {
    if (request.method === 'POST' && request.url === '/hub/replies') {
      const chunks: Buffer[] = []
      request.on('data', chunk => chunks.push(chunk as Buffer))
      request.on('end', () => {
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
        replies.push(body)
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end('{"ok":true}')
      })
      return
    }
    const url = new URL(request.url ?? '/', 'http://localhost')
    const after = Number(url.searchParams.get('after') ?? '0')
    const scripted = handlers.onPoll?.(after) ?? { messages: [], tail: 0 }
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify(scripted))
  })
  const port = await new Promise<number>(resolve => {
    server.listen(0, '127.0.0.1', () => resolve((server.address() as { port: number }).port))
  })
  return {
    url: `http://127.0.0.1:${port}`,
    replies,
    close: () => new Promise(resolve => server.close(() => resolve())),
  }
}

/** One provider wired to a fake hub. */
function makeProvider(hubUrl: string, cursor: HubCursorStore): HubProvider {
  return new HubProvider({
    hubBaseUrl: hubUrl,
    deviceToken: 'secret',
    deviceId: 'main',
    logger: { warn() {}, info() {}, error() {} } as never,
    cursor,
  })
}

/** Wait until the predicate holds or the budget runs out. */
async function until(predicate: () => boolean): Promise<void> {
  for (let waited = 0; waited < 100; waited += 1) {
    if (predicate()) return
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('condition not reached')
}

let stopServer: (() => Promise<void>) | undefined
afterAll(async () => { await stopServer?.() })

describe('HubProvider', () => {
  it('emits polled messages and advances the cursor per batch', async () => {
    // 设备注册后才到第一条消息：空日志（tail=0）不触发跳队尾。
    // The first message arrives after registration: an empty log (tail=0) does not trigger the tail skip.
    let served = 0
    const hub = await fakeHub({
      onPoll: after => {
        if (after === 0 && served === 0) {
          served += 1
          return { messages: [], tail: 0 }
        }
        return after < 1
          ? { messages: [{ seq: 1, id: 'm1', conversationId: 'p2p:human', sender: 'human@im.wechat', text: '你好', sentAt: Date.now() }], tail: 1 }
          : { messages: [], tail: 1 }
      },
    })
    stopServer = hub.close
    const cursor = new MemoryCursor()
    const hubProvider = makeProvider(hub.url, cursor)
    const received: ImMessage[] = []
    const unlisten = hubProvider.listen(message => { received.push(message) })
    await until(() => cursor.after('main') === 1)
    await until(() => received.length === 1)
    expect(received[0]).toMatchObject({ id: 'm1', conversationId: 'p2p:human' })
    unlisten()
    hubProvider.stop()
  })

  it('skips history on a fresh device (cursor=0 jumps to the hub tail)', async () => {
    const hub = await fakeHub({
      onPoll: after => after < 9
        ? { messages: [{ seq: 9, id: 'old', conversationId: 'p2p:human', sender: 's', text: '历史', sentAt: 1 }], tail: 9 }
        : { messages: [], tail: 9 },
    })
    stopServer = hub.close
    const cursor = new MemoryCursor()
    const hubProvider = makeProvider(hub.url, cursor)
    const received: ImMessage[] = []
    const unlisten = hubProvider.listen(message => { received.push(message) })
    await until(() => cursor.after('main') === 9)
    expect(received.length).toBe(0)
    unlisten()
    hubProvider.stop()
  })

  it('posts replies to the hub with the conversation and text', async () => {
    const hub = await fakeHub({})
    stopServer = hub.close
    const hubProvider = makeProvider(hub.url, new MemoryCursor())

    await hubProvider.send({
      target: { accountId: 'hub', conversationId: 'p2p:human' },
      content: { type: 'text', text: '回答' },
    })

    expect(hub.replies.length).toBe(1)
    expect(hub.replies[0]).toMatchObject({ conversationId: 'p2p:human', text: '回答' })
  })

  it('refuses bind: authorization lives on the cloud hub', async () => {
    const hub = await fakeHub({})
    stopServer = hub.close
    const hubProvider = makeProvider(hub.url, new MemoryCursor())

    await expect(hubProvider.bind({ method: 'qrcode' })).rejects.toThrow('cloud hub')
  })
})
