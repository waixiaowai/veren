/**
 * 连接层：WebSocket 长连接生命周期 + 对外的 CmsBridgeService 门面。
 *
 * The connection layer: the WebSocket lifecycle plus the public
 * CmsBridgeService facade.
 *
 * 状态机（对应需求 1/2/9）：idle → connecting → connected；
 * 异常断线 → reconnecting（按退避策略自动重连）；凭证失效 → awaiting-credential
 * （停止重试，等待重新配置）；fiber 卸载 → disposed（逆序清理，不泄漏）。
 *
 * The state machine (requirements 1/2/9): idle → connecting → connected; an
 * abnormal drop → reconnecting (automatic backoff); an invalid credential →
 * awaiting-credential (retrying stops until reconfiguration); fiber unload →
 * disposed (cleanup in reverse order, no leaks).
 */

import type { Context } from '@deepseek-ai/cordis';
import { Service } from '@deepseek-ai/cordis';
import { Dispatcher } from './dispatcher.js';
import type { BridgeState, BridgeStatus, SocketFactory, SocketLike } from './protocol.js';
import {
  CREDENTIAL_INVALID,
  CmsBridge,
  isCredentialFailure,
  parseServerFrame,
  serializeClientFrame,
} from './protocol.js';
import { EventReporter } from './reporter.js';

/**
 * 事件契约：状态变更广播。@mode emit（纯通知，无返回值）。
 * The event contract: status-change broadcasts. @mode emit (notification only).
 */
declare module '@deepseek-ai/cordis' {
    interface Events {
        'cms-bridge/status': (status: BridgeStatus) => void;
    }
}
/** 连接层配置（归一化后）/ the normalized connection-layer config */
export interface ConnectionConfig {
  url: string;
  token: string;
  commandTimeoutMs: number;
  reconnect: { initialDelayMs: number; maxDelayMs: number; factor: number };
  /** 视为凭证失效的 close code / close codes treated as credential failures */
  credentialCloseCodes: number[];
}

/** 连接管理器：收发、重连、凭证失效停试、状态快照 / owns send/receive, reconnection, credential parking and status */
export class ConnectionManager {
  private socket: SocketLike | null = null;
  private state: BridgeState = 'idle';
  private attempts = 0;
  private lastError: string | null = null;
  private connectedAt: number | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  /** 凭证失效 cause 之外的错误 close code 集合 / close codes meaning credential failure, plus the generic cause */
  private readonly credentialCodes: ReadonlySet<string>;

  constructor(
    private readonly ctx: Context,
    private config: ConnectionConfig,
    private readonly createSocket: SocketFactory,
    readonly dispatcher: Dispatcher,
    readonly reporter: EventReporter,
  ) {
    this.credentialCodes = new Set(config.credentialCloseCodes.map(String));
  }

  /** 启动首次连接 / starts the first connection attempt */
  start(): void {
    this.open('connecting');
  }

  /** 当前状态快照（可观测）/ the current status snapshot (observability) */
  status(): BridgeStatus {
    return {
      state: this.state,
      credentialFingerprint: this.config.token ? `${this.config.token.slice(0, 4)}…(${this.config.token.length})` : null,
      reconnectAttempts: this.attempts,
      lastError: this.lastError,
      connectedAt: this.connectedAt,
      pendingEvents: this.reporter.pending,
      inflightCommands: this.dispatcher.inflight,
    };
  }

  /**
   * 换新凭证：仅当处于等待重配置状态时触发重连（需求 P3 的恢复路径）。
   * Applies a fresh credential; reconnects only from the awaiting-credential
   * parked state (the recovery path of P3).
   */
  setCredential(token: string): void {
    this.config = { ...this.config, token };
    this.log(`info`, `credential updated (fingerprint ${this.status().credentialFingerprint})`);
    if (this.state === 'awaiting-credential') {
      this.attempts = 0;
      this.open('connecting');
    }
  }

  /** 逆序清理：停定时器、关 socket、落 disposed 状态 / cleanup: stop timers, close the socket, mark disposed */
  dispose(): void {
    this.disposed = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.socket?.close(1000);
    this.socket = null;
    this.reporter.setConnected(null);
    this.state = 'disposed';
    this.log('info', 'connection manager disposed');
  }

  /** 建立连接并挂接事件 / opens a connection and wires its events */
  private open(state: BridgeState): void {
    if (this.disposed) return;
    this.setState(state);
    this.log('info', `connecting to ${this.config.url}`);
    let socket: SocketLike;
    try {
      socket = this.createSocket(this.config.url, this.config.token ? { authorization: `Bearer ${this.config.token}` } : {});
    } catch (error) {
      this.scheduleReconnect(String(error));
      return;
    }
    this.socket = socket;
    socket.onOpen(() => this.onOpen(socket));
    socket.onClose((code) => this.onClose(socket, code));
    socket.onMessage((text) => this.onMessage(text));
    socket.onError((err) => {
      this.lastError = err.message;
      this.log('error', `socket error: ${err.message}`);
    });
  }

  /** 连接成功：归零重试计数，接入上报器并补报积压 / on open: reset attempts, attach the reporter and flush */
  private onOpen(socket: SocketLike): void {
    if (this.disposed || this.socket !== socket) return;
    this.attempts = 0;
    this.connectedAt = Date.now();
    this.lastError = null;
    this.setState('connected');
    this.log('info', 'connected');
    this.reporter.setConnected(socket);
  }

  /**
   * 断线：凭证失效类 close code 停止重试进入等待重配置；其余自动退避重连。
   * 只处理当前 socket 的关闭：已被主动脱手（凭证拒绝）或已被新连接顶替的
   * 迟到 onClose 直接忽略，避免重复排重连。
   * On close: a credential close code parks the bridge; anything else
   * schedules an automatic backoff reconnect. Only the current socket's close
   * counts — a late onClose for a socket we already detached (credential
   * rejection) or replaced (newer connection) is ignored so no reconnect is
   * scheduled twice.
   */
  private onClose(socket: SocketLike, code: number): void {
    if (this.disposed || this.socket !== socket) return;
    this.socket = null;
    this.reporter.setConnected(null);
    this.connectedAt = null;
    this.log('warn', `connection closed (code ${code})`);
    if (isCredentialFailure(String(code), this.credentialCodes)) {
      this.lastError = `credential rejected (close code ${code})`;
      this.setState('awaiting-credential');
      this.log('error', `${this.lastError}; parked, waiting for a new credential`);
      return;
    }
    this.scheduleReconnect(`connection closed (code ${code})`);
  }

  /** 收到服务端报文：指令交给分发器并把回执发回去 / on frame: dispatch commands and send results back */
  private onMessage(text: string): void {
    const frame = parseServerFrame(text);
    if (!frame) {
      this.log('error', `bad frame from server: ${text.slice(0, 200)}`);
      return;
    }
    if (frame.type === 'command') {
      this.log('info', `command ${frame.id} received: ${frame.action}`);
      void this.dispatcher.dispatch(frame.id, frame.action, frame.payload).then((result) => {
        this.log('info', `command ${frame.id} ${result.ok ? 'succeeded' : `failed (${result.code})`}`);
        this.socket?.send(serializeClientFrame(result));
      });
      return;
    }
    if (frame.type === 'error' && isCredentialFailure(frame.code, this.credentialCodes)) {
      // 服务端以应用层报文拒绝凭证：与 close code 同等待遇。先把 socket 脱手
      // 再 close —— 否则随之而来的 onClose 会当成普通断线再排一次重连。
      // An app-level credential rejection: same treatment as a close code.
      // Detach the socket before closing — otherwise the resulting onClose
      // reads as a normal drop and schedules one more reconnect.
      this.lastError = frame.message ?? CREDENTIAL_INVALID;
      this.setState('awaiting-credential');
      const socket = this.socket;
      this.socket = null;
      this.reporter.setConnected(null);
      socket?.close(4000);
      this.log('error', `credential rejected by server: ${this.lastError}; parked`);
      return;
    }
    // event_ack 等其余报文当前无消费方，记录即可 / no consumer for event_ack yet; just log
    this.log('debug', `frame handled: ${frame.type}`);
  }

  /** 指数退避安排重连 / schedules a reconnect with exponential backoff */
  private scheduleReconnect(reason: string): void {
    if (this.disposed || this.retryTimer) return;
    this.lastError = reason;
    this.attempts++;
    const delay = Math.min(
      this.config.reconnect.initialDelayMs * this.config.reconnect.factor ** (this.attempts - 1),
      this.config.reconnect.maxDelayMs,
    );
    this.setState('reconnecting');
    this.log('warn', `reconnect in ${delay}ms (attempt ${this.attempts}): ${reason}`);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      // 退避到点发起新的连接尝试：状态回到 connecting（可观测「正在重试」）
      // The backoff elapsed and a fresh attempt starts: the state returns to
      // connecting (so observers see the retry in progress).
      this.open('connecting');
    }, delay);
  }

  /** 状态变更：留痕并广播给本上下文的其他插件 / on state change: log and broadcast locally */
  private setState(state: BridgeState): void {
    if (this.state === state) return;
    this.state = state;
    this.ctx.emit('cms-bridge/status', this.status());
  }

  /**
   * 纯文本日志出口。
   *
   * 实现要点：dispose() 会在 fiber 卸载（disposer）阶段被调用，此时 context
   * 代理可能已部分失效；因此这里显式绕过 context 代理，只读取已存在的 logger
   * 服务（拿不到就退化为 console），保证 dispose 路径上不产生任何 ctx.effect。
   *
   * The plain-text log sink.
   *
   * Implementation note: dispose() runs during fiber unload (the disposer), by
   * which point the context proxy may be partially torn down; so this
   * deliberately bypasses the proxy and reads the existing logger service (or
   * falls back to console) so the dispose path never allocates a ctx.effect.
   */
  private log(type: 'info' | 'warn' | 'error' | 'debug', message: string): void {
    const logger = (this.ctx as unknown as Record<string, unknown>)['logger'] as
      | { [k in 'info' | 'warn' | 'error' | 'debug']?: (format: string, ...param: unknown[]) => void }
      | undefined;
    const method = logger?.[type];
    if (typeof method === 'function') method.call(logger, 'cms-bridge: %s', message);
    else console[type === 'debug' ? 'log' : type](`[cms-bridge] ${message}`);
  }
}

/**
 * 对外服务门面：其他插件注入 CmsBridge 令牌即可注册 action、上报事件、
 * 查询运行状态与更换凭证。构造即注册为 'cmsBridge' 服务，随 fiber 卸载注销。
 *
 * The public facade: other plugins inject the CmsBridge token to register
 * actions, report events, read the runtime status and rotate the credential.
 * Constructing registers the 'cmsBridge' service; it unregisters with its
 * fiber.
 */
export class CmsBridgeService extends Service {
  constructor(ctx: Context, readonly manager: ConnectionManager) {
    super(ctx, CmsBridge);
  }

  /** 注册一个 action 映射（插件自身声明能执行什么）/ declares one action mapping */
  registerAction(action: string, entry: Parameters<Dispatcher['register']>[1]): void {
    this.manager.dispatcher.register(action, entry);
    this.ctx.logger.info('cms-bridge: action registered: %s', action);
  }

  /** 注销一个 action 映射 / removes one action mapping */
  unregisterAction(action: string): boolean {
    return this.manager.dispatcher.unregister(action);
  }

  /** 主动上报一条事件（断线自动补报）/ reports one event (auto-replayed when offline) */
  report(name: string, payload?: unknown): { queued: boolean; id: string } {
    return this.manager.reporter.report(name, payload);
  }

  /** 运行状态快照 / the runtime status snapshot */
  status(): BridgeStatus {
    return this.manager.status();
  }

  /** 更换凭证（等待重配置状态下会自动恢复连接）/ applies a new credential (auto-resumes from the parked state) */
  setCredential(token: string): void {
    this.manager.setCredential(token);
  }
}
