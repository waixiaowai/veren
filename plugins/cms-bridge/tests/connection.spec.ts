import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import { ConnectionManager } from '../src/connection';
import { Dispatcher } from '../src/dispatcher';
import { EventReporter } from '../src/reporter';
import type { ConnectionConfig } from '../src/connection';
import type { SocketFactory, SocketLike } from '../src/protocol';

/** 可编程假 socket / a programmable fake socket */
class FakeSocket implements SocketLike {
  sent: string[] = [];
  private openCbs: Array<() => void> = [];
  private closeCbs: Array<(code: number) => void> = [];
  private messageCbs: Array<(text: string) => void> = [];

  send(text: string): void {
    this.sent.push(text);
  }

  close(code?: number): void {
    for (const cb of this.closeCbs) cb(code ?? 1000);
  }

  onOpen(cb: () => void): void {
    this.openCbs.push(cb);
  }

  onClose(cb: (code: number) => void): void {
    this.closeCbs.push(cb);
  }

  onMessage(cb: (text: string) => void): void {
    this.messageCbs.push(cb);
  }

  onError(): void {}

  /** 模拟服务端侧连接建立 / simulates the server accepting the connection */
  open(): void {
    for (const cb of this.openCbs) cb();
  }

  /** 模拟服务端下发报文 / simulates a server frame */
  message(text: string): void {
    for (const cb of this.messageCbs) cb(text);
  }
}

/** 组装被测对象：返回管理器与 socket 创建记录 / builds the subject plus created sockets */
function makeManager(configOverrides: Partial<ConnectionConfig> = {}) {
  const sockets: FakeSocket[] = [];
  const factory: SocketFactory = () => {
    const socket = new FakeSocket();
    sockets.push(socket);
    return socket;
  };
  const dispatcher = new Dispatcher({ commandTimeoutMs: 1_000 });
  const reporter = new EventReporter();
  const manager = new ConnectionManager(
    new Context(),
    {
      url: 'wss://cms.example/link',
      token: 'secret-token-123',
      commandTimeoutMs: 1_000,
      reconnect: { initialDelayMs: 10, maxDelayMs: 100, factor: 2 },
      credentialCloseCodes: [4001, 4401],
      ...configOverrides,
    },
    factory,
    dispatcher,
    reporter,
  );
  return { manager, sockets, dispatcher, reporter };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('ConnectionManager', () => {
  it('启动即连接，open 后进入 connected（P1/P9）/ connects on start and turns connected on open', () => {
    const { manager, sockets } = makeManager();
    manager.start();
    expect(manager.status().state).toBe('connecting');
    expect(sockets).toHaveLength(1);
    sockets[0].open();
    const status = manager.status();
    expect(status.state).toBe('connected');
    expect(status.connectedAt).not.toBeNull();
    expect(status.credentialFingerprint).toBe('secr…(16)');
    manager.dispose();
  });

  it('已映射指令执行后回传成功结果（P4）/ a mapped command gets a success result sent back', async () => {
    const { manager, sockets, dispatcher } = makeManager();
    dispatcher.register('ping', { handler: () => 'pong' });
    manager.start();
    sockets[0].open(); // onOpen 同时上报节点身份,断言时过滤身份帧
    sockets[0].message(JSON.stringify({ type: 'command', id: 'c1', action: 'ping' }));
    await vi.advanceTimersByTimeAsync(1); // 冲刷微任务让回执落地 / flush microtasks so the result lands
    const frames = sockets[0].sent.map((t) => JSON.parse(t) as { type: string; id: string });
    expect(frames.find((f) => f.type === 'result')).toEqual({ type: 'result', id: 'c1', ok: true, result: 'pong' });
    manager.dispose();
  });

  it('异常断线自动重连（P2）/ an abnormal drop triggers an automatic reconnect', async () => {
    const { manager, sockets } = makeManager();
    manager.start();
    sockets[0].open();
    sockets[0].close(1006);
    expect(manager.status().state).toBe('reconnecting');
    await vi.advanceTimersByTimeAsync(50); // 首次退避 10ms + 余量
    expect(sockets.length).toBeGreaterThanOrEqual(2);
    expect(manager.status().state).toBe('connecting');
    sockets[sockets.length - 1].open();
    expect(manager.status().state).toBe('connected');
    manager.dispose();
  });

  it('退避按指数增长且封顶 / the backoff grows exponentially and is capped', async () => {
    const { manager, sockets } = makeManager({ reconnect: { initialDelayMs: 10, maxDelayMs: 40, factor: 2 } });
    manager.start();
    sockets[0].close(1006);
    await vi.advanceTimersByTimeAsync(11);
    const afterFirst = sockets.length;
    sockets[afterFirst - 1].close(1006);
    await vi.advanceTimersByTimeAsync(21); // 第二次 20ms
    expect(sockets.length).toBe(afterFirst + 1);
    sockets[sockets.length - 1].close(1006);
    await vi.advanceTimersByTimeAsync(39); // 第三次封顶 40ms：39ms 还不够
    expect(sockets.length).toBe(afterFirst + 1);
    await vi.advanceTimersByTimeAsync(2);
    expect(sockets.length).toBe(afterFirst + 2);
    manager.dispose();
  });

  it('凭证失效停止重试进入等待重配置，换新凭证后恢复（P3）/ a credential failure parks; a new credential resumes', async () => {
    const { manager, sockets } = makeManager();
    manager.start();
    sockets[0].open();
    sockets[0].close(4401);
    expect(manager.status().state).toBe('awaiting-credential');
    expect(manager.status().lastError).toContain('4401');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sockets).toHaveLength(1); // 停止重试 / no more retries

    manager.setCredential('brand-new-token-456');
    expect(sockets).toHaveLength(2);
    sockets[1].open();
    expect(manager.status().state).toBe('connected');
    manager.dispose();
  });

  it('服务端应用层拒绝凭证同样停靠（含 close 收尾）/ an app-level credential rejection parks as well', async () => {
    const { manager, sockets } = makeManager();
    manager.start();
    sockets[0].open();
    sockets[0].message(JSON.stringify({ type: 'error', code: 'CREDENTIAL_INVALID', message: 'revoked' }));
    expect(manager.status().state).toBe('awaiting-credential');
    manager.dispose();
  });

  it('断线期间上报的事件重连后补报（P8）/ events reported offline are replayed after reconnect', async () => {
    const { manager, sockets, reporter } = makeManager();
    manager.start();
    sockets[0].open();
    // 先断线，再产生 3 条待上报数据（模拟服务端不可达期间）
    // Drop the link first, then produce 3 events while it is down
    sockets[0].close(1006);
    reporter.report('a', 1);
    reporter.report('b', 2);
    reporter.report('c', 3);
    expect(manager.status().pendingEvents).toBe(3);

    await vi.advanceTimersByTimeAsync(50);
    sockets[sockets.length - 1].open();
    expect(manager.status().state).toBe('connected');
    expect(manager.status().pendingEvents).toBe(0);
    const names = sockets[sockets.length - 1].sent
      .map((t) => JSON.parse(t) as { name?: string })
      .filter((f) => f.name !== undefined && f.name !== 'node.identity') // 过滤连接身份上报 / skip the identity announcement
      .map((f) => f.name);
    expect(names).toEqual(['a', 'b', 'c']);
    manager.dispose();
  });

  it('dispose 后不再产生新连接 / dispose stops everything', async () => {
    const { manager, sockets } = makeManager();
    manager.start();
    manager.dispose();
    expect(manager.status().state).toBe('disposed');
    sockets[0].close(1006);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(sockets).toHaveLength(1);
  });
});
