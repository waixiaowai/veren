/**
 * The page's source, against a fake Remote namespace.
 *
 * The refresh callback is what the header control narrates, so its outcome
 * contract (`ok` / `error` / `stale`) is pinned here rather than discovered in
 * the live GUI.
 *
 * 页面的 source，对照一个假的 Remote 命名空间。
 *
 * 刷新回调正是页头控件所自述的内容，因此它的结局契约（`ok` / `error` / `stale`）在这里被钉死，
 * 而不是留到真实 GUI 里才发现。
 */

import { describe, expect, it } from 'vitest'
import type { MailReadOutcome } from '../src/client/remote.ts'
import type { MailRemoteApi, MailRemoteResult, MessageView, RunView } from '../src/client/remote.ts'
import { createMailSource } from '../src/client/source.ts'

/** One catalog answer the test controls. / 测试可控制的一次目录应答。 */
type CatalogAnswer = MailRemoteResult<{ readonly messages: MessageView[]; readonly runs: RunView[] }>

/** A promise plus its settle functions. / 一个 promise 及其落定函数。 */
interface Deferred<Value> {
  readonly promise: Promise<Value>
  readonly resolve: (value: Value) => void
}

/**
 * Build a deferred answer.
 *
 * @returns the promise and its resolver / promise 与它的 resolve
 */
function deferred<Value>(): Deferred<Value> {
  let resolve!: (value: Value) => void
  const promise = new Promise<Value>((settle) => { resolve = settle })
  return { promise, resolve }
}

/** One successful, empty catalog answer. / 一次成功但为空的目录应答。 */
const EMPTY_OK: CatalogAnswer = { ok: true, value: { messages: [], runs: [] } }

/**
 * A Remote namespace whose catalog answers are scripted one by one.
 *
 * @param answers - the queued answers / 依次使用的应答
 * @returns the fake namespace and the requests it saw / 假命名空间与其收到的请求
 */
function fakeApi(answers: readonly Promise<CatalogAnswer>[]): {
  readonly api: MailRemoteApi
  readonly calls: () => number
} {
  let calls = 0
  const api: MailRemoteApi = {
    catalog: () => {
      const next = answers[calls] ?? Promise.resolve(EMPTY_OK)
      calls += 1
      return next
    },
    markMessage: () => Promise.resolve({ ok: true, value: {} }),
  }
  return { api, calls: () => calls }
}

describe('mail source refresh outcome', () => {
  it('reports ok and publishes the ready snapshot', async () => {
    const { api } = fakeApi([Promise.resolve(EMPTY_OK)])
    const source = createMailSource(api)
    await expect(source.refresh()).resolves.toBe('ok')
    expect(source.source.getSnapshot().status).toBe('ready')
    expect(source.source.getSnapshot().settled).toBe(true)
  })

  it('reports error when the host refuses', async () => {
    const refusal: CatalogAnswer = { ok: false, error: { code: 'MAIL_DOWN', message: 'gateway offline' } }
    const { api } = fakeApi([Promise.resolve(refusal)])
    const source = createMailSource(api)
    const outcome: MailReadOutcome = await source.refresh()
    expect(outcome).toBe('error')
    expect(source.source.getSnapshot().error).toBe('gateway offline')
  })

  it('reports error when the transport throws', async () => {
    const { api } = fakeApi([Promise.reject(new Error('socket closed'))])
    const source = createMailSource(api)
    await expect(source.refresh()).resolves.toBe('error')
    expect(source.source.getSnapshot().status).toBe('error')
  })

  it('reports stale for a superseded read and keeps the newer snapshot', async () => {
    const first = deferred<CatalogAnswer>()
    const second = deferred<CatalogAnswer>()
    const { api, calls } = fakeApi([first.promise, second.promise])
    const source = createMailSource(api)
    const older = source.refresh()
    const newer = source.refresh()
    second.resolve(EMPTY_OK)
    await expect(newer).resolves.toBe('ok')
    first.resolve(EMPTY_OK)
    await expect(older).resolves.toBe('stale')
    expect(calls()).toBe(2)
    expect(source.source.getSnapshot().settled).toBe(true)
  })
})
