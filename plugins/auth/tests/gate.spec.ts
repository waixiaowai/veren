/**
 * Gate handler behavior with a real Better Auth session chain and stub
 * connection/webServer: unauthenticated entry redirects to the login page
 * with no cookie minted, an authenticated entry re-triggers the token
 * exchange, and the data-gate waterfall admits or refuses requests.
 * 门禁处理器行为（真实 Better Auth 会话链 + 桩 connection/webServer）：未认证
 * 入口重定向到登录页且不铸任何 Cookie，已认证入口代为重新触发 token 兑换，
 * 数据闸门 waterfall 放行或拒绝请求。
 */

import { describe, expect, it } from 'vitest'
import { EventEmitter } from 'node:events'
import { buildBetterAuth } from '../src/auth.js'
import { dataGateListener, handleIndex, LOGIN_PATH, sessionOf } from '../src/gate.js'
import { memoryLoginGateDomain } from './memory-domain.js'
import type { GateServices } from '../src/gate.js'
import type { IncomingMessage, ServerResponse } from 'node:http'

const ORIGIN = 'http://127.0.0.1:3080'

/** Recorded fake ServerResponse. 记录型假 ServerResponse。 */
interface FakeResponse {
  status?: number
  headers: Record<string, string | string[]>
  body: string | Buffer | undefined
  ended: boolean
}

/** Build the fake response collector. 构建假响应收集器。 */
function fakeResponse(): { res: ServerResponse, record: FakeResponse } {
  const record: FakeResponse = { headers: {}, body: undefined, ended: false }
  const res = {
    writeHead: (status: number, headers: Record<string, string | string[]> = {}) => {
      record.status = status
      record.headers = headers
    },
    end: (body?: string | Buffer) => {
      record.body = body
      record.ended = true
    },
    setHeader: () => {},
  } as unknown as ServerResponse
  return { res, record }
}

/** Build a minimal fake IncomingMessage. 构建最小假 IncomingMessage。 */
function fakeRequest(url: string, headers: Record<string, string> = {}): IncomingMessage {
  const message = new EventEmitter() as unknown as IncomingMessage
  Object.assign(message, { url, method: 'GET', headers })
  return message
}

/** The stub connection: records exchange calls, always deniable. 桩 connection：记录兑换调用，可控制授权结果。 */
function stubConnection(authorizeResult: boolean): {
  connection: GateServices['connection'], calls: { url: string }[], tokenized: string,
} {
  const calls: { url: string }[] = []
  return {
    calls,
    tokenized: `${ORIGIN}/?token=LAUNCH`,
    connection: {
      authorizeIndex: (req: IncomingMessage) => {
        calls.push({ url: req.url ?? '' })
        return authorizeResult
      },
      authenticatedUrl: (base: string) => `${ORIGIN}/?token=LAUNCH&from=${encodeURIComponent(base)}`,
    } as unknown as GateServices['connection'],
  }
}

/** Sign one user in and return the session cookie header value. 登录一个用户并返回会话 Cookie 头值。 */
async function signIn(auth: GateServices['auth'], email: string, password: string): Promise<string> {
  const response = await auth.handler(new Request(`${ORIGIN}/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  }))
  const cookie = response.headers.getSetCookie().find(entry => entry.startsWith('dsh-login.session_token='))
  expect(cookie).toBeDefined()
  return cookie!.split(';')[0]!
}

async function makeServices(authorizeResult = true): Promise<{ services: GateServices, auth: GateServices['auth'] }> {
  const auth = buildBetterAuth({
    domain: memoryLoginGateDomain(),
    secret: 'unit-test-secret-0123456789abcdef0123456789abcdef',
    origin: ORIGIN,
    secure: false,
    expiresInDays: 7,
    rateLimit: false,
  })
  await auth.handler(new Request(`${ORIGIN}/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.com', password: 'correct-horse-1', name: 'Admin' }),
  }))
  const { connection } = stubConnection(authorizeResult)
  return {
    auth,
    services: { auth, connection, webServer: {
      renderIndex: (html: string) => html,
    }, distIndex: 'tests/fixture-dist/index.html' } as unknown as GateServices,
  }
}

describe('entry gate | 入口门禁', () => {
  it('redirects an unauthenticated browser to the login page without minting cookies | 未认证重定向到登录页且不铸 Cookie', async () => {
    const { services } = await makeServices()
    const { res, record } = fakeResponse()
    // Even the full launch URL is redirected: the token is dropped unexchanged.
    // 即使携带完整启动 URL 也被重定向：token 被丢弃、未兑换。
    await handleIndex(services, fakeRequest('/?token=LAUNCH'), res, ORIGIN)
    expect(record.status).toBe(303)
    expect(record.headers['location']).toBe(LOGIN_PATH)
    expect(record.headers['set-cookie']).toBeUndefined()
  })

  it('re-triggers the token exchange for an authenticated browser without a token | 已认证且无 token 时代为触发兑换', async () => {
    const { services, auth } = await makeServices()
    const cookie = await signIn(auth, 'admin@example.com', 'correct-horse-1')
    const { res, record } = fakeResponse()
    await handleIndex(services, fakeRequest('/', { cookie }), res, ORIGIN)
    expect(record.status).toBe(303)
    expect(String(record.headers['location'])).toContain('token=LAUNCH')
  })

  it('authorizes through Connection and serves the rendered index | 经 Connection 授权后提供渲染的入口页', async () => {
    const { services, auth } = await makeServices()
    const cookie = await signIn(auth, 'admin@example.com', 'correct-horse-1')
    const { res, record } = fakeResponse()
    await handleIndex(services, fakeRequest('/?token=LAUNCH', { cookie }), res, ORIGIN)
    expect(record.status).toBe(200)
    expect(record.headers['content-type']).toBe('text/html; charset=utf-8')
    expect(String(record.body)).toContain('<base href="./">')
  })

  it('serves the index directly once the dsh-auth cookie is exchanged | 已兑换 dsh-auth Cookie 时直接提供入口页', async () => {
    const { services, auth } = await makeServices()
    const cookie = await signIn(auth, 'admin@example.com', 'correct-horse-1')
    const { res, record } = fakeResponse()
    // Session cookie plus an already-minted dsh-auth cookie: no re-exchange.
    // 会话 Cookie 加上已铸的 dsh-auth Cookie：不再重复兑换。
    await handleIndex(services, fakeRequest('/', { cookie: `${cookie}; dsh-auth-someauthority=value` }), res, ORIGIN)
    expect(record.status).toBe(200)
    expect(record.headers['location']).toBeUndefined()
  })

  it('lets Connection own the response when the exchange denies | 兑换被拒时响应归 Connection', async () => {
    const { services, auth } = await makeServices(false)
    const cookie = await signIn(auth, 'admin@example.com', 'correct-horse-1')
    const { res, record } = fakeResponse()
    await handleIndex(services, fakeRequest('/?token=LAUNCH', { cookie }), res, ORIGIN)
    // The stub "Connection" wrote nothing; the gate must not touch the response.
    // 桩“Connection”未写任何内容；门禁不得再触碰响应。
    expect(record.status).toBeUndefined()
    expect(record.ended).toBe(false)
  })

  it('resolves the session from the cookie | 从 Cookie 解析会话', async () => {
    const { services, auth } = await makeServices()
    expect(await sessionOf(services, fakeRequest('/'))).toBeNull()
    const cookie = await signIn(auth, 'admin@example.com', 'correct-horse-1')
    expect(await sessionOf(services, fakeRequest('/', { cookie }))).not.toBeNull()
  })
})

describe('data gate waterfall | 数据闸门 waterfall', () => {
  it('admits an authenticated request to the rest of the chain | 放行已认证请求', async () => {
    const { services, auth } = await makeServices()
    const cookie = await signIn(auth, 'admin@example.com', 'correct-horse-1')
    const listener = dataGateListener(services)
    const { res, record } = fakeResponse()
    let reached = false
    await listener(fakeRequest('/api/session', { cookie }), res, async () => { reached = true })
    expect(reached).toBe(true)
    expect(record.status).toBeUndefined()
  })

  it('refuses an unauthenticated request with 401 and never calls next | 未认证请求 401 且绝不调用 next', async () => {
    const { services } = await makeServices()
    const listener = dataGateListener(services)
    const { res, record } = fakeResponse()
    let reached = false
    await listener(fakeRequest('/api/session'), res, async () => { reached = true })
    expect(reached).toBe(false)
    expect(record.status).toBe(401)
  })
})
