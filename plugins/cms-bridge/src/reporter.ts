/**
 * 事件上报器：插件主动向服务端上报数据的出站通道。
 *
 * The event reporter: the plugin's outbound channel for unsolicited reports.
 *
 * 职责边界（对应需求 6/7）：上报内容与时机由插件调用方自行定义；断线期间
 * 产生的事件进入 FIFO 队列，重连成功后按原始顺序补报，每条恰好一次，不丢失。
 *
 * Responsibility boundaries (requirements 6/7): the caller defines what and
 * when to report; events produced while offline enter a FIFO queue and are
 * replayed in the original order after reconnection, each exactly once.
 */

import type { SocketLike } from './protocol.js';
import type { EventFrame } from './protocol.js';
import { serializeClientFrame } from './protocol.js';

/** 上报器配置 / the reporter's options */
export interface ReporterOptions {
  /** 事件 id 生成器（默认递增，保证可对账）/ event id source (default: a counter, for reconciliation) */
  nextId?: () => string;
  /** 上报失败/入队等关键节点的日志出口 / the log sink for key nodes like enqueue or send failure */
  log?: (message: string) => void;
}

export class EventReporter {
  /** 待补报队列：严格 FIFO，保证顺序 / the replay queue: strict FIFO, order preserved */
  private readonly queue: EventFrame[] = [];
  private seq = 0;
  private connected = false;
  private socket: SocketLike | null = null;

  constructor(private readonly options: ReporterOptions = {}) {}

  /** 连接建立时接入 socket 并立即补报积压 / attach a socket on connect and flush the backlog */
  setConnected(socket: SocketLike | null): void {
    this.socket = socket;
    this.connected = socket !== null;
    if (this.connected && this.queue.length > 0) {
      this.options.log?.(`flushing ${this.queue.length} queued event(s) after reconnect`);
    }
    if (this.connected) this.flush();
  }

  /** 排队待补报的事件数 / the number of events queued for replay */
  get pending(): number {
    return this.queue.length;
  }

  /**
   * 上报一条事件：在线时直接发送；离线时入队，重连后按序补报。
   * Reports one event: sent immediately while online; enqueued while offline
   * and replayed in order after reconnection.
   */
  report(name: string, payload?: unknown): { queued: boolean; id: string } {
    const id = this.nextId();
    const frame: EventFrame = { type: 'event', id, name, payload, ts: Date.now() };
    if (!this.connected || !this.socket) {
      this.queue.push(frame);
      this.options.log?.(`offline: event ${name}(${id}) queued (${this.queue.length} pending)`);
      return { queued: true, id };
    }
    this.send(frame);
    return { queued: false, id };
  }

  /**
   * 把队列按原顺序逐条补发（发送成功即出队；socket 异步故障由连接层以
   * 重新入队收场，这里保持顺序不变）。
   * Replays the queue in its original order (a successful send dequeues; an
   * async socket failure is the connection layer's problem and leaves the
   * order untouched).
   */
  flush(): void {
    if (!this.socket) return;
    while (this.queue.length > 0) {
      const frame = this.queue[0];
      try {
        this.send(frame);
      } catch (error) {
        // 同步发送失败：留在队首，等下次重连补报 / a sync send failure: keep it at the head for the next reconnect
        this.options.log?.(`flush failed for event ${frame.id}: ${String(error)}`);
        return;
      }
      this.queue.shift();
    }
  }

  /** 发送单条事件报文 / sends one event frame */
  private send(frame: EventFrame): void {
    this.socket!.send(serializeClientFrame(frame));
  }

  /** 默认 id：binder-1、binder-2…（单调递增，补报对账友好）/ default ids: evt-1, evt-2, … (monotonic) */
  private nextId(): string {
    const next = this.options.nextId ?? (() => `evt-${++this.seq}`);
    return next();
  }
}
