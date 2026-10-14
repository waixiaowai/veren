import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import type { Fiber } from '@deepseek-ai/cordis';
import { wire } from '../src/index';
import type { CmsBridgeService } from '../src/connection';
import type { SocketFactory, SocketLike } from '../src/protocol';

/**
 * 组合测试：走 wire（apply 的真实装配路径，仅替换传输层为假 socket），
 * 验证服务注册、运行时新增 action 映射与状态可观测。
 * Composition test: goes through wire (apply's real assembly path with only
 * the transport swapped for fake sockets), verifying service registration,
 * runtime action additions and observability.
 */

/** 可编程假 socket / a programmable fake socket */
class FakeSocket implements SocketLike {
  sent: string[] = [];
  private cbs = { open: [] as Array<() => void>, close: [] as Array<(c: number) => void>, message: [] as Array<(t: string) => void> };

  send(text: string): void {
    this.sent.push(text);
  }

  close(code?: number): void {
    for (const cb of this.cbs.close) cb(code ?? 1000);
  }

  onOpen(cb: () => void): void {
    this.cbs.open.push(cb);
  }

  onClose(cb: (code: number) => void): void {
    this.cbs.close.push(cb);
  }

  onMessage(cb: (text: string) => void): void {
    this.cbs.message.push(cb);
  }

  onError(): void {}

  open(): void {
    for (const cb of this.cbs.open) cb();
  }

  message(text: string): void {
    for (const cb of this.cbs.message) cb(text);
  }
}

/** 装载插件并返回上下文/服务/socket 记录 / installs the bridge and returns the harness */
async function install(configOverrides: Record<string, unknown> = {}) {
  const ctx = new Context();
  const sockets: FakeSocket[] = [];
  const factory: SocketFactory = () => {
    const socket = new FakeSocket();
    sockets.push(socket);
    return socket;
  };
  const fiber: Fiber = ctx.plugin({ name: 'cmsBridgeTest', inject: [], apply: (context, config) => void wire(context, config, factory) }, {
    url: 'wss://cms.example/link',
    token: 'secret-token-123',
    commandTimeoutMs: 200,
    reconnect: { initialDelayMs: 5, maxDelayMs: 20, factor: 2 },
    credentialCloseCodes: [4001, 4401],
    ...configOverrides,
  });
  await fiber;
  const service = ctx.get<CmsBridgeService>('cmsBridge')!;
  return { ctx, fiber, service, sockets };
}

const fibers: Array<Fiber> = [];
beforeEach(() => vi.useFakeTimers());
afterEach(async () => {
  await Promise.allSettled(fibers.map((fiber) => fiber.dispose()));
  fibers.length = 0;
  vi.useRealTimers();
});

describe('cms-bridge composition（真实装配路径 / real assembly path）', () => {
  it('服务以 cmsBridge 注册，状态经由事件广播（P1/P9）/ the service registers and broadcasts status', async () => {
    const { ctx, service, sockets } = await install();
    fibers.push(ctx.plugin({ name: 'noop', inject: [], apply: () => {} }));
    expect(service).toBeDefined();
    const seen: Array<Record<string, unknown>> = [];
    ctx.on('cms-bridge/status', (status) => seen.push({ ...status }));
    sockets[0].open();
    expect(service.status().state).toBe('connected');
    expect(seen.at(-1)).toMatchObject({ state: 'connected' });
  });

  it('运行时新增 action 映射后服务端即可下发执行（P4/P10）/ a runtime-added action is callable by the server right away', async () => {
    const { service, sockets } = await install();
    sockets[0].open();
    // 服务端无需任何改动：插件侧注册即生效 / no server-side change: registering is enough
    service.registerAction('echo', { handler: (p) => `echo:${String(p)}` });
    sockets[0].message(JSON.stringify({ type: 'command', id: 'c1', action: 'echo', payload: 'hi' }));
    await vi.advanceTimersByTimeAsync(1);
    const result = sockets[0].sent.map((t) => JSON.parse(t) as Record<string, unknown>).find((f) => f.type === 'result');
    expect(result).toEqual({ type: 'result', id: 'c1', ok: true, result: 'echo:hi' });
  });

  it('未知 action 回传明确失败（P5）/ an unknown action gets an explicit failure', async () => {
    const { sockets } = await install();
    sockets[0].open();
    sockets[0].message(JSON.stringify({ type: 'command', id: 'c9', action: 'mystery' }));
    await vi.advanceTimersByTimeAsync(1);
    const result = sockets[0].sent.map((t) => JSON.parse(t) as Record<string, unknown>).find((f) => f.type === 'result');
    expect(result).toMatchObject({ id: 'c9', ok: false, code: 'UNKNOWN_ACTION' });
  });

  it('卡死 action 超时回传失败且后续指令不受影响（P6）/ a stuck action times out; later commands proceed', async () => {
    const { service, sockets } = await install();
    sockets[0].open();
    service.registerAction('stuck', { handler: () => new Promise(() => {}) });
    service.registerAction('quick', { handler: () => 'ok' });
    sockets[0].message(JSON.stringify({ type: 'command', id: 'c1', action: 'stuck' }));
    sockets[0].message(JSON.stringify({ type: 'command', id: 'c2', action: 'quick' }));
    await vi.advanceTimersByTimeAsync(1);
    const results = sockets[0].sent.map((t) => JSON.parse(t) as Record<string, unknown>);
    expect(results.find((f) => f.id === 'c2')).toMatchObject({ ok: true, result: 'ok' });
    expect(results.find((f) => f.id === 'c1')).toBeUndefined(); // 还没超时 / not timed out yet
    await vi.advanceTimersByTimeAsync(220);
    const late = sockets[0].sent.map((t) => JSON.parse(t) as Record<string, unknown>).find((f) => f.id === 'c1');
    expect(late).toMatchObject({ ok: false, code: 'TIMEOUT' });
  });

  it('fiber 卸载逆序清理，socket 关闭且不再重连 / unloading disposes cleanly', async () => {
    const { ctx, sockets } = await install();
    sockets[0].open();
    const fiber = ctx.plugin({ name: 'noop', inject: [], apply: () => {} });
    await fiber.dispose();
    expect(sockets[0].sent.filter(Boolean)).toEqual(sockets[0].sent);
    sockets[0].message('{"type":"command","id":"x","action":"y"}');
    await vi.advanceTimersByTimeAsync(1);
    expect(sockets).toHaveLength(1); // 卸载后不再新建连接 / no new sockets after unload
  });
});
