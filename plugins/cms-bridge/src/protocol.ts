/**
 * cms-bridge 协议层：报文类型、错误码、令牌与纯函数工具。
 *
 * The cms-bridge protocol layer: frame types, error codes, the service token
 * and pure helpers.
 *
 * 本文件刻意保持「纯」：不依赖 Cordis、不碰网络，方便单测与浏览器侧复用。
 * This file stays pure on purpose: no Cordis, no network, so it is easy to
 * unit-test and reusable outside Node.
 */

import { defineToken } from '@veren/core';
import type { CmsBridgeService } from './connection.js';

/** 服务令牌：插件以该名字注册 CmsBridgeService / the service token; the plugin registers CmsBridgeService under it */
export const CmsBridge = defineToken<CmsBridgeService>('cmsBridge');

// ---------------------------------------------------------------------------
// 错误码 / stable error codes（结构化错误：稳定 code + 机器可读字段）
// ---------------------------------------------------------------------------

/** 未映射/未知 action / an unmapped or unknown action */
export const UNKNOWN_ACTION = 'UNKNOWN_ACTION';
/** payload 未通过声明校验 / the payload failed its declared validation */
export const INVALID_PAYLOAD = 'INVALID_PAYLOAD';
/** 执行超时 / execution exceeded the per-command timeout */
export const TIMEOUT = 'TIMEOUT';
/** 处理器执行抛错 / the handler threw */
export const HANDLER_ERROR = 'HANDLER_ERROR';
/** 收到无法解析的报文 / an unparseable frame arrived */
export const BAD_FRAME = 'BAD_FRAME';
/** 凭证无效（进入等待重配置状态）/ the credential is invalid (parked state) */
export const CREDENTIAL_INVALID = 'CREDENTIAL_INVALID';

/** 结构化失败结果 / a structured failure result */
export interface Failure {
  code: string;
  message: string;
}

// ---------------------------------------------------------------------------
// 报文 / frames
// ---------------------------------------------------------------------------

/** 服务端 → 插件：执行指令 / server → plugin: run a command */
export interface CommandFrame {
  type: 'command';
  id: string;
  action: string;
  payload?: unknown;
}

/** 服务端 → 插件：事件回执（可选，用于对账）/ server → plugin: event ack (optional, for reconciliation) */
export interface EventAckFrame {
  type: 'event_ack';
  id: string;
}

/** 服务端 → 插件：协议级错误 / server → plugin: a protocol-level error */
export interface ErrorFrame {
  type: 'error';
  code: string;
  message?: string;
}

export type ServerFrame = CommandFrame | EventAckFrame | ErrorFrame;

/** 插件 → 服务端：指令回执 / plugin → server: a command result */
export type ResultFrame =
  | { type: 'result'; id: string; ok: true; result?: unknown }
  | ({ type: 'result'; id: string; ok: false } & Failure);

/** 插件 → 服务端：主动上报事件 / plugin → server: an unsolicited event report */
export interface EventFrame {
  type: 'event';
  id: string;
  name: string;
  payload?: unknown;
  ts: number;
}

export type ClientFrame = ResultFrame | EventFrame;

/**
 * 解析一段服务端文本为报文；不合法返回 null（由调用方回传 BAD_FRAME）。
 * Parses one server text frame; null when invalid (caller replies BAD_FRAME).
 */
export function parseServerFrame(text: string): ServerFrame | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null) return null;
  const frame = data as Record<string, unknown>;
  if (frame.type === 'command') {
    if (typeof frame.id !== 'string' || typeof frame.action !== 'string') return null;
    return { type: 'command', id: frame.id, action: frame.action, payload: frame.payload };
  }
  if (frame.type === 'event_ack') {
    if (typeof frame.id !== 'string') return null;
    return { type: 'event_ack', id: frame.id };
  }
  if (frame.type === 'error') {
    if (typeof frame.code !== 'string') return null;
    return { type: 'error', code: frame.code, message: typeof frame.message === 'string' ? frame.message : undefined };
  }
  return null;
}

/** 序列化客户端报文 / serializes a client frame to text */
export function serializeClientFrame(frame: ClientFrame): string {
  return JSON.stringify(frame);
}

/**
 * 判定一个错误 code 是否属于凭证失效（含服务端 error.code 与 close code 两个来源）。
 * Decides whether an error code means an invalid credential (covers both the
 * server error.code and the WebSocket close code sources).
 */
export function isCredentialFailure(code: string, credentialCodes: ReadonlySet<string>): boolean {
  return code === CREDENTIAL_INVALID || credentialCodes.has(code);
}

// ---------------------------------------------------------------------------
// 传输抽象 / transport abstraction（测试可注入假 socket）
// ---------------------------------------------------------------------------

/** 插件视角的最小 socket 能力 / the minimal socket surface from the plugin's view */
export interface SocketLike {
  send(text: string): void;
  close(code?: number): void;
  onOpen(cb: () => void): void;
  onClose(cb: (code: number) => void): void;
  onMessage(cb: (text: string) => void): void;
  onError(cb: (err: Error) => void): void;
}

/** socket 工厂：按 url 与鉴权头建立连接 / creates a socket from a url and auth headers */
export type SocketFactory = (url: string, headers: Record<string, string>) => SocketLike;

// ---------------------------------------------------------------------------
// action 声明 / action declarations（映射表由插件自身声明与校验）
// ---------------------------------------------------------------------------

/** action 处理器：收到指令时执行，返回可序列化结果 / runs on a command; returns a serializable result */
export type ActionHandler = (payload: unknown) => Promise<unknown> | unknown;

/**
 * 单个 action 的映射声明：处理器 + 可选 payload 校验器。
 * 返回 string 时表示校验失败原因（作为 INVALID_PAYLOAD 的 message）。
 *
 * One action's mapping: a handler plus an optional payload validator.
 * A string return means validation failed (used as the INVALID_PAYLOAD message).
 */
export interface ActionEntry {
  handler: ActionHandler;
  validate?: (payload: unknown) => string | null;
}

/** 连接状态机 / the connection state machine */
export type BridgeState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'awaiting-credential' | 'disposed';

/** 运行状态快照（可观测性出口）/ an observability snapshot of the runtime state */
export interface BridgeStatus {
  state: BridgeState;
  /** 当前凭证指纹（前 4 位 + 长度，绝不泄漏原文）/ a credential fingerprint (never the raw token) */
  credentialFingerprint: string | null;
  reconnectAttempts: number;
  lastError: string | null;
  connectedAt: number | null;
  /** 排队待补报的事件数 / the number of events queued for replay */
  pendingEvents: number;
  /** 正在执行的指令数 / the number of commands in flight */
  inflightCommands: number;
}
