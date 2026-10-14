import { Context } from '@deepseek-ai/cordis';
import { wire } from './src/index';
import type { SocketFactory, SocketLike } from './src/protocol';

class FakeSocket implements SocketLike {
  sent: string[] = [];
  private cbs = { open: [] as Array<() => void>, close: [] as Array<(c: number) => void>, message: [] as Array<(t: string) => void> };
  send(text: string): void { this.sent.push(text); }
  close(code?: number): void { for (const cb of this.cbs.close) cb(code ?? 1000); }
  onOpen(cb: () => void): void { this.cbs.open.push(cb); }
  onClose(cb: (code: number) => void): void { this.cbs.close.push(cb); }
  onMessage(cb: (text: string) => void): void { this.cbs.message.push(cb); }
  onError(): void {}
}

const sockets: FakeSocket[] = [];
const factory: SocketFactory = () => { const s = new FakeSocket(); sockets.push(s); return s; };
const ctx = new Context();
const fiber = ctx.plugin({ name: 'cmsBridgeTest', inject: [], apply: (context, config) => { console.log('apply entered'); wire(context, config, factory); } }, {
  url: 'wss://cms.example/link',
  token: 'secret-token-123',
  commandTimeoutMs: 200,
  reconnect: { initialDelayMs: 5, maxDelayMs: 20, factor: 2 },
  credentialCloseCodes: [4001, 4401],
} as any);
await fiber;
console.log('fiber state:', fiber.state);
console.log('sockets:', sockets.length);
console.log('ctx.get:', typeof ctx.get('cmsBridge'));
