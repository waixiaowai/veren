/** The thin taskhub connection: registration, command dispatch, acked reports, offline FIFO replay, credential parking. */
/** 薄 taskhub 连接：注册、命令分发、回执确认、离线 FIFO 补报、凭证停泊。 */
import { describe, expect, it, vi } from 'vitest'
import { TaskhubConnection, type SocketLike } from '../src/infra/taskhub/connection.ts'

/** Scripted fake socket: the test drives server frames; client frames are recorded. */
class FakeSocket implements SocketLike {
  sent: string[] = []
  closed: number[] = []
  private handlers = {
    open: [] as (() => void)[], close: [] as ((code: number) => void)[],
    error: [] as ((err: Error) => void)[], message: [] as ((text: string) => void)[],
  }
  send(text: string): void { this.sent.push(text) }
  close(code?: number): void { this.closed.push(code ?? 0); for (const cb of this.handlers.close) cb(code ?? 0) }
  onOpen(cb: () => void): void { this.handlers.open.push(cb) }
  onClose(cb: (code: number) => void): void { this.handlers.close.push(cb) }
  onError(cb: (err: Error) => void): void { this.handlers.error.push(cb) }
  onMessage(cb: (text: string) => void): void { this.handlers.message.push(cb) }
  open(): void { for (const cb of this.handlers.open) cb() }
  server(text: string): void { for (const cb of this.handlers.message) cb(text) }
}

const HELLO = { nodeId: 'n1', title: '代码节点', description: '', tags: ['gitea'], maxConcurrent: 2 }

function start(socket: FakeSocket, onCommand?: (action: string, payload: unknown) => unknown) {
  const connection = new TaskhubConnection({
    url: 'wss://cms.test/v1/ws', token: 'key-1', hello: HELLO,
    onCommand: onCommand ?? (() => ({ accepted: true })),
    socketFactory: () => socket,
  })
  connection.connect()
  return connection
}

describe('taskhub connection', () => {
  it('reports node.identity and worker.hello on open, and heartbeats carry the running count', () => {
    vi.useFakeTimers()
    const socket = new FakeSocket()
    const connection = start(socket)
    socket.open()
    // 两段注册（契约 §2）：缺 node.identity 即恒 ErrWorkerOffline（双进程演练实锤）。
    const names = socket.sent.map(text => (JSON.parse(text) as { name?: string }).name)
    expect(names[0]).toBe('node.identity')
    expect(names[1]).toBe('taskhub.worker.hello')
    expect(JSON.parse(socket.sent[0]!)).toMatchObject({ payload: { nodeId: 'n1', nodeName: '代码节点' } })
    expect(JSON.parse(socket.sent[1]!)).toMatchObject({ type: 'event', name: 'taskhub.worker.hello', payload: HELLO })
    connection.setRunning(2)
    vi.advanceTimersByTime(61_000)
    const heartbeat = socket.sent.map(text => JSON.parse(text) as { name?: string }).find(frame => frame.name === 'taskhub.worker.heartbeat')
    expect(heartbeat).toMatchObject({ payload: { nodeId: 'n1', running: 2 } })
    vi.useRealTimers()
    connection.dispose()
  })

  it('answers a task.dispatch command with a result frame', async () => {
    const socket = new FakeSocket()
    const handler = vi.fn(() => ({ accepted: true }))
    const connection = start(socket, handler)
    socket.open()
    socket.server('{"type":"command","id":"wcmd_1","action":"task.dispatch","payload":{"taskId":"t1"}}')
    await vi.waitFor(() => expect(socket.sent.some(text => text.includes('"id":"wcmd_1"'))).toBe(true))
    const result = JSON.parse(socket.sent.find(text => text.includes('"wcmd_1"'))!) as { type: string; ok: boolean; result: { accepted: boolean } }
    expect(result).toMatchObject({ type: 'result', ok: true, result: { accepted: true } })
    expect(handler).toHaveBeenCalledWith('task.dispatch', { taskId: 't1' })
    connection.dispose()
  })

  it('reports fire-and-forget while connected (wsgw emits no event_ack)', async () => {
    const socket = new FakeSocket()
    const connection = start(socket)
    socket.open()
    // 契约 §1：event_ack 是可选帧且 wsgw 现状不发——上报在发送后即成功返回，
    // 不等确认（等待确认会在生产上 10s 超时炸进程，2026-11-02 实录）。
    const result = await connection.report('taskhub.task.reply', { taskId: 't1', messageId: 'm1', text: 'hi' })
    expect(result).toEqual({ delivered: true })
    expect(socket.sent.some(text => text.includes('taskhub.task.reply'))).toBe(true)
    connection.dispose()
  })

  it('reports delivered:false after dispose so the caller can retry', async () => {
    const socket = new FakeSocket()
    const connection = start(socket)
    connection.dispose()
    const result = await connection.report('taskhub.task.reply', { taskId: 't1' })
    expect(result).toEqual({ delivered: false })
  })

  it('replays queued events in order after reconnect', async () => {
    vi.useFakeTimers()
    const first = new FakeSocket()
    const second = new FakeSocket()
    const sockets = [first, second]
    const connection = new TaskhubConnection({
      url: 'wss://cms.test/v1/ws', token: 'key-1', hello: HELLO,
      onCommand: () => ({ accepted: true }),
      socketFactory: () => sockets.shift() ?? second,
    })
    connection.connect() // 第一条 socket，未 open 即断（离线）。
    const firstReport = connection.report('taskhub.task.reply', { messageId: 'm1' })
    const secondReport = connection.report('taskhub.task.result', { messageId: 'm2' })
    expect(first.sent).toEqual([]) // 离线入队，不发送。

    first.close(1006) // 非凭证断开：进入重连。
    expect(connection.bridgeState).toBe('reconnecting')
    await vi.advanceTimersByTimeAsync(1000) // 首次退避 1s → 工厂交出第二条。
    second.open()
    await vi.advanceTimersByTimeAsync(1) // 泵微任务：hello 与离线队列按序直发。
    expect(await firstReport).toEqual({ delivered: true })
    expect(await secondReport).toEqual({ delivered: true })
    const names = second.sent.map(text => (JSON.parse(text) as { name?: string }).name)
    expect(names).toContain('taskhub.worker.hello')
    expect(names.indexOf('taskhub.task.reply')).toBeLessThan(names.indexOf('taskhub.task.result'))
    vi.useRealTimers()
    connection.dispose()
  })

  it('parks on a credential close code without reconnecting', () => {
    vi.useFakeTimers()
    const socket = new FakeSocket()
    const connection = start(socket)
    socket.open()
    socket.close(4401)
    expect(connection.bridgeState).toBe('awaiting-credential')
    vi.advanceTimersByTime(120_000)
    expect(socket.closed.length).toBe(1) // 无重连尝试。
    vi.useRealTimers()
  })
})
