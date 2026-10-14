import { describe, expect, it } from 'vitest';
import {
  BAD_FRAME,
  CREDENTIAL_INVALID,
  INVALID_PAYLOAD,
  TIMEOUT,
  UNKNOWN_ACTION,
  isCredentialFailure,
  parseServerFrame,
  serializeClientFrame,
} from '../src/protocol';
import type { EventFrame, ResultFrame } from '../src/protocol';

describe('parseServerFrame', () => {
  it('解析合法 command 报文 / parses a valid command frame', () => {
    expect(parseServerFrame('{"type":"command","id":"c1","action":"ping","payload":{"x":1}}')).toEqual({
      type: 'command',
      id: 'c1',
      action: 'ping',
      payload: { x: 1 },
    });
  });

  it('解析 event_ack 与 error 报文 / parses event_ack and error frames', () => {
    expect(parseServerFrame('{"type":"event_ack","id":"e1"}')).toEqual({ type: 'event_ack', id: 'e1' });
    expect(parseServerFrame('{"type":"error","code":"X"}')).toEqual({ type: 'error', code: 'X', message: undefined });
  });

  it('拒绝非 JSON、非对象与字段缺失的报文 / rejects non-JSON, non-object and field-missing frames', () => {
    expect(parseServerFrame('not json')).toBeNull();
    expect(parseServerFrame('42')).toBeNull();
    expect(parseServerFrame('{"type":"command"}')).toBeNull();
    expect(parseServerFrame('{"type":"unknown"}')).toBeNull();
    expect(parseServerFrame('{"type":"error"}')).toBeNull();
  });
});

describe('serializeClientFrame / isCredentialFailure', () => {
  it('result 报文可序列化且可回读 / result frames round-trip', () => {
    const frame: ResultFrame = { type: 'result', id: 'c1', ok: false, code: BAD_FRAME, message: 'bad' };
    expect(parseServerFrame(serializeClientFrame(frame))).toBeNull(); // 客户端报文不属于服务端报文
    expect(JSON.parse(serializeClientFrame(frame))).toEqual(frame);
  });

  it('event 报文包含 id/name/payload/ts / event frames carry id/name/payload/ts', () => {
    const frame: EventFrame = { type: 'event', id: 'e1', name: 'tick', payload: 1, ts: 123 };
    expect(JSON.parse(serializeClientFrame(frame))).toEqual(frame);
  });

  it('凭证失效判定：显式 code 命中，配置 close code 命中，其余不命中 / credential classification', () => {
    const codes = new Set(['4001', '4401']);
    expect(isCredentialFailure(CREDENTIAL_INVALID, codes)).toBe(true);
    expect(isCredentialFailure('4001', codes)).toBe(true);
    expect(isCredentialFailure(UNKNOWN_ACTION, codes)).toBe(false);
    expect(isCredentialFailure(TIMEOUT, new Set())).toBe(false);
  });
});

describe('error codes', () => {
  it('失败路径的 code 覆盖未知 action / 无效 payload / 超时 / codes cover unknown action, invalid payload and timeout', () => {
    expect([UNKNOWN_ACTION, INVALID_PAYLOAD, TIMEOUT]).toEqual(['UNKNOWN_ACTION', 'INVALID_PAYLOAD', 'TIMEOUT']);
  });
});
