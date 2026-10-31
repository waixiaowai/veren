/**
 * 本地只读画布 HTTP 服务：静态页面、flow 投影、运行启动、SSE 状态流与快照查询。
 * The local read-only canvas HTTP server: static page, flow projection, run
 * start, SSE status stream and snapshot reads.
 *
 * It never reaches into kernel events: every status and every node output
 * crosses the `@deepseek-ai/dsh-graph-flow-canvas` public surface.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { CanvasFlow, FlowCanvas } from '@deepseek-ai/dsh-graph-flow-canvas';
import type { FlowEngineService } from '@deepseek-ai/dsh-graph-flow-engine';
import type { StartRunResponse } from './model.js';
import { createCanvasRuntime, flowDescriptors } from './runtime.js';
import { RunRegistry } from './runs.js';

/** 服务启动选项 / server start options */
export interface FlowCanvasUiOptions {
    /** 监听端口，0 表示随机 / port to listen on; 0 picks a random one */
    port?: number;
    /** 监听地址，默认只绑本机 / bind address, localhost by default */
    host?: string;
    /** 覆盖演示 YAML 路径 / override the demo YAML path */
    demoFile?: string;
}

/** 已启动服务的返回面 / the handle returned by a started server */
export interface FlowCanvasUiServer {
    url: string;
    port: number;
    close(): Promise<void>;
}

/**
 * 启动本地只读画布服务。
 * Start the local read-only canvas server.
 *
 * @param options 端口/地址/演示文件 / port, host, demo file
 * @returns 服务句柄（url/port/close）/ the server handle (url/port/close)
 */
export async function createFlowCanvasServer(options: FlowCanvasUiOptions = {}): Promise<FlowCanvasUiServer> {
    const host = options.host ?? '127.0.0.1';
    const packageRoot = resolve(import.meta.dirname, '..');
    const runtime = await createCanvasRuntime({ demoFile: options.demoFile });
    const { engine, canvas } = runtime;
    const runs = new RunRegistry(canvas, (error) => {
        console.error('[flow-canvas-ui] run failed / 画布运行失败', error);
    });
    const handleRequest = createRequestHandler(engine, canvas, runs, packageRoot);
    const server = createServer((request, response) => {
        void handleRequest(request, response).catch((error: unknown) => respondError(response, error));
    });
    const url = await listen(server, host, options.port ?? 4780);
    return {
        url,
        port: portOf(server),
        async close() {
            runs.dispose();
            await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
            await runtime.close();
        },
    };
}

/** 回应一次处理失败：头已发出就只能断开，否则回 500 / respond to a failed request: just hang up when headers are sent, else 500 */
function respondError(response: ServerResponse, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    if (response.headersSent) {
        response.end();
        return;
    }
    sendJson(response, 500, { error: message });
}

/** 路由表 / the per-route handlers over one composed data plane */
interface RouteDeps {
    engine: FlowEngineService;
    canvas: FlowCanvas;
    runs: RunRegistry;
    packageRoot: string;
}

/** GET /api/flows：全部已注册 flow 描述 / the flow descriptor list */
function handleFlowsList(response: ServerResponse, engine: FlowEngineService): void {
    sendJson(response, 200, { flows: flowDescriptors(engine) });
}

/** GET /api/flows/:id：静态投影，未注册 404 / one static projection; 404 when unregistered */
function handleFlowGet(response: ServerResponse, deps: RouteDeps, flowId: string): void {
    if (!deps.engine.hasFlow(flowId)) {
        sendJson(response, 404, { error: `flow "${flowId}" is not registered`, code: 'FLOW_NOT_FOUND' });
        return;
    }
    sendJson(response, 200, deps.canvas.project(flowId) satisfies CanvasFlow);
}

/** POST /api/runs：启动一次运行 / start one run */
async function handleRunStart(request: IncomingMessage, response: ServerResponse, deps: RouteDeps): Promise<void> {
    const body = await readJson(request);
    const flowId = typeof body.flowId === 'string' ? body.flowId : 'canvas-demo';
    if (!deps.engine.hasFlow(flowId)) {
        sendJson(response, 404, { error: `flow "${flowId}" is not registered`, code: 'FLOW_NOT_FOUND' });
        return;
    }
    const payload: StartRunResponse = { runId: deps.runs.start(flowId), flowId };
    sendJson(response, 201, payload);
}

/** GET /api/runs/:id：运行状态快照 / one run's status snapshot */
function handleRunGet(response: ServerResponse, runs: RunRegistry, runId: string): void {
    const state = runs.get(runId);
    if (!state) {
        sendJson(response, 404, { error: 'run not found', code: 'RUN_NOT_FOUND' });
        return;
    }
    sendJson(response, 200, state);
}

/** GET /api/runs/:id/events：SSE 状态流 / the SSE status stream */
function handleRunEvents(response: ServerResponse, runs: RunRegistry, runId: string): void {
    if (!runs.attach(runId, response)) {
        sendJson(response, 404, { error: 'run not found', code: 'RUN_NOT_FOUND' });
    }
}

/** 路由入口 / request router */
function createRequestHandler(
    engine: FlowEngineService,
    canvas: FlowCanvas,
    runs: RunRegistry,
    packageRoot: string,
): (request: IncomingMessage, response: ServerResponse) => Promise<void> {
    const deps: RouteDeps = { engine, canvas, runs, packageRoot };
    return async (request, response) => {
        const method = request.method ?? 'GET';
        const requestUrl = new URL(request.url ?? '/', 'http://localhost');
        const flowMatch = /^\/api\/flows\/([^/]+)$/.exec(requestUrl.pathname);
        const runMatch = /^\/api\/runs\/([^/]+)$/.exec(requestUrl.pathname);
        const streamMatch = /^\/api\/runs\/([^/]+)\/events$/.exec(requestUrl.pathname);
        if (method === 'GET' && requestUrl.pathname === '/api/flows') return handleFlowsList(response, engine);
        if (method === 'GET' && flowMatch) return handleFlowGet(response, deps, decodeURIComponent(flowMatch[1]!));
        if (method === 'POST' && requestUrl.pathname === '/api/runs') return handleRunStart(request, response, deps);
        if (method === 'GET' && runMatch) return handleRunGet(response, runs, decodeURIComponent(runMatch[1]!));
        if (method === 'GET' && streamMatch) return handleRunEvents(response, runs, decodeURIComponent(streamMatch[1]!));
        if (method === 'GET') return serveStatic(requestUrl.pathname, response, packageRoot);
        sendJson(response, 405, { error: `method ${method} is not allowed` });
    };
}

/** 监听端口并返回 URL / listen and return the URL */
async function listen(server: Server, host: string, port: number): Promise<string> {
    await new Promise<void>((resolveListen, rejectListen) => {
        server.once('error', rejectListen);
        server.listen(port, host, () => {
            server.off('error', rejectListen);
            resolveListen();
        });
    });
    return `http://${host}:${portOf(server)}/`;
}

/** 读取监听端口 / read the bound port */
function portOf(server: Server): number {
    const address = server.address();
    return typeof address === 'object' && address !== null ? address.port : 0;
}

/** 发送 JSON / send JSON */
function sendJson(response: ServerResponse, status: number, payload: unknown): void {
    const body = JSON.stringify(payload);
    response.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Length': Buffer.byteLength(body),
    });
    response.end(body);
}

/** 读取 JSON 请求体（上限 64 KiB）/ read a JSON body (64 KiB limit) */
async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += buffer.length;
        if (size > 64 * 1024) throw new Error('request body too large');
        chunks.push(buffer);
    }
    if (chunks.length === 0) return {};
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('request body must be a JSON object');
    return parsed as Record<string, unknown>;
}

/** 静态资源白名单与 MIME / static whitelist and MIME types */
const STATIC_FILES: Record<string, { path: string; type: string }> = {
    '/': { path: 'public/index.html', type: 'text/html; charset=utf-8' },
    '/index.html': { path: 'public/index.html', type: 'text/html; charset=utf-8' },
    '/styles.css': { path: 'public/styles.css', type: 'text/css; charset=utf-8' },
};

/** 发送静态文件 / serve one static file */
async function serveStatic(pathname: string, response: ServerResponse, packageRoot: string): Promise<void> {
    if (pathname === '/favicon.ico') {
        response.writeHead(204);
        response.end();
        return;
    }
    const known = STATIC_FILES[pathname];
    if (known) {
        await sendFile(response, resolve(packageRoot, known.path), known.type);
        return;
    }
    const libMatch = /^\/lib\/([A-Za-z0-9_-]+\.js(?:\.map)?)$/.exec(pathname);
    if (libMatch) {
        const type = extname(libMatch[1]!) === '.map' ? 'application/json; charset=utf-8' : 'text/javascript; charset=utf-8';
        await sendFile(response, resolve(packageRoot, 'lib', libMatch[1]!), type);
        return;
    }
    sendJson(response, 404, { error: 'not found' });
}

/** 读取文件并发送；文件不存在时 404 / read and send; missing files become 404 */
async function sendFile(response: ServerResponse, file: string, type: string): Promise<void> {
    try {
        const body = await readFile(file);
        response.writeHead(200, {
            'Content-Type': type,
            'Cache-Control': 'no-store',
            'Content-Length': body.byteLength,
        });
        response.end(body);
    } catch {
        sendJson(response, 404, { error: 'not found' });
    }
}

/** 是否为直接运行（`node lib/server.js`）/ whether the module is the direct entry */
function isDirectEntry(): boolean {
    const entry = process.argv[1];
    if (!entry) return false;
    return pathToFileURL(resolve(entry)).href === import.meta.url;
}

if (isDirectEntry()) {
    const port = Number(process.env.FLOW_CANVAS_UI_PORT ?? 4780);
    createFlowCanvasServer({ port })
        .then((server) => {
            console.log(`[flow-canvas-ui] ${server.url}`);
            console.log('[flow-canvas-ui] open the URL above; Ctrl+C to stop / 打开上面的地址，Ctrl+C 停止');
        })
        .catch((error: unknown) => {
            console.error('[flow-canvas-ui] failed to start / 启动失败', error);
            process.exitCode = 1;
        });
}
