import { describe, expect, it, vi } from 'vitest';
import { EventReporter } from '../src/reporter';
import type { SocketLike } from '../src/protocol';

/** 可编程假 socket：记录 send 调用 / a programmable fake socket recording sends */
function makeSocket() {
  const sent: string[] = [];
  const socket: SocketLike = {
    send: (text) => {
      if (socket.failNext) {
        socket.failNext = false;
        throw new Error('send failed');
      }
      sent.push(text);
    },
    close: () => {},
    onOpen: () => {},
    onClose: () => {},
    onMessage: () => {},
    onError: () => {},
  };
  return { socket: socket as SocketLike & { failNext?: boolean }, sent };
}

describe('EventReporter', () => {
  it('在线时直接发送，不入队 / sends immediately while online', () => {
    const { socket, sent } = makeSocket();
    const r = new EventReporter();
    r.setConnected(socket);
    const { queued, id } = r.report('tick', { n: 1 });
    expect(queued).toBe(false);
    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0])).toMatchObject({ type: 'event', id, name: 'tick', payload: { n: 1 } });
    expect(r.pending).toBe(0);
  });

  it('离线时入队，重连后按序全部补报且不重复 / offline events are queued and replayed in order, once', () => {
    const { socket, sent } = makeSocket();
    const logs: string[] = [];
    const r = new EventReporter({ log: (m) => logs.push(m) });

    r.report('a', 1);
    r.report('b', 2);
    r.report('c', 3);
    expect(r.pending).toBe(3);
    expect(sent).toHaveLength(0);

    r.setConnected(socket); // 重连成功 → 补报
    expect(sent).toHaveLength(3);
    expect(sent.map((t) => (JSON.parse(t) as { name: string }).name)).toEqual(['a', 'b', 'c']);
    expect(r.pending).toBe(0);

    r.setConnected(socket); // 再次触发连接事件不重复补报
    expect(sent).toHaveLength(3);
    expect(logs.some((m) => m.includes('flushing 3'))).toBe(true);
  });

  it('补报顺序与入队顺序一致（FIFO）/ replay order matches enqueue order (FIFO)', () => {
    const { socket, sent } = makeSocket();
    const r = new EventReporter();
    const names = Array.from({ length: 10 }, (_, i) => `e${i}`);
    for (const name of names) r.report(name);
    r.setConnected(socket);
    expect(sent.map((t) => (JSON.parse(t) as { name: string }).name)).toEqual(names);
  });

  it('同步发送失败时事件留在队首，下次连接补报 / a sync send failure keeps the event queued', () => {
    const { socket, sent } = makeSocket();
    const r = new EventReporter();
    r.report('kept', true);
    socket.failNext = true;
    r.setConnected(socket);
    expect(sent).toHaveLength(0);
    expect(r.pending).toBe(1);
    r.setConnected(socket);
    expect(sent).toHaveLength(1);
  });

  it('自定义 id 生成器生效 / a custom id source is honored', () => {
    const r = new EventReporter({ nextId: vi.fn(() => 'fixed') });
    expect(r.report('x').id).toBe('fixed');
  });
});
