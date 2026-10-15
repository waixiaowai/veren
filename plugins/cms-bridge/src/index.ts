/**
 * @veren/cms-bridge —— cms 长连接桥接插件:标准 Cordis 插件模块。
 *
 * @veren/cms-bridge — the CMS long-connection bridge plugin: a standard Cordis
 * plugin module.
 *
 * 模块面:name(DeviceId 之外的依赖见 inject)/ Config(schemasty)/ apply。
 * 连接层在 ./connection.ts,指令分发在 ./dispatcher.ts,事件上报在
 * ./reporter.ts,Web UI 宿主 API 在 ./web.ts。
 * Module surface: name / Config / apply. The connection layer lives in
 * ./connection.ts, command dispatch in ./dispatcher.ts, event reporting in
 * ./reporter.ts and the Web UI host API in ./web.ts.
 */

import { randomUUID } from 'node:crypto';
import type { Context } from '@deepseek-ai/cordis';
import WebSocket from 'ws';
import z from '@deepseek-ai/schemastery';
import { DeviceIdToken } from '@veren/device-id';
import { getOrThrow } from '@veren/core';
import { ConnectionManager, CmsBridgeService } from './connection.js';
import type { ConnectionConfig } from './connection.js';
import { Dispatcher } from './dispatcher.js';
import { registerHostActions } from './host-actions.js';
import { EventReporter } from './reporter.js';
import type { BridgeStatus, SocketFactory } from './protocol.js';
import { CmsBridge } from './protocol.js';
import { registerWebApi } from './web.js';

export type { BridgeState, BridgeStatus, ActionEntry, ActionHandler, SocketLike } from './protocol.js';
export { CmsBridge, CREDENTIAL_INVALID, UNKNOWN_ACTION, TIMEOUT, INVALID_PAYLOAD, HANDLER_ERROR, BAD_FRAME } from './protocol.js';
export { CmsBridgeService } from './connection.js';
export type { NodeIdentity } from './connection.js';
export { IDENTITY_EVENT } from './connection.js';
export { Dispatcher } from './dispatcher.js';
export { EventReporter } from './reporter.js';
export { registerWebApi } from './web.js';

/** 服务令牌:同时作为插件显示名 / the service token, doubling as the plugin display name */
export { CmsBridge as name };

/** 依赖:设备 ID + 宿主 workspace/session 控制器(action 桥的服务面;宿主缺任一 services 时插件 pending)/ requires the device id plus the host workspace/session controllers backing the action bridge */
export const inject = [DeviceIdToken, 'workspaceRegistry', 'workspaceController', 'sessionController'] as const;

/** 本插件提供 CmsBridge 服务 / this plugin provides the CmsBridge service */
export const provide = [CmsBridge] as const;

/** 归一化配置 / the normalized plugin config */
export interface Config extends Omit<ConnectionConfig, 'credentialCloseCodes'> {
  /** 视为凭证失效的 WebSocket close code(如 4001/4401)/ close codes meaning an invalid credential */
  credentialCloseCodes: number[];
}

/** 配置 schema:经 ctx.plugin 装载时自动校验并补全缺省值 / the config schema, validated and default-filled by ctx.plugin */
export const Config: z<Config> = z.object({
  url: z.string().required(),
  token: z.string().role('secret').default(''),
  nodeId: z.string().default(''),
  nodeName: z.string().default('CMS Bridge Node'),
  nodeDescription: z.string().default(''),
  nodeIcon: z.string().default('🛰️'),
  commandTimeoutMs: z.number().default(30_000),
  reconnect: z.object({
    initialDelayMs: z.number().min(1).default(1_000),
    maxDelayMs: z.number().min(1).default(30_000),
    factor: z.number().min(1).default(2),
  }),
  credentialCloseCodes: z.array(z.number()).default([4001, 4401]),
}) as z<Config>;

/** 默认传输:Node 端 ws 库 / the default transport: the ws library on Node */
export const wsSocketFactory: SocketFactory = (url, headers) => {
  const socket = new WebSocket(url, { headers });
  return {
    send: (text) => socket.send(text),
    close: (code) => socket.close(code),
    onOpen: (cb) => socket.once('open', () => cb()),
    onClose: (cb) => socket.once('close', (code) => cb(code)),
    onMessage: (cb) => socket.on('message', (data) => cb(String(data))),
    onError: (cb) => socket.once('error', (err) => cb(err instanceof Error ? err : new Error(String(err)))),
  };
};

/**
 * 插件装配:nodeId 留空时生成稳定 uuid;创建连接层并提供 CmsBridge 服务;
 * 宿主有 webServer 时另挂 /cms-bridge/api/* 供 Web UI 使用;卸载逆序清理。
 * Plugin assembly: mints a stable uuid when nodeId is empty; wires the
 * connection layer, provides the CmsBridge service and mounts
 * /cms-bridge/api/* when the host exposes a webServer; cleanup runs in
 * reverse order on unload.
 */
export const apply = (ctx: Context, config: Config): void => {
  if (!config.nodeId) config.nodeId = randomUUID();
  const service = wire(ctx, config, wsSocketFactory, getOrThrow(ctx, DeviceIdToken).id);
  registerWebApi(ctx, service);
};

/**
 * 可注入传输的装配内部实现(测试用假 socket 走这里)。effect 的 setup 同步
 * 执行、其返回值才是卸载 disposer:dispose 必须放在 disposer 里,放在 setup
 * 会被 Cordis 视为「注册即释放」而立刻拆掉连接层。
 * The internal assembly with an injectable transport (tests pass fake
 * sockets). fiber.effect's setup runs synchronously and its return value is
 * the unload disposer: manager.dispose() must live in the disposer — calling
 * it in setup makes Cordis treat the effect as register-then-release.
 */
export function wire(ctx: Context, config: ConnectionConfig, createSocket: SocketFactory, deviceId = ''): CmsBridgeService {
  const dispatcher = new Dispatcher({
    commandTimeoutMs: config.commandTimeoutMs,
    onStart: (action) => ctx.logger.info('cms-bridge: command start: %s', action),
    onTimeout: (action, ms) => ctx.logger.error('cms-bridge: command timeout: %s after %dms', action, ms),
  });
  const reporter = new EventReporter({
    log: (message) => ctx.logger.info('cms-bridge: %s', message),
  });
  const manager = new ConnectionManager(ctx, config, createSocket, dispatcher, reporter);
  manager.deviceId = deviceId;
  const service = new CmsBridgeService(ctx, manager);
  registerHostActions(ctx, (action, entry) => service.registerAction(action, entry));
  ctx.effect(() => () => {
    manager.dispose();
  }, CmsBridge);
  manager.start();
  return service;
}

/** 状态快照类型再导出,方便消费方 / re-exported status snapshot type for consumers */
export type { BridgeStatus as Status };
