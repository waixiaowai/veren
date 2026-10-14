/**
 * @veren/cms-bridge —— cms 长连接桥接插件：标准 Cordis 插件模块。
 *
 * @veren/cms-bridge — the CMS long-connection bridge plugin: a standard Cordis
 * plugin module.
 *
 * 插件约定（同 @veren/commander-*）：
 * Plugin convention (same as @veren/commander-*):
 *   - name    服务令牌（兼作插件显示名）/ the service token (doubling as the
 *             plugin display name)
 *   - inject  依赖的服务令牌（本插件无）/ required service tokens (none here)
 *   - Config  用 @deepseek-ai/schemastery 定义的插件配置 schema / the plugin
 *             config schema defined with @deepseek-ai/schemastery
 *   - apply   装配函数：建立连接层并提供 CmsBridge 服务 / wires the connection
 *             layer and provides the CmsBridge service
 */

import type { Context } from '@deepseek-ai/cordis';
import WebSocket from 'ws';
import z from '@deepseek-ai/schemastery';
import { ConnectionManager, CmsBridgeService } from './connection.js';
import type { ConnectionConfig } from './connection.js';
import { Dispatcher } from './dispatcher.js';
import { EventReporter } from './reporter.js';
import type { BridgeStatus, SocketFactory } from './protocol.js';
import { CmsBridge } from './protocol.js';

export type { BridgeState, BridgeStatus, ActionEntry, ActionHandler, SocketLike } from './protocol.js';
export { CmsBridge, CREDENTIAL_INVALID, UNKNOWN_ACTION, TIMEOUT, INVALID_PAYLOAD, HANDLER_ERROR, BAD_FRAME } from './protocol.js';
export { CmsBridgeService } from './connection.js';
export { Dispatcher } from './dispatcher.js';
export { EventReporter } from './reporter.js';

/** 服务令牌：同时作为插件显示名 / the service token, doubling as the plugin display name */
export { CmsBridge as name };

/** 本插件不依赖其他能力 / this plugin injects nothing */
export const inject = [] as const;

/** 本插件提供 CmsBridge 服务 / this plugin provides the CmsBridge service */
export const provide = [CmsBridge] as const;

/** 归一化配置 / the normalized plugin config */
export interface Config extends Omit<ConnectionConfig, 'credentialCloseCodes'> {
  /** 视为凭证失效的 WebSocket close code（如 4001/4401）/ close codes meaning an invalid credential */
  credentialCloseCodes: number[];
}

/**
 * 插件配置 schema：经 ctx.plugin 装载时自动校验并补全缺省值。
 * The plugin config schema: validated and default-filled by ctx.plugin.
 */
export const Config: z<Config> = z.object({
  url: z.string().required(),
  token: z.string().role('secret').default(''),
  commandTimeoutMs: z.number().default(30_000),
  reconnect: z.object({
    initialDelayMs: z.number().min(1).default(1_000),
    maxDelayMs: z.number().min(1).default(30_000),
    factor: z.number().min(1).default(2),
  }),
  credentialCloseCodes: z.array(z.number()).default([4001, 4401]),
}) as z<Config>;

/** 默认传输：Node 端 ws 库 / the default transport: the ws library on Node */
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
 * 插件装配：创建分发器/上报器/连接管理器，提供 CmsBridge 服务；宿主有
 * webServer 时另挂 /cms-bridge/api/* 供 Web UI 使用；卸载时逆序清理。
 * Plugin assembly: creates the dispatcher, reporter and connection manager,
 * provides the CmsBridge service; when the host exposes a webServer, also
 * mounts /cms-bridge/api/* for the Web UI; cleanup runs in reverse order.
 */
export const apply = (ctx: Context, config: Config): void => {
  const service = wire(ctx, config, wsSocketFactory);
  registerWebApi(ctx, service);
};

/**
 * Web UI 的宿主侧 API：GET /cms-bridge/api/status 返回运行状态快照；
 * POST /cms-bridge/api/credential 更新 API Key —— 走 configEditor 持久化到
 * profile patch（经 Loader 热更，插件自动用新凭证重连）；configEditor 不可用
 * 时退化为仅本次运行的 setCredential。宿主无 webServer（如纯 CLI 装配）时
 * 静默跳过。
 * The Web UI's host-side API: GET /cms-bridge/api/status returns the runtime
 * status snapshot; POST /cms-bridge/api/credential rotates the API key —
 * persisted through configEditor into the profile patch (hot-reloaded via the
 * Loader, so the plugin reconnects with the new credential); when configEditor
 * is unavailable it degrades to a run-scoped setCredential. Skips silently on
 * hosts without a webServer (e.g. a plain CLI assembly).
 */
export function registerWebApi(ctx: Context, service: CmsBridgeService): void {
  // 非严格探测:宿主没挂 webServer 时返回 undefined 而不是抛「without inject」,
  // 让插件在纯 CLI 等无 Web 宿主上也能装载(fails soft here, logs loud below)。
  // Non-strict probe: hosts without a webServer yield undefined instead of the
  // "without inject" throw, so the plugin still loads on plain CLI hosts.
  const webServer = (ctx as unknown as { reflect: { get(name: string, strict: boolean): unknown } })
    .reflect.get('webServer', false) as
    | { register(route: { kind: 'exact'; path: string; handler: (req: unknown, res: unknown) => void | Promise<void> }): () => void }
    | undefined;
  if (!webServer) {
    ctx.logger.warn('cms-bridge: no webServer on this host; web UI API skipped');
    return;
  }
  const json = (res: unknown, code: number, body: unknown): void => {
    const r = res as { writeHead(c: number, h: Record<string, string>): unknown; end(b: string): unknown };
    r.writeHead(code, { 'content-type': 'application/json' });
    r.end(JSON.stringify(body));
  };
  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: '/cms-bridge/api/status',
    handler: (_req, res) => json(res, 200, service.status()),
  }), 'cms-bridge/api-status');
  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: '/cms-bridge/api/credential',
    handler: async (req, res) => {
      try {
        const token = await readBodyToken(req);
        await persistCredential(ctx, service, token);
        ctx.logger.info('cms-bridge: credential rotated via web UI');
        json(res, 200, { ok: true, status: service.status() });
      } catch (error) {
        json(res, 400, { ok: false, message: error instanceof Error ? error.message : String(error) });
      }
    },
  }), 'cms-bridge/api-credential');
}

/** 读取并校验 POST body 里的 { token } / reads and validates { token } from the POST body */
async function readBodyToken(req: unknown): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of (req as AsyncIterable<Buffer>)) {
    chunks.push(chunk);
    if (chunks.reduce((n, c) => n + c.length, 0) > 4096) throw new Error('body too large');
  }
  const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { token?: unknown };
  if (typeof body.token !== 'string' || body.token.length === 0) throw new Error('token required');
  return body.token;
}

/** 持久化换凭证：configEditor 可用则写 profile patch，否则仅本进程生效 / persists the rotation: profile patch via configEditor, else run-scoped */
async function persistCredential(ctx: Context, service: CmsBridgeService, token: string): Promise<void> {
  const editor = (ctx as unknown as { reflect: { get(name: string, strict: boolean): unknown } })
    .reflect.get('configEditor', false) as
    | {
        entries(): Array<Record<string, unknown>>;
        edit(entry: Record<string, unknown>, change: (current: Record<string, unknown>) => Record<string, unknown>): Promise<void>;
      }
    | undefined;
  const entry = editor?.entries().find((e) => e.name === '@veren/cms-bridge' || e.id === 'cms-bridge');
  if (!editor || !entry) {
    service.setCredential(token);
    return;
  }
  await editor.edit(entry, (current) => ({ ...current, token }));
}


/**
 * 可注入传输的装配内部实现（测试用假 socket 走这里）。
 * The internal assembly with an injectable transport (tests pass fake sockets).
 */
export function wire(ctx: Context, config: ConnectionConfig, createSocket: SocketFactory): CmsBridgeService {
  const dispatcher = new Dispatcher({
    commandTimeoutMs: config.commandTimeoutMs,
    onStart: (action) => ctx.logger.info('cms-bridge: command start: %s', action),
    onTimeout: (action, ms) => ctx.logger.error('cms-bridge: command timeout: %s after %dms', action, ms),
  });
  const reporter = new EventReporter({
    log: (message) => ctx.logger.info('cms-bridge: %s', message),
  });
  const manager = new ConnectionManager(ctx, config, createSocket, dispatcher, reporter);
  const service = new CmsBridgeService(ctx, manager);
  // 卸载时逆序清理：fiber.effect 的注册体（setup）同步执行、其返回值才是
  // 卸载时调用的 disposer。因此 setup 只登记（这里什么都不做），真正停连接
  // 的 manager.dispose() 放进 disposer —— 若在 setup 里调用 dispose()，
  // Cordis 会把该 effect 视为「注册即释放」，连接层会被立刻拆掉。
  // Cleanup in reverse order: fiber.effect's body (setup) runs synchronously
  // and its return value is the disposer called on unload. So setup does
  // nothing and manager.dispose() lives in the disposer — calling dispose()
  // inside setup would make Cordis treat the effect as "register then release"
  // and tear the connection layer down immediately.
  ctx.effect(() => () => {
    manager.dispose();
  }, CmsBridge);
  manager.start();
  return service;
}

/** 状态快照类型再导出，方便消费方 / re-exported status snapshot type for consumers */
export type { BridgeStatus as Status };
