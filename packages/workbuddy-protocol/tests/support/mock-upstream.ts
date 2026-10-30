/**
 * WorkBuddy 方言 mock 上游：真 HTTP 服务，端口系统分配（并发安全），每用例
 * 自起自关。可按端点编程响应并记录全部请求，供离线回放协议行为。
 * A WorkBuddy-dialect mock upstream: a real HTTP server on a system-assigned
 * port (concurrency-safe), started and stopped per case. Responses are
 * programmable per endpoint and every request is recorded, so protocol behavior
 * replays offline.
 *
 * @module tests/support/mock-upstream
 */
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http'

/** 一个被记录的请求。One recorded request. */
export interface RecordedRequest {
  readonly method: string
  readonly path: string
  readonly headers: Record<string, string | string[] | undefined>
  readonly body: string
}

/** 可编程的端点行为（服务端闭包与测试句柄读写同一份）。Programmable endpoint behavior (the server closure and the test handle read/write one shared object). */
export interface MockBehavior {
  /** 授权三端点的响应体（HTTP 200 信封）。Responses of the OAuth trio. */
  stateBody: string
  tokenBody: string
  /** 轮询端点可按调用次数给不同答案（第 N 次从 0 计）。The token endpoint can vary per call count (0-based). */
  tokenBodies: string[]
  accountBody: string
  /** 刷新端点。Refresh. */
  refreshStatus: number
  refreshBody: string
  /** 目录与控制台端点。Catalog and console. */
  catalogStatus: number
  catalogBody: string
  consoleStatus: number
  consoleBody: string
  /** 计费端点。Billing. */
  billingStatus: number
  billingBody: string
  /** chat：状态码 + SSE 体（流式读出）。Chat: status + SSE body (streamed out). */
  chatStatus: number
  chatBody: string
}

/** mock 上游句柄。The mock upstream handle. */
export interface MockUpstream extends MockBehavior {
  readonly origin: string
  readonly requests: readonly RecordedRequest[]
  close(): Promise<void>
}

/** 默认行为（形状取自 fixtures/ 卷宗）。Default behavior (shapes from the fixtures/dossier). */
function defaultBehavior(): MockBehavior {
  return {
    stateBody: '{"code":0,"msg":"","data":{"state":"st-1","authUrl":"https://www.workbuddy.cn/oauth/authorize?platform=workbuddy&state=st-1"}}',
    tokenBody: '{"code":11217,"msg":"11217:login ing"}',
    tokenBodies: [],
    accountBody: '{"code":0,"msg":"","data":{"uid":"u-1","enterpriseId":"","nickname":"13800138000"}}',
    refreshStatus: 200,
    refreshBody: '{"code":0,"msg":"","data":{"data":{"accessToken":"at-new","refreshToken":"rt-new","expiresIn":3600}}}',
    catalogStatus: 200,
    catalogBody: '{"code":0,"msg":"","data":{"models":[],"agents":[{"name":"cli","models":[]}]}}',
    consoleStatus: 200,
    consoleBody: '{"code":0,"msg":"","data":{"models":[]}}',
    billingStatus: 200,
    billingBody: '{"code":0,"msg":"","data":{"Response":{"Data":{"Accounts":[]}}}}',
    chatStatus: 200,
    chatBody: 'data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n',
  }
}

/** 可变行为键（句柄上生成同源访问器）。Mutable behavior keys (same-source accessors are generated on the handle). */
const BEHAVIOR_KEYS = [
  'stateBody', 'tokenBody', 'tokenBodies', 'accountBody',
  'refreshStatus', 'refreshBody', 'catalogStatus', 'catalogBody',
  'consoleStatus', 'consoleBody', 'billingStatus', 'billingBody',
  'chatStatus', 'chatBody',
] as const

/** 起一个 mock 上游。Starts one mock upstream. */
export function startMockUpstream(): Promise<MockUpstream> {
  const requests: RecordedRequest[] = []
  const state: MockBehavior = defaultBehavior()
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = []
    req.on('data', chunk => chunks.push(chunk as Buffer))
    req.on('end', () => {
      requests.push({
        method: req.method ?? '',
        path: req.url ?? '',
        headers: { ...req.headers },
        body: Buffer.concat(chunks).toString('utf8'),
      })
      const path = (req.url ?? '').split('?')[0] ?? ''
      const reply = (status: number, body: string): void => {
        res.writeHead(status, { 'content-type': 'application/json' })
        res.end(body)
      }
      if (path === '/v2/plugin/auth/state') reply(200, state.stateBody)
      else if (path === '/v2/plugin/auth/token' && (req.url ?? '').includes('state=')) {
        // 轮询端点：可按调用次数变化（pending → token 两段式登录用例）；超出
        // 清单后保持最后一个答案（complete 会再 poll 一次）。
        // The token endpoint: per-call-count bodies (pending → token cases);
        // past the list the last answer holds (complete polls once more).
        const index = requests.filter(request => (request.path.split('?')[0] ?? '') === '/v2/plugin/auth/token').length - 1
        const perCall = state.tokenBodies[index] ?? state.tokenBodies.at(-1) ?? state.tokenBody
        reply(200, perCall)
      } else if (path === '/v2/plugin/login/account') reply(200, state.accountBody)
      else if (path === '/v2/plugin/auth/token/refresh') reply(state.refreshStatus, state.refreshBody)
      else if (path === '/v3/config') reply(state.catalogStatus, state.catalogBody)
      else if (path === '/console/enterprises/personal/models') reply(state.consoleStatus, state.consoleBody)
      else if (path.startsWith('/v2/billing/meter/')) reply(state.billingStatus, state.billingBody)
      else if (path === '/v2/chat/completions') {
        res.writeHead(state.chatStatus, { 'content-type': 'text/event-stream' })
        res.end(state.chatBody)
      } else reply(404, '{"code":404,"msg":"not found"}')
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      const handle = {} as MockUpstream
      Object.defineProperty(handle, 'origin', { value: `http://127.0.0.1:${port}`, enumerable: true })
      Object.defineProperty(handle, 'requests', { value: requests, enumerable: true })
      Object.defineProperty(handle, 'close', {
        value: () => new Promise<void>((resolveClose) => { server.close(() => resolveClose()) }),
        enumerable: true,
      })
      for (const key of BEHAVIOR_KEYS) {
        Object.defineProperty(handle, key, {
          get: () => state[key],
          set: (value: unknown) => { (state as unknown as Record<string, unknown>)[key] = value },
          enumerable: true,
        })
      }
      resolve(handle)
    })
  })
}

/** 等到出现匹配的请求（竞态测试用）。Waits until a matching request appears (race tests). */
export async function until<T>(pass: () => T | undefined, timeoutMs = 2_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const hit = pass()
    if (hit !== undefined) return hit
    if (Date.now() > deadline) throw new Error('until: condition not met in time')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}
