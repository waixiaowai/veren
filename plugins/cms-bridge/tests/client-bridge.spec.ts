/**
 * The cms-bridge browser data plane.
 *
 * These specs drive the half that runs in the page: same-origin fetches for the
 * node identity, icon upload, and credential rotation, plus the status store
 * that turns one snapshot fetch and an SSE stream into a `HostObservable`.
 * `fetch` and `EventSource` are the only stubs; every code path under test is
 * the shipped one.
 *
 * cms-bridge 的浏览器数据面。
 *
 * 这些测试驱动运行在页面里的半边：节点身份、图标上传、凭证轮换的同源请求，以及把一次快照
 * 读取与 SSE 事件流变成 `HostObservable` 的状态存储。只有 `fetch` 与 `EventSource` 是桩，
 * 被测的每条路径都是交付代码。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createStatusStore,
  fetchIdentity,
  rotateCredential,
  saveIdentity,
  uploadIconImage,
} from '../src/client/bridge.ts'
import type { BridgeStatus, NodeIdentity } from '../src/client/bridge.ts'

/** One runtime status snapshot. 一份运行时状态快照。 */
function status(over: Partial<BridgeStatus> = {}): BridgeStatus {
  return {
    state: 'connected',
    deviceId: 'device-1',
    credentialFingerprint: null,
    reconnectAttempts: 0,
    lastError: null,
    connectedAt: 1,
    pendingEvents: 0,
    inflightCommands: 0,
    node: { nodeId: 'n1', nodeName: 'Node', nodeDescription: '', nodeIcon: '' },
    ...over,
  }
}

/** One node identity. 一份节点身份。 */
function identity(over: Partial<NodeIdentity> = {}): NodeIdentity {
  return { nodeId: 'n1', nodeName: 'Node', nodeDescription: 'About', nodeIcon: '', ...over }
}

/** A minimal Response stand-in; only the fields the data plane reads are set. 只设置数据面读取字段的最小 Response。 */
function respond(body: unknown, over: { ok?: boolean, status?: number } = {}): Response {
  return {
    ok: over.ok ?? true,
    status: over.status ?? 200,
    json: async () => body,
  } as unknown as Response
}

/** A Response whose body is not JSON. 响应体不是 JSON 的 Response。 */
function unreadable(): Response {
  return {
    ok: false,
    status: 500,
    json: async () => { throw new Error('not json') },
  } as unknown as Response
}

/** Stub fetch with one response (or rejection) per call. 按调用次数替换 fetch。 */
function stubFetch(...responses: Array<Response | Error>): ReturnType<typeof vi.fn> {
  const mock = vi.fn()
  for (const response of responses) {
    if (response instanceof Error) mock.mockRejectedValueOnce(response)
    else mock.mockResolvedValueOnce(response)
  }
  vi.stubGlobal('fetch', mock)
  return mock
}

/** The page's EventSource, recorded instead of opened. 记录而非真正打开的页面 EventSource。 */
class FakeEventSource {
  static readonly instances: FakeEventSource[] = []
  onmessage: ((event: { data: string }) => void) | undefined
  onerror: (() => void) | undefined
  closed = false
  constructor(readonly url: string) { FakeEventSource.instances.push(this) }
  close(): void { this.closed = true }
}

/** Let the snapshot fetch's promise chain settle. 让快照请求链落定。 */
function flush(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}

beforeEach(() => {
  FakeEventSource.instances.length = 0
  vi.stubGlobal('EventSource', FakeEventSource)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('cms-bridge identity requests / 节点身份请求', () => {
  it('reads the identity from the node proxy', async () => {
    const fetchMock = stubFetch(respond({ identity: identity() }))
    await expect(fetchIdentity()).resolves.toEqual(identity())
    expect(fetchMock).toHaveBeenCalledWith('/cms-bridge/api/identity')
  })

  it('fails loudly on an HTTP error or a body without identity', async () => {
    stubFetch(respond({}, { ok: false, status: 503 }))
    await expect(fetchIdentity()).rejects.toThrow('HTTP 503')

    stubFetch(respond({}))
    await expect(fetchIdentity()).rejects.toThrow('no identity in response')
  })

  it('posts the identity and reports the Host message on refusal', async () => {
    const fetchMock = stubFetch(respond({}))
    await saveIdentity(identity())
    expect(fetchMock).toHaveBeenCalledWith('/cms-bridge/api/identity', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(identity()),
    })

    stubFetch(respond({ message: 'invalid icon' }, { ok: false, status: 400 }))
    await expect(saveIdentity(identity())).rejects.toThrow('invalid icon')

    stubFetch(unreadable())
    await expect(saveIdentity(identity())).rejects.toThrow('HTTP 500')
  })
})

describe('cms-bridge uploads and credentials / 上传与凭证', () => {
  it('uploads the icon with the cms purpose fields and returns the public url', async () => {
    const fetchMock = stubFetch(respond({ url: 'https://cas.example/icon' }))
    await expect(uploadIconImage(new Blob(['icon']) as File)).resolves.toBe('https://cas.example/icon')

    const body = fetchMock.mock.calls[0]?.[1]?.body as FormData
    expect(body.get('purpose')).toBe('user_data')
    expect(body.get('is_public')).toBe('true')
    expect(body.get('file')).toBeInstanceOf(Blob)
  })

  it('rejects an upload without a url and one the Host refuses', async () => {
    stubFetch(respond({}))
    await expect(uploadIconImage(new Blob(['icon']) as File)).rejects.toThrow('no url in response')

    stubFetch(respond({ message: 'file too large' }, { ok: false, status: 413 }))
    await expect(uploadIconImage(new Blob(['icon']) as File)).rejects.toThrow('file too large')
  })

  it('rotates the credential and surfaces the refusal message', async () => {
    const fetchMock = stubFetch(respond({}))
    await rotateCredential('secret')
    expect(fetchMock).toHaveBeenCalledWith('/cms-bridge/api/credential', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'secret' }),
    })

    stubFetch(respond({ message: 'token rejected' }, { ok: false, status: 401 }))
    await expect(rotateCredential('secret')).rejects.toThrow('token rejected')
  })
})

describe('cms-bridge status store / 状态可观察对象', () => {
  it('takes one snapshot and opens one event stream no matter how often start runs', async () => {
    const fetchMock = stubFetch(respond(status()))
    const store = createStatusStore()
    store.start()
    store.start()
    await flush()

    expect(fetchMock).toHaveBeenCalledWith('/cms-bridge/api/status', { signal: undefined })
    expect(fakeStreams()).toHaveLength(1)
    expect(fakeStreams()[0]?.url).toBe('/cms-bridge/api/events')
    expect(store.getSnapshot()).toEqual({ status: status(), error: null })
  })

  it('applies pushed events and reports an interrupted stream without dropping the status', async () => {
    stubFetch(respond(status()))
    const store = createStatusStore()
    const listener = vi.fn()
    store.subscribe(listener)
    store.start()
    await flush()

    const stream = fakeStreams()[0]
    stream?.onmessage?.({ data: JSON.stringify(status({ pendingEvents: 3 })) })
    expect(store.getSnapshot().status).toMatchObject({ pendingEvents: 3 })
    expect(listener).toHaveBeenCalled()

    stream?.onerror?.()
    expect(store.getSnapshot()).toMatchObject({
      status: { pendingEvents: 3 },
      error: 'event stream interrupted; retrying',
    })
  })

  it('reports a failed snapshot fetch while still opening the event stream', async () => {
    stubFetch(respond({}, { ok: false, status: 503 }))
    const store = createStatusStore()
    store.start()
    await flush()

    expect(store.getSnapshot()).toEqual({ status: null, error: 'HTTP 503' })
    expect(fakeStreams()).toHaveLength(1)
  })

  it('closes the stream on stop and reopens a fresh one on restart', async () => {
    stubFetch(respond(status()), respond(status()))
    const store = createStatusStore()
    store.start()
    await flush()

    store.stop()
    expect(fakeStreams()[0]?.closed).toBe(true)

    store.start()
    expect(fakeStreams()).toHaveLength(2)
  })

  it('stops notifying a subscriber that left', async () => {
    stubFetch(respond(status()))
    const store = createStatusStore()
    const listener = vi.fn()
    const off = store.subscribe(listener)
    store.start()
    await flush()

    const before = listener.mock.calls.length
    off()
    fakeStreams()[0]?.onmessage?.({ data: JSON.stringify(status({ pendingEvents: 9 })) })

    expect(listener).toHaveBeenCalledTimes(before)
    expect(store.getSnapshot().status).toMatchObject({ pendingEvents: 9 })
  })
})

/** The streams the store opened, in order. 状态存储按顺序打开的流。 */
function fakeStreams(): FakeEventSource[] {
  return FakeEventSource.instances
}
