/**
 * 连接层:WebSocket 长连接生命周期 + CmsBridgeService 门面。
 * 状态机:idle → connecting → connected;断线 → reconnecting(退避重连);
 * 凭证失效 → awaiting-credential(停靠);卸载 → disposed。
 * The connection layer: the WebSocket lifecycle plus the CmsBridgeService
 * facade. State machine: idle → connecting → connected; drop → reconnecting
 * (backoff); invalid credential → awaiting-credential; unload → disposed.
 */

import type { Context } from '@deepseek-ai/cordis';
import { Service } from '@deepseek-ai/cordis';
import { Dispatcher } from './dispatcher.js';
import type { BridgeState, BridgeStatus, SocketFactory, SocketLike } from './protocol.js';
import { CREDENTIAL_INVALID, CmsBridge, isCredentialFailure, parseServerFrame, serializeClientFrame } from './protocol.js';
import { EventReporter } from './reporter.js';

/** 事件契约:状态变更广播。@mode emit(纯通知) */
/** The event contract: status-change broadcasts. @mode emit (notification only). */
declare module '@deepseek-ai/cordis' {
    interface Events {
        'cms-bridge/status': (status: BridgeStatus) => void;
    }
}

/** 节点身份:随连接上报给 cms,可在 Web UI 自定义 / the node identity: reported to cms on connect, editable in the Web UI */
export interface NodeIdentity {
  /** 稳定 uuid;首次启动自动生成 / stable uuid; auto-generated on first boot */
  nodeId: string;
  nodeName: string;
  nodeDescription: string;
  /** 图标:emoji、短字符或图片 URL / icon: an emoji, a short glyph or an image URL */
  nodeIcon: string;
}

/** 连接层配置(归一化后)/ the normalized connection-layer config */
export interface ConnectionConfig extends NodeIdentity {
  url: string;
  token: string;
  commandTimeoutMs: number;
  reconnect: { initialDelayMs: number; maxDelayMs: number; factor: number };
  /** 视为凭证失效的 close code / close codes treated as credential failures */
  credentialCloseCodes: number[];
}

/** 身份上报事件名 / the identity report event name */
export const IDENTITY_EVENT = 'node.identity';

/** 连接管理器:收发、重连、凭证失效停试、状态快照 / owns send/receive, reconnection, credential parking and status */
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
   * 设备 ID:由 @veren/device-id 解析的稳定机器标识;解析完成前为空字符串。
   * The device id: the stable machine identifier resolved by
   * @veren/device-id; an empty string until resolution finishes.
   */
  deviceId = '';

  /** 启动首次连接 / starts the first connection attempt */
  start(): void {
    this.open('connecting');
  }

  /** 当前状态快照(可观测);node 携带身份供 Web UI 展示 / the status snapshot; node carries the identity for the Web UI */
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
   * 更新身份:改内存配置;连接中立即重新上报一次(离线时入队自动补报)。
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
   * 换新凭证:仅当处于等待重配置状态时触发重连(P3 的恢复路径)。
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

  /** 逆序清理:停定时器、关 socket、落 disposed 状态 / cleanup: stop timers, close the socket, mark disposed */
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

  /** 连接成功:归零重试计数,接入上报器,上报身份并补报积压 / on open: reset attempts, announce identity and flush the backlog */
  private onOpen(socket: SocketLike): void {
    if (this.disposed || this.socket !== socket) return;
    this.attempts = 0;
    this.connectedAt = Date.now();
    this.lastError = null;
    this.setState('connected');
    this.log('info', 'connected');
    this.reporter.setConnected(socket);
    // 每次连接成功都上报一次身份(设备 ID + 节点身份;离线期间产生的上报按序补报)
    // Announce the identity on every successful connect (device id + node
    // identity; offline reports replay in order automatically).
    this.reporter.report(IDENTITY_EVENT, { ...this.reportIdentity() });
  }

  /**
   * 断线:凭证失效 close code 停试停靠,其余退避重连;仅当前 socket 的关闭生效
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

  /** 收到服务端报文:指令交给分发器并把回执发回去 / on frame: dispatch commands and send results back */
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
      // 服务端以应用层报文拒绝凭证:先脱手 socket 再 close,否则随之而来的
      // onClose 会被当成普通断线再排一次重连。
      // An app-level credential rejection: detach the socket before closing —
      // otherwise the resulting onClose reads as a normal drop.
      this.lastError = frame.message ?? CREDENTIAL_INVALID;
      this.setState('awaiting-credential');
      const socket = this.socket;
      this.socket = null;
      this.reporter.setConnected(null);
      socket?.close(4000);
      this.log('error', `credential rejected by server: ${this.lastError}; parked`);
      return;
    }
    // event_ack 等其余报文当前无消费方,记录即可 / no consumer for event_ack yet; just log
    this.log('debug', `frame handled: ${frame.type}`);
  }

  /** 指数退避安排重连;退避到点发起新尝试(状态回到 connecting) */
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

  /** 状态变更:留痕并广播 / on state change: log and broadcast locally */
  private setState(state: BridgeState): void {
    if (this.state === state) return;
    this.state = state;
    this.ctx.emit('cms-bridge/status', this.status());
  }

  /**
   * 纯文本日志出口:dispose 阶段绕过可能失效的 ctx 代理直读 logger。 The plain-text log sink: dispose runs where the ctx proxy may be gone; read the logger directly.
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
 * 对外服务门面:其他插件注入 CmsBridge 令牌即可注册 action、上报事件、查询
 * 运行状态、更换凭证与更新节点身份。构造即注册为 'cmsBridge' 服务。
 * The public facade: other plugins inject the CmsBridge token to register
 * actions, report events, read status, rotate the credential and update the
 * node identity. Constructing registers the 'cmsBridge' service.
 */
export class CmsBridgeService extends Service {
  constructor(ctx: Context, readonly manager: ConnectionManager) {
    super(ctx, CmsBridge);
  }

  /** 注册一个 action 映射 / declares one action mapping */
  registerAction(action: string, entry: Parameters<Dispatcher['register']>[1]): void {
    this.manager.dispatcher.register(action, entry);
    this.ctx.logger.info('cms-bridge: action registered: %s', action);
  }

  /** 注销一个 action 映射 / removes one action mapping */
  unregisterAction(action: string): boolean {
    return this.manager.dispatcher.unregister(action);
  }

  /** 主动上报一条事件(断线自动补报)/ reports one event (auto-replayed when offline) */
  report(name: string, payload?: unknown): { queued: boolean; id: string } {
    return this.manager.reporter.report(name, payload);
  }

  /** 运行状态快照 / the runtime status snapshot */
  status(): BridgeStatus {
    return this.manager.status();
  }

  /** 更换凭证(等待重配置状态下会自动恢复连接)/ applies a new credential (auto-resumes from the parked state) */
  setCredential(token: string): void {
    this.manager.setCredential(token);
  }

  /** 当前节点身份 / the current node identity */
  identity(): NodeIdentity {
    return this.manager.identity();
  }

  /** 更新节点身份(连接中立即重新上报)/ updates the node identity (re-reports immediately while connected) */
  setIdentity(identity: NodeIdentity): void {
    this.manager.setIdentity(identity);
  }

  /** 只读配置视图 / the readonly config view */
  connectionConfig(): Readonly<ConnectionConfig> {
    return this.manager.connectionConfig;
  }
}
