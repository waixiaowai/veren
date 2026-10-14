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

import { randomUUID } from 'node:crypto';
import type { Context } from '@deepseek-ai/cordis';
import WebSocket from 'ws';
import z from '@deepseek-ai/schemastery';
import { ConnectionManager, CmsBridgeService } from './connection.js';
import type { ConnectionConfig, NodeIdentity } from './connection.js';
import { Dispatcher } from './dispatcher.js';
import { EventReporter } from './reporter.js';
import type { BridgeStatus, SocketFactory } from './protocol.js';
import { CmsBridge } from './protocol.js';

export type { BridgeState, BridgeStatus, ActionEntry, ActionHandler, SocketLike } from './protocol.js';
export { CmsBridge, CREDENTIAL_INVALID, UNKNOWN_ACTION, TIMEOUT, INVALID_PAYLOAD, HANDLER_ERROR, BAD_FRAME } from './protocol.js';
export { CmsBridgeService } from './connection.js';
export type { NodeIdentity } from './connection.js';
export { IDENTITY_EVENT } from './connection.js';
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
  // nodeId 留空 = 首次启动自动生成稳定 uuid(进程内生效;保存节点信息时持久化)
  // An empty nodeId = a stable uuid is generated on first boot (in-memory;
  // persisted when the identity card is saved).
  if (!config.nodeId) config.nodeId = randomUUID();
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
  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: '/cms-bridge/api/identity',
    handler: async (req, res) => {
      try {
        if ((req as { method?: string }).method === 'POST') {
          const identity = await readBodyIdentity(req);
          await persistIdentity(ctx, service, identity);
          ctx.logger.info('cms-bridge: identity updated via web UI: %s (%s)', identity.nodeName, identity.nodeId);
        }
        json(res, 200, { ok: true, identity: service.identity(), status: service.status() });
      } catch (error) {
        json(res, 400, { ok: false, message: error instanceof Error ? error.message : String(error) });
      }
    },
  }), 'cms-bridge/api-identity');
  // 图标上传代理:浏览器没有 cms 凭证,由节点持 token 把 multipart 原样转发到
  // cms /v1/files(purpose=node.icon, is_public=true),再换公开 CAS URL。
  // The icon upload proxy: the browser holds no cms credential, so the node
  // forwards the multipart body verbatim to cms /v1/files (purpose=node.icon,
  // is_public=true) and exchanges it for the public CAS URL.
  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: '/cms-bridge/api/icon',
    handler: async (req, res) => {
      try {
        const url = await uploadIcon(service, req);
        json(res, 200, { ok: true, url });
      } catch (error) {
        json(res, 502, { ok: false, message: error instanceof Error ? error.message : String(error) });
      }
    },
  }), 'cms-bridge/api-icon');
}

/** 从 ws/wss URL 推导 cms 的 http(s) 源 / derives the cms http(s) origin from the ws/wss URL */
function cmsOrigin(wsUrl: string): string {
  return wsUrl.replace(/^ws/, 'http').replace(/\/v1\/ws.*$/, '');
}

/** 图标大小上限(2MB)/ the icon size cap (2MB) */
const ICON_MAX_BYTES = 2 * 1024 * 1024;

/**
 * 转发图标到 cms 并返回公开 URL:multipart 原样字节转发(带浏览器生成的
 * boundary 头),上传后经 /v1/files/{id}/url 换 /f/ 永久地址。
 * Forwards the icon to cms and returns the public URL: the multipart bytes go
 * through verbatim (with the browser-built boundary header), then
 * /v1/files/{id}/url exchanges the id for the permanent /f/ address.
 */
async function uploadIcon(service: CmsBridgeService, req: unknown): Promise<string> {
  const cfg = service.connectionConfig();
  const origin = cmsOrigin(cfg.url);
  const headers = (req as { headers?: Record<string, string | string[] | undefined> }).headers ?? {};
  const contentType = headers['content-type'];
  if (typeof contentType !== 'string' || !contentType.includes('multipart/form-data')) {
    throw new Error('expected multipart/form-data');
  }
  const body = Buffer.concat(await readRawBody(req, ICON_MAX_BYTES));
  if (body.length === 0) throw new Error('empty body');
  const auth = { authorization: `Bearer ${cfg.token}` };
  const upload = await fetch(`${origin}/v1/files`, {
    method: 'POST',
    headers: { ...auth, 'content-type': contentType },
    body: new Uint8Array(body),
  });
  if (!upload.ok) throw new Error(`cms upload HTTP ${upload.status}: ${(await upload.text()).slice(0, 200)}`);
  const file = (await upload.json()) as { id?: string };
  if (typeof file.id !== 'string') throw new Error('cms upload returned no id');
  const urlRes = await fetch(`${origin}/v1/files/${encodeURIComponent(file.id)}/url`, { headers: auth });
  if (!urlRes.ok) throw new Error(`cms url HTTP ${urlRes.status}`);
  const { url } = (await urlRes.json()) as { url?: string };
  if (typeof url !== 'string' || url === '') throw new Error('cms url endpoint returned no url');
  return url.startsWith('/') ? origin + url : url;
}

/** 读原始请求体(带上限)/ reads the raw request body (with a cap) */
async function readRawBody(req: unknown, cap: number): Promise<Buffer[]> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of (req as AsyncIterable<Buffer>)) {
    total += chunk.length;
    if (total > cap) throw new Error('body too large');
    chunks.push(chunk);
  }
  return chunks;
}

/** 读 JSON body / reads a JSON body */
async function readJsonBody(req: unknown, cap: number): Promise<Record<string, unknown>> {
  return JSON.parse(Buffer.concat(await readRawBody(req, cap)).toString('utf8')) as Record<string, unknown>;
}

/** 读取并校验 POST body 里的节点身份 / reads and validates the identity from a POST body */
async function readBodyIdentity(req: unknown): Promise<NodeIdentity> {
  const body = await readJsonBody(req, 16_384);
  const str = (v: unknown, label: string): string => {
    if (typeof v !== 'string') throw new Error(`${label} must be a string`);
    return v;
  };
  return {
    nodeId: str(body.nodeId, 'nodeId'),
    nodeName: str(body.nodeName, 'nodeName'),
    nodeDescription: typeof body.nodeDescription === 'string' ? body.nodeDescription : '',
    nodeIcon: typeof body.nodeIcon === 'string' && body.nodeIcon !== '' ? body.nodeIcon : '🛰️',
  };
}

/** configEditor 非严格探测 / a non-strict configEditor probe */
function findConfigEditor(ctx: Context): ConfigEditorLike | undefined {
  return (ctx as unknown as { reflect: { get(name: string, strict: boolean): unknown } })
    .reflect.get('configEditor', false) as ConfigEditorLike | undefined;
}

/** configEditor 最小结构面 / the minimal configEditor surface */
interface ConfigEditorLike {
  entries(): Array<Record<string, unknown>>;
  edit(entry: Record<string, unknown>, change: (current: Record<string, unknown>) => Record<string, unknown>): Promise<void>;
}

/**
 * 找本插件在 profile patch 里的行。Entry 是类实例:id 为 getter、包名在
 * options.name;个别条目可能是 Context 代理(JSON.stringify 会触发 without
 * inject 抛错),因此 stringify 只作末位兜底并容错。
 * Finds this plugin's row in the profile patch. An Entry is a class instance
 * (id is a getter, the package name lives in options.name); some entries can
 * be Context proxies where JSON.stringify throws "without inject", so the
 * stringify probe comes last and is failure-tolerant.
 */
function findOwnEntry(editor: ConfigEditorLike): Record<string, unknown> | undefined {
  return editor.entries().find((e) => {
    if (e.id === 'cms-bridge' || e.name === '@veren/cms-bridge') return true;
    const options = e.options as { name?: unknown } | undefined;
    if (options && options.name === '@veren/cms-bridge') return true;
    try {
      return JSON.stringify(e).includes('@veren/cms-bridge');
    } catch {
      return false;
    }
  });
}

/**
 * 持久化身份：configEditor 可用则写 profile patch（Loader 热更后仍是新值）,
 * 再把内存配置同步为最新（无 configEditor 的宿主上至少进程内生效）。
 * Persists the identity: via configEditor into the profile patch when
 * available (the Loader hot-reload keeps it), then syncs the in-memory config
 * so hosts without configEditor still take effect for this run.
 */
async function persistIdentity(ctx: Context, service: CmsBridgeService, identity: NodeIdentity): Promise<void> {
  const editor = findConfigEditor(ctx);
  const entry = editor && findOwnEntry(editor);
  if (editor && entry) await editor.edit(entry, (current) => ({ ...current, ...identity }));
  service.setIdentity(identity);
}

/** 读取并校验 POST body 里的 { token } / reads and validates { token } from the POST body */
async function readBodyToken(req: unknown): Promise<string> {
  const body = await readJsonBody(req, 4096);
  if (typeof body.token !== 'string' || body.token.length === 0) throw new Error('token required');
  return body.token;
}

/** 持久化换凭证：configEditor 可用则写 profile patch，否则仅本进程生效 / persists the rotation: profile patch via configEditor, else run-scoped */
async function persistCredential(ctx: Context, service: CmsBridgeService, token: string): Promise<void> {
  const editor = findConfigEditor(ctx);
  const entry = editor && findOwnEntry(editor);
  if (editor && entry) {
    await editor.edit(entry, (current) => ({ ...current, token }));
    return;
  }
  service.setCredential(token);
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
