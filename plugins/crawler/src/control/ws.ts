/**
 * 最小 RFC6455 服务端：握手、文本帧收发、ping/pong 与关闭——只覆盖
 * ws-logs/ws-status 推送通道需要的子集（design/api.md §6）。
 * A minimal RFC6455 server: handshake, text-frame send/receive, ping/pong
 * and close — only the subset the ws-logs/ws-status push channels need
 * (design api.md §6).
 *
 * 服务器→客户端帧不做掩码（RFC 允许），客户端→服务器帧按规范必须掩码。
 * Server→client frames are unmasked (RFC-allowed); client→server frames
 * must be masked per spec.
 *
 * @module @veren/crawler/control/ws
 */
import { createHash } from 'node:crypto'
import type { Duplex } from 'node:stream'

/** RFC6455 握手魔串 / the RFC6455 handshake magic GUID */
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

/** Sec-WebSocket-Accept 计算 / computes the Sec-WebSocket-Accept value */
export function acceptKey(clientKey: string): string {
  return createHash('sha1').update(clientKey + WS_GUID).digest('base64')
}

/** 写握手响应 / writes the handshake response */
export function writeHandshake(socket: Duplex, clientKey: string): void {
  socket.write('HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${acceptKey(clientKey)}\r\n` +
    '\r\n')
}

/** 编码一帧服务器→客户端文本 / encodes one server→client text frame */
export function encodeTextFrame(payload: string): Buffer {
  const data = Buffer.from(payload, 'utf8')
  const length = data.length
  let header: Buffer
  if (length < 126) {
    header = Buffer.from([0x81, length])
  } else if (length < 65_536) {
    header = Buffer.from([0x81, 126, length >> 8, length & 0xff])
  } else {
    header = Buffer.alloc(8)
    header[0] = 0x81
    header[1] = 127
    header.writeUInt32BE(length >>> 32, 2)
    header.writeUInt32BE(length & 0xffffffff, 6)
  }
  return Buffer.concat([header, data])
}

/** 编码一帧 Pong / encodes a pong frame */
export function encodePong(payload: Buffer): Buffer {
  return Buffer.concat([Buffer.from([0x8a, payload.length]), payload])
}

/** 编码一帧 Close / encodes a close frame */
export function encodeClose(): Buffer {
  return Buffer.from([0x88, 0x00])
}

/** 一条解码结果 / one decoded result */
export type DecodedFrame =
  | { opcode: 0x1 | 0x8 | 0x9 | 0xa; payload: Buffer }

/**
 * 从缓冲解码一帧（本通道不用分片与扩展）。
 * Decodes one frame from the buffer (this channel uses no fragmentation or
 * extensions).
 */
export function decodeFrame(buffer: Buffer): DecodedFrame | null {
  if (buffer.length < 2) return null
  const opcode = buffer[0] & 0x0f
  const masked = (buffer[1] & 0x80) !== 0
  let length = buffer[1] & 0x7f
  let offset = 2
  if (length === 126) {
    if (buffer.length < 4) return null
    length = buffer.readUInt16BE(2)
    offset = 4
  } else if (length === 127) {
    if (buffer.length < 10) return null
    length = buffer.readUInt32BE(6)
    offset = 10
  }
  const maskLength = masked ? 4 : 0
  if (buffer.length < offset + maskLength + length) return null
  const payload = Buffer.from(buffer.subarray(offset + maskLength, offset + maskLength + length))
  if (masked) {
    const mask = buffer.subarray(offset, offset + 4)
    for (let index = 0; index < payload.length; index += 1) {
      payload[index] ^= mask[index % 4]
    }
  }
  return { opcode: opcode as 0x1 | 0x8 | 0x9 | 0xa, payload }
}

/** 帧收发会话：解析字节流、回 pong、回调文本 / a frame session: parses the byte stream, answers pings, callbacks texts */
export class WsSession {
  private buffer = Buffer.alloc(0)
  private closed = false

  constructor(private readonly socket: Duplex, private readonly onText: (text: string) => void) {}

  /** 喂入一段字节流 / feeds one chunk of bytes */
  feed(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk])
    for (;;) {
      const frame = decodeFrame(this.buffer)
      if (frame === null) break
      this.handle(frame)
      if (this.closed) break
    }
  }

  /** 单帧处理：裁掉已消费字节再分发 / handles one frame: trims consumed bytes then dispatches */
  private handle(frame: DecodedFrame): void {
    const total = frameTotalLength(this.buffer)
    this.buffer = this.buffer.subarray(total)
    if (frame.opcode === 0x9) {
      this.socket.write(encodePong(frame.payload))
      return
    }
    if (frame.opcode === 0x8) {
      this.closed = true
      this.socket.write(encodeClose())
      return
    }
    if (frame.opcode === 0x1) this.onText(frame.payload.toString('utf8'))
  }

  /** 发送文本帧 / sends one text frame */
  sendText(text: string): void {
    if (!this.closed) this.socket.write(encodeTextFrame(text))
  }

  /** 会话是否已关闭 / whether the session is closed */
  get isClosed(): boolean {
    return this.closed
  }
}

/** 计算缓冲内首帧总长 / computes the first frame's total length in the buffer */
function frameTotalLength(buffer: Buffer): number {
  let length = buffer[1] & 0x7f
  let offset = 2
  if (length === 126) {
    length = buffer.readUInt16BE(2)
    offset = 4
  } else if (length === 127) {
    length = buffer.readUInt32BE(6)
    offset = 10
  }
  const masked = (buffer[1] & 0x80) !== 0
  return offset + (masked ? 4 : 0) + length
}


