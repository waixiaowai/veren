/**
 * cms-bridge Web UI 的宿主侧 API:status 快照、credential/identity 持久化
 * (经 configEditor 写 profile patch 并热更)、icon 上传代理与 SSE 状态事件流。
 * 无 webServer 的宿主(纯 CLI)静默跳过。
 *
 * The cms-bridge Web UI host-side API: the status snapshot, credential and
 * identity persistence (configEditor → profile patch, hot-reloaded), the icon
 * upload proxy and the SSE status event stream. Skips silently on hosts
 * without a webServer (plain CLI assemblies).
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Context } from '@deepseek-ai/cordis';
import type { WebServer } from '@deepseek-ai/dsh-host-webserver';
import type { ConfigEditor } from '@deepseek-ai/dsh-config-editor';
import type { CmsBridgeService, NodeIdentity } from './connection.js';
import type { BridgeStatus } from './protocol.js';

/**
 * 非严格读取宿主服务：`ctx.get` 缺失时返回 undefined 而不是抛 without-inject，
 * 正是这里要的「宿主没有 webServer/configEditor 就静默降级」语义。
 * 类型来自声明合并，因此没有影子结构面、也没有 `ctx as unknown as …` 断言。
 * Reads a host service non-strictly: `ctx.get` yields undefined instead of
 * throwing without-inject, which is exactly the "skip when the host has no
 * webServer/configEditor" semantics. The type comes from the declaration merge,
 * so there is no shadow surface and no `ctx as unknown as …` assertion.
 *
 * @param ctx 宿主上下文 / the host context
 * @param name 服务名 / the service name
 * @returns 服务实例或 undefined / the service, or undefined when absent
 */
function probe<K extends string & keyof Context>(ctx: Context, name: K): Context[K] | undefined {
  return ctx.get(name);
}

/** JSON 回执助手 / the JSON response helper */
function json(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

/** 把错误翻译成回执 message 文案 / turns an error into the response message text */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 注册 GET /status 快照路由 / registers the GET /status snapshot route */
function registerStatusRoute(ctx: Context, webServer: WebServer, service: CmsBridgeService): void {
  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: '/cms-bridge/api/status',
    handler: (_req, res) => json(res, 200, service.status()),
  }), 'cms-bridge/api-status');
}

/** 注册 POST /credential 凭证轮换路由 / registers the POST /credential rotation route */
function registerCredentialRoute(ctx: Context, webServer: WebServer, service: CmsBridgeService): void {
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
        json(res, 400, { ok: false, message: errorMessage(error) });
      }
    },
  }), 'cms-bridge/api-credential');
}

/** 注册 GET/POST /identity 节点身份路由 / registers the GET/POST /identity route */
function registerIdentityRoute(ctx: Context, webServer: WebServer, service: CmsBridgeService): void {
  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: '/cms-bridge/api/identity',
    handler: async (req, res) => {
      try {
        if (req.method === 'POST') {
          const identity = await readBodyIdentity(req);
          await persistIdentity(ctx, service, identity);
          ctx.logger.info('cms-bridge: identity updated via web UI: %s (%s)', identity.nodeName, identity.nodeId);
        }
        json(res, 200, { ok: true, identity: service.identity(), status: service.status() });
      } catch (error) {
        json(res, 400, { ok: false, message: errorMessage(error) });
      }
    },
  }), 'cms-bridge/api-identity');
}

/** 注册 POST /icon 上传代理路由 / registers the POST /icon upload-proxy route */
function registerIconRoute(ctx: Context, webServer: WebServer, service: CmsBridgeService): void {
  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: '/cms-bridge/api/icon',
    handler: async (req, res) => {
      try {
        const url = await uploadIcon(service, req);
        json(res, 200, { ok: true, url });
      } catch (error) {
        json(res, 502, { ok: false, message: errorMessage(error) });
      }
    },
  }), 'cms-bridge/api-icon');
}

/** 注册全部 Web UI 路由;宿主无 webServer 时静默跳过 / registers every Web UI route; skipped on hosts without a webServer */
export function registerWebApi(ctx: Context, service: CmsBridgeService): void {
  const webServer = probe(ctx, 'webServer');
  if (!webServer) {
    ctx.logger.warn('cms-bridge: no webServer on this host; web UI API skipped');
    return;
  }
  // 登记顺序保持 status → credential → identity → icon → events；ctx.effect
  // 的逆序清理语义不变。
  // Registration order stays status → credential → identity → icon → events;
  // the ctx.effect reverse-order disposal semantics are unchanged.
  registerStatusRoute(ctx, webServer, service);
  registerCredentialRoute(ctx, webServer, service);
  registerIdentityRoute(ctx, webServer, service);
  registerIconRoute(ctx, webServer, service);
  registerEventStream(ctx, webServer, service);
}

/**
 * SSE 状态事件流:GET /cms-bridge/api/events。连接即推当前快照,此后每次
 * cms-bridge/status 广播实时推送一条 data: 帧;25s 心跳注释保活;客户端断开
 * 即反注册并停心跳。事件推送取代轮询(零延迟、零无效请求)。
 * The SSE status event stream: GET /cms-bridge/api/events. The current
 * snapshot is pushed on connect, then one data frame per cms-bridge/status
 * broadcast; a 25s heartbeat comment keeps the link alive; client disconnect
 * unregisters the listener and stops the heartbeat. Event push replaces
 * polling (zero latency, zero wasted requests).
 */
function registerEventStream(
  ctx: Context,
  webServer: WebServer,
  service: CmsBridgeService,
): void {
  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: '/cms-bridge/api/events',
    handler: (req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      let open = true;
      const send = (status: BridgeStatus): void => {
        if (open) res.write(`data: ${JSON.stringify(status)}\n\n`);
      };
      send(service.status());
      const off = ctx.on('cms-bridge/status', (status) => send(status));
      const heartbeat = setInterval(() => {
        if (open) res.write(': hb\n\n');
      }, 25_000);
      req.on('close', () => {
        open = false;
        off();
        clearInterval(heartbeat);
      });
    },
  }), 'cms-bridge/api-events');
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
async function uploadIcon(service: CmsBridgeService, req: IncomingMessage): Promise<string> {
  const cfg = service.connectionConfig();
  const origin = cmsOrigin(cfg.url);
  const contentType = req.headers['content-type'];
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
async function readRawBody(req: IncomingMessage, cap: number): Promise<Buffer[]> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > cap) throw new Error('body too large');
    chunks.push(chunk);
  }
  return chunks;
}

/** 读 JSON body / reads a JSON body */
async function readJsonBody(req: IncomingMessage, cap: number): Promise<Record<string, unknown>> {
  return JSON.parse(Buffer.concat(await readRawBody(req, cap)).toString('utf8')) as Record<string, unknown>;
}

/** 读取并校验 POST body 里的节点身份 / reads and validates the identity from a POST body */
async function readBodyIdentity(req: IncomingMessage): Promise<NodeIdentity> {
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

/** 读取并校验 POST body 里的 { token } / reads and validates { token } from the POST body */
async function readBodyToken(req: IncomingMessage): Promise<string> {
  const body = await readJsonBody(req, 4096);
  if (typeof body.token !== 'string' || body.token.length === 0) throw new Error('token required');
  return body.token;
}

/** configEditor 提供的行类型:`ConfigEditor['entries']` 的元素,不再手写影子 / the row type ConfigEditor hands out, not a shadow */
type ConfigEntry = ReturnType<ConfigEditor['entries']>[number];

/**
 * 找本插件在 profile patch 里的行。Entry 是类实例:id 为 getter、包名在
 * options.name;个别条目可能是 Context 代理(JSON.stringify 会触发 without
 * inject 抛错),因此 stringify 只作末位兜底并容错。
 * Finds this plugin's row in the profile patch. An Entry is a class instance
 * (id is a getter, the package name lives in options.name); some entries can
 * be Context proxies where JSON.stringify throws "without inject", so the
 * stringify probe comes last and is failure-tolerant.
 *
 * @param editor 宿主 configEditor / the host config editor
 * @returns 本插件的行,或 undefined / this plugin's row, or undefined
 */
function findOwnEntry(editor: ConfigEditor): ConfigEntry | undefined {
  return editor.entries().find((e) => {
    if (e.id === 'cms-bridge' || e.options.name === '@veren/cms-bridge') return true;
    try {
      return JSON.stringify(e).includes('@veren/cms-bridge');
    } catch {
      return false;
    }
  });
}

/**
 * 持久化身份:configEditor 可用则写 profile patch(Loader 热更后仍是新值),
 * 再把内存配置同步为最新(无 configEditor 的宿主上至少进程内生效)。
 * Persists the identity: via configEditor into the profile patch when
 * available (the Loader hot-reload keeps it), then syncs the in-memory config
 * so hosts without configEditor still take effect for this run.
 */
async function persistIdentity(ctx: Context, service: CmsBridgeService, identity: NodeIdentity): Promise<void> {
  const editor = probe(ctx, 'configEditor');
  const entry = editor === undefined ? undefined : findOwnEntry(editor);
  if (editor !== undefined && entry !== undefined) await editor.edit(entry, (current) => ({ ...current, ...identity }));
  service.setIdentity(identity);
}

/** 持久化换凭证:configEditor 可用则写 profile patch,否则仅本进程生效 / persists the rotation: profile patch via configEditor, else run-scoped */
async function persistCredential(ctx: Context, service: CmsBridgeService, token: string): Promise<void> {
  const editor = probe(ctx, 'configEditor');
  const entry = editor === undefined ? undefined : findOwnEntry(editor);
  if (editor !== undefined && entry !== undefined) {
    await editor.edit(entry, (current) => ({ ...current, token }));
    return;
  }
  service.setCredential(token);
}
