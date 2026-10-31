/**
 * 连接层：WebSocket 长连接生命周期。
 * 状态机：idle → connecting → connected；断线 → reconnecting（退避重连）；
 * 凭证失效 → awaiting-credential（停靠）；卸载 → disposed。
 * The connection layer: the WebSocket lifecycle. State machine: idle →
 * connecting → connected; drop → reconnecting (backoff); invalid credential →
 * awaiting-credential (parked); unload → disposed.
 *
 * 身份事实在 ./identity.ts，对外门面在 ./service.ts；本模块再导出它们，因此
 * `./connection.js` 的既有导入面不变。
 * Identity facts live in ./identity.ts and the public facade in ./service.ts;
 * this module re-exports both so the import surface of `./connection.js` is
 * unchanged.
 */

import type { Context, LoggerType } from '@deepseek-ai/cordis';
import type { BridgeState, BridgeStatus, SocketFactory, SocketLike } from './protocol.js';
import { CREDENTIAL_INVALID, isCredentialFailure, parseServerFrame, serializeClientFrame } from './protocol.js';
import type { Dispatcher } from './dispatcher.js';
import type { EventReporter } from './reporter.js';
import { IDENTITY_EVENT, type NodeIdentity } from './identity.js';

/** 事件契约：状态变更广播。@mode emit(纯通知) */
/** The event contract: status-change broadcasts. @mode emit (notification only). */
declare module '@deepseek-ai/cordis' {
  interface Events {
    'cms-bridge/status': (status: BridgeStatus) => void;
  }
}

export { IDENTITY_EVENT, type NodeIdentity } from './identity.js';
export { CmsBridgeService } from './service.js';

/** 连接层配置(归一化后)/ the normalized connection-layer config */
export interface ConnectionConfig extends NodeIdentity {
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
  /** 凭证失效 close code 集合 / close codes meaning credential failure */
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

  /**
   * 设备 ID：由 @veren/device-id 解析的稳定机器标识；解析完成前为空字符串。
   * The device id: the stable machine identifier resolved by
   * @veren/device-id; an empty string until resolution finishes.
   */
  deviceId = '';

  /** 启动首次连接 / starts the first connection attempt */
  start(): void {
    this.open('connecting');
  }

  /** 当前状态快照(可观测)；node 携带身份供 Web UI 展示 / the status snapshot; node carries the identity for the Web UI */
  status(): BridgeStatus {
    return {
      state: this.state,
      deviceId: this.deviceId,
      credentialFingerprint: this.config.token ? `${this.config.token.slice(0, 4)}…(${this.config.token.length})` : null,
      reconnectAttempts: this.attempts,
      lastError: this.lastError,
      connectedAt: this.connectedAt,
      pendingEvents: this.reporter.pending,
      inflightCommands: this.dispatcher.inflight,
      node: this.identity(),
    };
  }

  /** 当前节点身份 / the current node identity */
  identity(): NodeIdentity {
    const { nodeId, nodeName, nodeDescription, nodeIcon } = this.config;
    return { nodeId, nodeName, nodeDescription, nodeIcon };
  }

  /** 只读配置视图(url/token 供上传代理取源与凭证)/ a readonly config view (url/token for the upload proxy) */
  get connectionConfig(): Readonly<ConnectionConfig> {
    return this.config;
  }

  /**
   * 更新身份：改内存配置；连接中立即重新上报一次(离线时入队自动补报)。
   * Updates the identity in memory; while connected it re-reports at once
   * (queued automatically when offline).
   */
  setIdentity(identity: NodeIdentity): void {
    this.config = { ...this.config, ...identity };
    this.log('info', `identity updated: ${identity.nodeName} (${identity.nodeId})`);
    if (this.state === 'connected') this.reporter.report(IDENTITY_EVENT, { ...this.reportIdentity() });
  }

  /** 组装身份上报载荷(设备 ID + 节点身份)/ composes the identity report payload (device id + node identity) */
  reportIdentity(): Record<string, unknown> {
    return { deviceId: this.deviceId, ...this.identity() };
  }

  /**
   * 换新凭证：仅当处于等待重配置状态时触发重连(P3 的恢复路径)。
   * Applies a fresh credential; reconnects only from the awaiting-credential
   * parked state (the recovery path of P3).
   */
  setCredential(token: string): void {
    this.config = { ...this.config, token };
    this.log('info', `credential updated (fingerprint ${this.status().credentialFingerprint})`);
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

  /** 连接成功：归零重试计数，接入上报器，上报身份并补报积压 / on open: reset attempts, announce identity and flush the backlog */
  private onOpen(socket: SocketLike): void {
    if (this.disposed || this.socket !== socket) return;
    this.attempts = 0;
    this.connectedAt = Date.now();
    this.lastError = null;
    this.setState('connected');
    this.log('info', 'connected');
    this.reporter.setConnected(socket);
    // 每次连接成功都上报一次身份(设备 ID + 节点身份；离线期间产生的上报按序补报)
    // Announce the identity on every successful connect (device id + node
    // identity; offline reports replay in order automatically).
    this.reporter.report(IDENTITY_EVENT, { ...this.reportIdentity() });
  }

  /**
   * 断线：凭证失效 close code 停试停靠，其余退避重连；仅当前 socket 的关闭生效
   * (迟到/被顶替的 onClose 忽略)。 On close: a credential close code parks
   * the bridge; only the current socket's close counts (late/replaced ones
   * are ignored so no reconnect is scheduled twice).
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
      this.dispatchCommand(frame.id, frame.action, frame.payload);
      return;
    }
    if (frame.type === 'error' && isCredentialFailure(frame.code, this.credentialCodes)) {
      this.parkCredential(frame.message ?? CREDENTIAL_INVALID);
      return;
    }
    // event_ack 等其余报文当前无消费方，记录即可 / no consumer for event_ack yet; just log
    this.log('debug', `frame handled: ${frame.type}`);
  }

  /** 指令帧：交给分发器并把回执发回去 / command frame: dispatch and send the result back */
  private dispatchCommand(id: string, action: string, payload: unknown): void {
    this.log('info', `command ${id} received: ${action}`);
    void this.dispatcher.dispatch(id, action, payload).then((result) => {
      this.log('info', `command ${id} ${result.ok ? 'succeeded' : `failed (${result.code})`}`);
      this.socket?.send(serializeClientFrame(result));
    });
  }

  /**
   * 服务端以应用层报文拒绝凭证：先脱手 socket 再 close，否则随之而来的
   * onClose 会被当成普通断线再排一次重连。
   * An app-level credential rejection: detach the socket before closing —
   * otherwise the resulting onClose reads as a normal drop.
   */
  private parkCredential(reason: string): void {
    this.lastError = reason;
    this.setState('awaiting-credential');
    const socket = this.socket;
    this.socket = null;
    this.reporter.setConnected(null);
    socket?.close(4000);
    this.log('error', `credential rejected by server: ${this.lastError}; parked`);
  }

  /** 指数退避安排重连；退避到点发起新尝试(状态回到 connecting) */
  /** schedules a reconnect with exponential backoff; a fresh attempt returns the state to connecting */
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
      this.open('connecting');
    }, delay);
  }

  /** 状态变更：留痕并广播 / on state change: log and broadcast locally */
  private setState(state: BridgeState): void {
    if (this.state === state) return;
    this.state = state;
    this.ctx.emit('cms-bridge/status', this.status());
  }

  /**
   * 纯文本日志出口：dispose 阶段绕过可能失效的 ctx 代理直读 logger。 The plain-text log sink: dispose runs where the ctx proxy may be gone; read the logger directly.
   *
   * `ctx.get('logger', false)` 即 cordis 的非严格读取：服务不在场时给 undefined
   * 而不是抛 without-inject，类型仍来自声明合并（不再用 Record 索引强转）。
   * `ctx.get('logger', false)` is cordis's non-strict read: undefined instead of a
   * without-inject throw, still typed by the declaration merge (no Record cast).
   */
  private log(type: LoggerType, message: string): void {
    const logger = this.ctx.get('logger', false);
    if (logger === undefined) {
      console[type === 'debug' ? 'log' : type](`[cms-bridge] ${message}`);
      return;
    }
    logger[type]('cms-bridge: %s', message);
  }
}
