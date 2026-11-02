/** taskhub wire contract pins: the JSON literals from docs/taskhub-protocol.cn.md §2/§3/§4, verbatim. */
/** taskhub 线协议契约钉：docs/taskhub-protocol.cn.md §2/§3/§4 的 JSON 字面，逐字比对。 */
import { describe, expect, it } from 'vitest'
import { parseServerFrame, serializeClientFrame, validateEnvelope,
  type DispatchEnvelope, type EventFrame } from '../src/infra/taskhub/protocol.ts'

// 合同字面（文档 §3 下行信封）。
const CONTRACT_DISPATCH = '{"taskId":"01JBYQ8...","intent":"帮我看看仓库里 CI 为什么红了",' +
  '"origin":{"source":"wechat","conversation":"p2p:wxid_abc","requester":"wxid_abc"},"createdAt":1762000000}'
// 合同字面（文档 §4 完成回报）。
const CONTRACT_RESULT = '{"taskId":"01JBYQ8...","outcome":"completed","summary":"CI 已修复，原因并合入了回归测试。"}'

describe('taskhub wire contract', () => {
  it('round-trips the dispatch envelope byte-identically', () => {
    const frame = parseServerFrame(`{"type":"command","id":"wcmd_01J...","action":"task.dispatch","payload":${CONTRACT_DISPATCH}}`)
    expect(frame).toEqual({ type: 'command', id: 'wcmd_01J...', action: 'task.dispatch',
      payload: { taskId: '01JBYQ8...', intent: '帮我看看仓库里 CI 为什么红了',
        origin: { source: 'wechat', conversation: 'p2p:wxid_abc', requester: 'wxid_abc' }, createdAt: 1762000000 } })
    const envelope = (frame as { payload: DispatchEnvelope }).payload
    expect(JSON.stringify(envelope)).toBe(CONTRACT_DISPATCH)
  })

  it('round-trips the completion report byte-identically', () => {
    const event: EventFrame = { type: 'event', id: 'evt_04', name: 'taskhub.task.result', ts: 1762003600000,
      payload: { taskId: '01JBYQ8...', outcome: 'completed', summary: 'CI 已修复，原因并合入了回归测试。' } }
    const text = serializeClientFrame(event)
    expect(text).toContain(CONTRACT_RESULT) // 载荷与合同字面逐字一致。
    expect(JSON.parse(text)).toMatchObject({ type: 'event', id: 'evt_04', name: 'taskhub.task.result', ts: 1762003600000 })
  })

  it('serializes the accept receipt in the pinned shape', () => {
    const receipt = serializeClientFrame({ type: 'result', id: 'wcmd_01J...', ok: true, result: { accepted: true } })
    expect(JSON.parse(receipt)).toEqual({ type: 'result', id: 'wcmd_01J...', ok: true, result: { accepted: true } })
    const refusal = serializeClientFrame({ type: 'result', id: 'w1', ok: true, result: { accepted: false, reason: '超出本节点策略范围' } })
    expect(JSON.parse(refusal).result).toEqual({ accepted: false, reason: '超出本节点策略范围' })
  })

  it('parses server frames, rejects junk and result frames (uplink only)', () => {
    expect(parseServerFrame('{"type":"event_ack","id":"evt_1"}')).toEqual({ type: 'event_ack', id: 'evt_1' })
    expect(parseServerFrame('{"type":"error","code":"X","message":"m"}')).toEqual({ type: 'error', code: 'X', message: 'm' })
    expect(parseServerFrame('not json')).toBeNull()
    expect(parseServerFrame('{"type":"command"}')).toBeNull()
    expect(parseServerFrame('{"type":"result","id":"w1","ok":true}')).toBeNull()
  })

  it('validates envelopes (7707 face)', () => {
    expect(validateEnvelope(JSON.parse(CONTRACT_DISPATCH))).toBeNull()
    expect(validateEnvelope({ taskId: 't', intent: 'i', createdAt: 1 })).toContain('origin')
    expect(validateEnvelope({ intent: 'i', origin: { source: 's', conversation: 'c', requester: 'r' }, createdAt: 1 })).toContain('taskId')
    expect(validateEnvelope('junk')).toContain('object')
  })
})
