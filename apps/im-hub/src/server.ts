/**
 * The device-facing HTTP API: register / poll / reply, all guarded by the
 * shared device token. `poll` is a long poll — an idle device holds the
 * request for up to 25 seconds and leaves with an empty batch.
 *
 * 面向设备的 HTTP API：register / poll / reply，全部由共享设备令牌保护。
 * `poll` 是长轮询——空闲设备挂住请求至多 25 秒，然后带空批次离开。
 *
 * @module im-hub/server
 */

import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { HubConfig } from './config.ts'
import { sendText } from './session.ts'
import type { HubRouter } from './route.ts'

/** How long an idle long poll holds the request. */
const LONG_POLL_MS = 25_000

/** Start the device API; returns the stop function. */
export function startServer(
  config: HubConfig,
  router: HubRouter,
  contexts: Map<string, string>,
): () => void {
  const server = createServer((request, response) => {
    void handle(config, router, contexts, request, response).catch(error => {
      console.error(`[im-hub] request failed: ${String(error)}`)
      if (!response.headersSent) reply(response, 500, { error: 'internal' })
    })
  })
  server.listen(parseAddr(config.addr), () => {
    console.log(`[im-hub] listening on ${config.addr}`)
  })
  return () => server.close()
}

/** Route one request to its endpoint after the token check. */
/** 令牌校验通过后，把请求分发到各端点。 */
async function handle(
  config: HubConfig,
  router: HubRouter,
  contexts: Map<string, string>,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  if (request.headers['x-hub-token'] !== config.deviceToken) {
    reply(response, 401, { error: 'bad device token' })
    return
  }
  const url = new URL(request.url ?? '/', 'http://localhost')
  if (request.method === 'POST' && url.pathname === '/hub/register') return handleRegister(config, request, response)
  if (request.method === 'GET' && url.pathname === '/hub/poll') return handlePoll(config, router, url, response)
  if (request.method === 'POST' && url.pathname === '/hub/replies') return handleReplies(config, contexts, request, response)
  reply(response, 404, { error: 'unknown endpoint' })
}

/** POST /hub/register: drain the body and acknowledge with the default device. */
/** POST /hub/register：排空请求体，返回默认设备名。 */
async function handleRegister(
  config: HubConfig,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  await readBody(request)
  reply(response, 200, { ok: true, defaultDevice: config.defaultDevice })
}

/** GET /hub/poll: one long poll for the device's next batch. */
/** GET /hub/poll：为设备做一次长轮询，取下一批消息。 */
async function handlePoll(
  config: HubConfig,
  router: HubRouter,
  url: URL,
  response: ServerResponse,
): Promise<void> {
  const device = url.searchParams.get('device') ?? config.defaultDevice
  const after = Number(url.searchParams.get('after') ?? '0')
  const messages = await router.nextBatch(device, Number.isFinite(after) ? after : 0, LONG_POLL_MS)
  // tail 让全新设备（cursor=0）跳过历史直接从队尾开始，不重放既有日志。
  // `tail` lets a brand-new device (cursor=0) skip the history and start at the end.
  reply(response, 200, { messages, tail: router.tailOf(device) })
}

/** POST /hub/replies: validate and send one text reply into the conversation. */
/** POST /hub/replies：校验后向会话发送一条文本回复。 */
async function handleReplies(
  config: HubConfig,
  contexts: Map<string, string>,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const body = await readBody(request) as {
    conversationId?: string
    text?: string
    replyTo?: string
  }
  const conversationId = body.conversationId?.trim() ?? ''
  const text = body.text ?? ''
  if (conversationId === '' || text.trim() === '') {
    reply(response, 400, { error: 'conversationId and text are required' })
    return
  }
  await sendText(config, toUserId(conversationId), text, contexts.get(conversationId))
  reply(response, 200, { ok: true })
}

/** Collect one JSON body; an empty body reads as an empty object. */
function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    request.on('data', chunk => chunks.push(chunk as Buffer))
    request.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (raw.trim() === '') return resolve({})
      try {
        const parsed: unknown = JSON.parse(raw)
        if (parsed !== null && typeof parsed === 'object') return resolve(parsed as Record<string, unknown>)
        resolve({})
      } catch (error) {
        reject(error)
      }
    })
    request.on('error', reject)
  })
}

/** Send one JSON response and close. */
function reply(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(body))
}

/** The WeChat user id behind one p2p conversation id. */
function toUserId(conversationId: string): string {
  return conversationId.startsWith('p2p:') ? conversationId.slice(4) : conversationId
}

/** Split `:port` or `host:port` into listen args. */
function parseAddr(addr: string): { host?: string; port: number } {
  if (addr.startsWith(':')) return { port: Number(addr.slice(1)) }
  const index = addr.lastIndexOf(':')
  return { host: addr.slice(0, index), port: Number(addr.slice(index + 1)) }
}
