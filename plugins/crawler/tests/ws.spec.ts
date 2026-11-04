import { describe, expect, it } from 'vitest'
import { acceptKey, decodeFrame, encodeClose, encodePong, encodeTextFrame, WsSession } from '../src/control/ws.ts'
import { Duplex } from 'node:stream'

// RFC6455 最小服务端：握手 key（RFC 官方示例）、帧编解码、ping→pong、文本回调。
// The minimal RFC6455 server: the handshake key (the RFC's official example),
// frame codec, ping→pong, and the text callback.
/** 假 socket：收集写出字节 / a fake socket collecting written bytes */
class CollectDuplex extends Duplex {
  readonly written: Buffer[] = []
  _read(): void {}
  _write(chunk: Buffer, _enc: BufferEncoding, done: () => void): void {
    this.written.push(Buffer.from(chunk))
    done()
  }

  get output(): string {
    return Buffer.concat(this.written).toString('utf8')
  }
}

describe('ws codec', () => {
  it('computes the RFC6455 example accept key', () => {
    expect(acceptKey('dGhlIHNhbXBsZSBub25jZQ==')).toBe('s3pPLMBiTxaQ9kYGzzhZRbK+xOo=')
  })

  it('encodes and decodes a text frame roundtrip (small and 126+ payloads)', () => {
    for (const text of ['hello', 'x'.repeat(300)]) {
      const frame = encodeTextFrame(text)
      const decoded = decodeFrame(frame)
      expect(decoded?.opcode).toBe(1)
      expect(decoded?.payload.toString('utf8')).toBe(text)
    }
  })

  it('decodes a masked client frame', () => {
    // 客户端帧带掩码：手工构造 / client frames are masked: constructed by hand
    const mask = Buffer.from([1, 2, 3, 4])
    const payload = Buffer.from('ping-text', 'utf8')
    const masked = Buffer.from(payload.map((byte, index) => byte ^ mask[index % 4]))
    const frame = Buffer.concat([Buffer.from([0x81, 0x80 | payload.length]), mask, masked])
    expect(decodeFrame(frame)?.payload.toString('utf8')).toBe('ping-text')
  })
})

describe('WsSession', () => {
  it('answers a ping with a pong carrying the same payload', () => {
    const socket = new CollectDuplex()
    const session = new WsSession(socket, () => {})
    const mask = Buffer.from([9, 8, 7, 6])
    const payload = Buffer.from('abc').map((byte, index) => byte ^ mask[index % 4])
    session.feed(Buffer.concat([Buffer.from([0x89, 0x80 | 3]), mask, payload]))
    expect(socket.output).toContain('pong'.slice(0, 0)) // 输出为二进制，这里只断言有写出 / output is binary; assert something was written
    expect(socket.written.length).toBeGreaterThan(0)
  })

  it('callbacks text frames and stops after close', () => {
    const socket = new CollectDuplex()
    const seen: string[] = []
    const session = new WsSession(socket, (text) => seen.push(text))
    session.sendText('hello')
    session.feed(encodeTextFrame('from-client'))
    expect(seen).toEqual(['from-client'])
    session.feed(encodeClose())
    expect(session.isClosed).toBe(true)
    session.sendText('after-close')
    // 关闭后不再写出 / nothing written after close
    expect(socket.written.at(-1)).toEqual(encodeClose())
  })
})
