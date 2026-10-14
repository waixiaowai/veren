import { describe, expect, it, vi } from 'vitest';
import { Dispatcher } from '../src/dispatcher';
import { INVALID_PAYLOAD, TIMEOUT, UNKNOWN_ACTION } from '../src/protocol';

/** 快速分发器：超时 50ms，便于测试超时路径 / a fast dispatcher: 50ms timeout for timeout-path tests */
function makeDispatcher(timeoutMs = 50) {
  return new Dispatcher({ commandTimeoutMs: timeoutMs });
}

describe('Dispatcher', () => {
  it('已映射 action 执行成功并回传结果 / a mapped action succeeds and returns the result', async () => {
    const d = makeDispatcher();
    d.register('ping', { handler: () => 'pong' });
    await expect(d.dispatch('c1', 'ping', undefined)).resolves.toEqual({
      type: 'result',
      id: 'c1',
      ok: true,
      result: 'pong',
    });
  });

  it('未映射 action 回传 UNKNOWN_ACTION 明确失败 / an unmapped action fails with UNKNOWN_ACTION', async () => {
    const d = makeDispatcher();
    const frame = await d.dispatch('c1', 'nope', undefined);
    expect(frame).toMatchObject({ ok: false, code: UNKNOWN_ACTION });
    expect((frame as { message: string }).message).toContain('unknown action');
  });

  it('payload 校验失败回传 INVALID_PAYLOAD / a failed payload check yields INVALID_PAYLOAD', async () => {
    const d = makeDispatcher();
    d.register('echo', {
      handler: (p) => p,
      validate: (p) => (typeof p === 'string' ? null : 'payload must be a string'),
    });
    expect(await d.dispatch('c1', 'echo', 42)).toMatchObject({ ok: false, code: INVALID_PAYLOAD });
    expect(await d.dispatch('c2', 'echo', 'hi')).toMatchObject({ ok: true, result: 'hi' });
  });

  it('卡死的 handler 超时回传失败，且不阻塞后续指令 / a stuck handler times out without blocking later commands', async () => {
    const d = makeDispatcher();
    const onTimeout = vi.fn();
    d.register('stuck', { handler: () => new Promise(() => {}) });
    d.register('fast', { handler: () => 'ok' });

    const stuckPromise = d.dispatch('c1', 'stuck', undefined);
    // 超时期间后续指令照常执行 / later commands run normally while the stuck one is pending
    await expect(d.dispatch('c2', 'fast', undefined)).resolves.toMatchObject({ ok: true });
    await expect(stuckPromise).resolves.toMatchObject({ ok: false, code: TIMEOUT });
    expect(d.inflight).toBe(0); // 卡死指令被放弃后不再占用 in-flight 计数
  });

  it('超时触发 onTimeout 观测回调 / the timeout fires the onTimeout observer', async () => {
    const onTimeout = vi.fn();
    const d = new Dispatcher({ commandTimeoutMs: 20, onTimeout });
    d.register('stuck', { handler: () => new Promise(() => {}) });
    await d.dispatch('c1', 'stuck', undefined);
    expect(onTimeout).toHaveBeenCalledWith('stuck', 20);
  });

  it('handler 抛错回传 HANDLER_ERROR / a throwing handler yields HANDLER_ERROR', async () => {
    const d = makeDispatcher();
    d.register('boom', {
      handler: () => {
        throw new Error('exploded');
      },
    });
    await expect(d.dispatch('c1', 'boom', undefined)).resolves.toMatchObject({
      ok: false,
      code: 'HANDLER_ERROR',
      message: 'exploded',
    });
  });

  it('register/unregister/has/list 维护映射表 / the mapping table is maintainable', () => {
    const d = makeDispatcher();
    d.register('a', { handler: () => 1 });
    expect(d.has('a')).toBe(true);
    expect(d.list()).toEqual(['a']);
    expect(d.unregister('a')).toBe(true);
    expect(d.has('a')).toBe(false);
  });
});
