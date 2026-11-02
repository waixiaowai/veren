/**
 * taskhub 薄 WS 客户端：连接与重连（指数退避）、凭证失效停泊、事件离线
 * FIFO 补报（event_ack 确认）、下行命令分发。零 Cordis 依赖——以同形协议
 * 直连 cms wsgw（@veren/cms-bridge 会装出第二份 cordis 实例，禁引入）。
 *
 * The thin taskhub WebSocket client: connect/reconnect with exponential
 * backoff, credential-failure parking, offline FIFO event replay with
 * event_ack, and command dispatching. No Cordis on purpose.
 */
import { randomUUID } from 'node:crypto'
import WebSocket from 'ws'
import {
  EVENT_WORKER_HEARTBEAT, EVENT_WORKER_HELLO,
  parseServerFrame, serializeClientFrame,
  type ClientFrame, type CommandFrame, type EventFrame, type ResultFrame, type WorkerHello,
} from './protocol.ts'

/** 节点视角的最小 socket 能力（测试可注入假 socket） */
export interface SocketLike {
  send(text: string): void
  close(code?: number): void
  onOpen(cb: () => void): void
  onClose(cb: (code: number) => void): void
  onError(cb: (err: Error) => void): void
  onMessage(cb: (text: string) => void): void
}

/** socket 工厂：按 url 与鉴权头建立连接（生产=ws 包；测试=假 socket） */
export type SocketFactory = (url: string, headers: Record<string, string>) => SocketLike

/** 连接状态机（对齐 cms-bridge 语义：停泊态不做无谓重连） */
export type BridgeState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'awaiting-credential' | 'disposed'

export interface ConnectionOptions {
  url: string
  token: string
  hello: WorkerHello
  /** 下行命令处理器：返回值作为 result 帧的 result；抛错=ok:false HANDLER_ERROR */
  onCommand(action: string, payload: unknown): Promise<unknown> | unknown
  onState?(state: BridgeState, detail?: string): void
  socketFactory?: SocketFactory
  now?(): number
}

const ACK_TIMEOUT_MS = 10_000
const HEARTBEAT_MS = 60_000
const CREDENTIAL_CLOSE_CODES = new Set([4001, 4401])

/** 一次待补报事件的排队形态（FIFO，保序） */
interface PendingEvent { frame: EventFrame; resolve: (ok: boolean) => void }

/**
 * The cms task-router connection: one live WebSocket per Source config, with reconnect backoff, credential parking,
 * offline FIFO event replay (acked), and command dispatching to the Source's intake.
 * cms 任务路由连接：每份来源配置一条活跃 WebSocket，带重连退避、凭证停泊、
 * 离线 FIFO 事件补报（带确认）与指向来源接收面的命令分发。
 */
export class TaskhubConnection {
  private readonly options: ConnectionOptions
  private socket: SocketLike | null = null
  private state: BridgeState = 'idle'
  private attempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private queue: PendingEvent[] = []
  private flushing = false
  private running = 0
  /** 在途事件的 ack 等待者（按帧 id；event_ack 命中即决） */
  private pendingAcks = new Map<string, (ok: boolean) => void>()

  constructor(options: ConnectionOptions) {
    this.options = options
  }

  /** 当前状态快照（健康面消费） */
  get bridgeState(): BridgeState { return this.state }

  /** 在跑任务数（心跳 running 观测面；派发处理器维护） */
  get runningTasks(): number { return this.running }

  setRunning(count: number): void { this.running = count }

  /** 建立连接（幂等；连接成功即注册 + 补报离线队列） */
  connect(): void {
    if (this.state === 'disposed' || this.socket) return
    this.setState('connecting')
    const socket = this.factory()(this.options.url, { Authorization: `Bearer ${this.options.token}` })
    this.socket = socket
    socket.onOpen(() => {
      if (this.socket !== socket) return
      this.attempts = 0
      this.setState('connected')
      // 两段注册（契约 §2）：node.identity 进 wsgw 连接注册表（派发寻址的
      // 前提），taskhub.worker.hello 进 taskhub 语义面（路由自述）。缺一即
      // 恒 ErrWorkerOffline（2026-11-02 双进程演练实锤）。
      const hello = this.options.hello
      this.report('node.identity', { nodeId: hello.nodeId, nodeName: hello.title,
        nodeDescription: hello.description, nodeIcon: '🛰️' }).catch(() => { /* 补报队列兜底 */ })
      this.report(EVENT_WORKER_HELLO, hello).catch(() => { /* 补报队列兜底 */ })
      this.startHeartbeat()
      void this.flush()
    })
    socket.onClose(code => {
      if (this.socket !== socket) return
      this.socket = null
      this.stopHeartbeat()
      if (CREDENTIAL_CLOSE_CODES.has(code)) { this.setState('awaiting-credential', `close ${code}`); return }
      this.scheduleReconnect()
    })
    socket.onError(() => { /* close 随后到达，重连在 onClose 处理 */ })
    socket.onMessage(text => this.receive(text))
  }

  /** 主动断开（不重连；队列保留待 connect 复用） */
  dispose(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.stopHeartbeat()
    this.state = 'disposed'
    this.socket?.close()
    this.socket = null
  }

  /**
   * 上报事件：在线等 event_ack（超时/断连抛错，调用方重试）；离线入 FIFO
   * 队列，重连后按序补报。至少一次语义由 cms 侧 UNIQUE 去重兜底。
   */
  report(name: string, payload: unknown): Promise<void> {
    if (this.state === 'disposed') return Promise.resolve()
    if (this.state !== 'connected' || this.socket === null) {
      return new Promise(resolve => { this.queue.push({ frame: this.eventFrame(name, payload), resolve: () => resolve() }) })
    }
    return this.awaitAck(this.eventFrame(name, payload))
  }

  private setState(state: BridgeState, detail?: string): void {
    this.state = state
    this.options.onState?.(state, detail)
  }

  private factory(): SocketFactory {
    return this.options.socketFactory ?? defaultSocketFactory
  }

  private eventFrame(name: string, payload: unknown): EventFrame {
    return { type: 'event', id: `evt_${randomUUID()}`, name, payload, ts: (this.options.now ?? Date.now)() }
  }

  private receive(text: string): void {
    const frame = parseServerFrame(text)
    if (!frame) return
    if (frame.type === 'command') { void this.runCommand(frame); return }
    if (frame.type === 'event_ack') {
      const waiter = this.pendingAcks.get(frame.id)
      if (waiter) {
        this.pendingAcks.delete(frame.id)
        waiter(true)
      }
    }
  }

  private async runCommand(frame: CommandFrame): Promise<void> {
    let result: ResultFrame
    try {
      const value = await this.options.onCommand(frame.action, frame.payload)
      result = { type: 'result', id: frame.id, ok: true, result: value }
    } catch (error) {
      result = { type: 'result', id: frame.id, ok: false, code: 'HANDLER_ERROR', message: String(error) }
    }
    this.socket?.send(serializeClientFrame(result))
  }

  private async awaitAck(frame: EventFrame): Promise<void> {
    const socket = this.socket
    if (!socket) return this.enqueue(frame)
    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          this.pendingAcks.delete(frame.id)
          reject(new Error('event acknowledgement timeout'))
        }, ACK_TIMEOUT_MS)
        this.pendingAcks.set(frame.id, () => { clearTimeout(timeout); resolve() })
        socket.send(serializeClientFrame(frame))
      })
      if (this.socket !== socket) throw new Error('disconnected during report')
    } catch (error) {
      // 超时/断连：帧若已入队则交还队列（重连补报），否则上抛由调用方重试。
      throw error
    }
  }

  private enqueue(frame: EventFrame): Promise<void> {
    return new Promise(resolve => { this.queue.push({ frame, resolve: () => resolve() }) })
  }

  private async flush(): Promise<void> {
    if (this.flushing || this.state !== 'connected') return
    this.flushing = true
    try {
      while (this.queue.length > 0 && this.state === 'connected') {
        const pending = this.queue[0]!
        try {
          await this.awaitAck(pending.frame)
          this.queue.shift()
          pending.resolve(true)
        } catch {
          break // 连接已断：整队保留，重连后重试（保序）。
        }
      }
    } finally {
      this.flushing = false
    }
  }

  private scheduleReconnect(): void {
    if (this.state === 'disposed' || this.state === 'awaiting-credential') return
    const delay = Math.min(1000 * 2 ** this.attempts, 30_000)
    this.attempts += 1
    this.setState('reconnecting', `retry in ${delay}ms`)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (this.state === 'reconnecting' || this.state === 'idle') this.connect()
    }, delay)
  }

  private startHeartbeat(): void {
    this.stopHeartbeat()
    this.heartbeatTimer = setInterval(() => {
      this.report(EVENT_WORKER_HEARTBEAT, { nodeId: this.options.hello.nodeId, running: this.running })
        .catch(() => { /* 断连由 onClose 收敛 */ })
    }, HEARTBEAT_MS)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    this.heartbeatTimer = null
  }
}

/** 生产 socket 工厂：ws 包（原生 WebSocket 不支持自定义握手头） */
function defaultSocketFactory(url: string, headers: Record<string, string>): SocketLike {
  const socket = new WebSocket(url, { headers })
  return {
    send: text => socket.send(text),
    close: code => socket.close(code),
    onOpen: cb => socket.on('open', () => cb()),
    onClose: cb => socket.on('close', code => cb(code)),
    onError: cb => socket.on('error', err => cb(err instanceof Error ? err : new Error(String(err)))),
    onMessage: cb => socket.on('message', data => cb(String(data))),
  }
}
