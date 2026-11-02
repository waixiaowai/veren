/**
 * taskhub 线协议层（契约 = docs/taskhub-protocol.cn.md v1，帧形态与 cms
 * internal/wsgw 同形；本文件刻意保持「纯」：不依赖 Cordis、不碰网络）。
 *
 * The taskhub wire-protocol layer (contract = docs/taskhub-protocol.md v1;
 * frames are shape-identical with cms internal/wsgw). Pure on purpose: no
 * Cordis, no network.
 */

/** 服务端 → 节点：执行指令 / server → node: run a command */
export interface CommandFrame {
  type: 'command'
  id: string
  action: string
  payload?: unknown
}

/** 服务端 → 节点：事件回执 / server → node: an event acknowledgement */
export interface EventAckFrame {
  type: 'event_ack'
  id: string
}

/** 服务端 → 节点：协议级错误 / server → node: a protocol-level error */
export interface ErrorFrame {
  type: 'error'
  code: string
  message?: string
}

export type ServerFrame = CommandFrame | EventAckFrame | ErrorFrame

/** 节点 → 服务端：指令回执（只承载接/拒；契约 §3 硬约束） */
export type ResultFrame =
  | { type: 'result'; id: string; ok: true; result?: unknown }
  | { type: 'result'; id: string; ok: false; code: string; message: string }

/** 节点 → 服务端：主动上报事件（过程回复/完成回报/注册/心跳；契约 §2/§4） */
export interface EventFrame {
  type: 'event'
  id: string
  name: string
  payload?: unknown
  ts: number
}

export type ClientFrame = ResultFrame | EventFrame

/** 事件名（契约单一来源的节点侧镜像） */
export const EVENT_WORKER_HELLO = 'taskhub.worker.hello'
export const EVENT_WORKER_HEARTBEAT = 'taskhub.worker.heartbeat'
export const EVENT_TASK_REPLY = 'taskhub.task.reply'
export const EVENT_TASK_RESULT = 'taskhub.task.result'

/** 回复地址三元组（intake 定格、全生命周期不可变） */
export interface TaskOrigin {
  source: string
  conversation: string
  requester: string
}

/** 下行派发信封（契约 §3 task.dispatch 的 payload） */
export interface DispatchEnvelope {
  taskId: string
  intent: string
  origin: TaskOrigin
  createdAt: number
}

/** 节点注册载荷（契约 §2） */
export interface WorkerHello {
  nodeId: string
  title: string
  description: string
  tags: string[]
  maxConcurrent: number
}

/** 完成回报 outcome 闭集（契约 §4；superagent TicketOutcome 的投影） */
export type TaskOutcome = 'completed' | 'stopped' | 'failed'

/**
 * 解析一段服务端文本为报文；不合法返回 null（调用方回协议错误后忽略）。
 * Parses one server text frame; null when invalid (caller drops it).
 */
export function parseServerFrame(text: string): ServerFrame | null {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof data !== 'object' || data === null) return null
  const frame = data as Record<string, unknown>
  if (frame.type === 'command') {
    if (typeof frame.id !== 'string' || typeof frame.action !== 'string') return null
    return { type: 'command', id: frame.id, action: frame.action, payload: frame.payload }
  }
  if (frame.type === 'event_ack') {
    if (typeof frame.id !== 'string') return null
    return { type: 'event_ack', id: frame.id }
  }
  if (frame.type === 'error') {
    if (typeof frame.code !== 'string') return null
    return { type: 'error', code: frame.code, message: typeof frame.message === 'string' ? frame.message : undefined }
  }
  return null
}

/** 序列化节点报文 / serializes a client frame */
export function serializeClientFrame(frame: ClientFrame): string {
  return JSON.stringify(frame)
}

/**
 * 校验派发信封（7707 InvalidEnvelope 的节点侧判定面）；返回错误文案或 null。
 * Validates a dispatch envelope; returns an error message or null.
 */
export function validateEnvelope(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return 'payload must be an object'
  const env = payload as Partial<DispatchEnvelope>
  if (typeof env.taskId !== 'string' || env.taskId === '') return 'taskId is required'
  if (typeof env.intent !== 'string' || env.intent === '') return 'intent is required'
  if (typeof env.createdAt !== 'number' || !Number.isFinite(env.createdAt)) return 'createdAt is required'
  const origin = env.origin
  if (typeof origin !== 'object' || origin === null) return 'origin is required'
  const o = origin as Partial<TaskOrigin>
  if (typeof o.source !== 'string' || o.source === '') return 'origin.source is required'
  if (typeof o.conversation !== 'string' || o.conversation === '') return 'origin.conversation is required'
  if (typeof o.requester !== 'string' || o.requester === '') return 'origin.requester is required'
  return null
}
