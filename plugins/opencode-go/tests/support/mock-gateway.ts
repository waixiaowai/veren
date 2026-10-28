/**
 * 测试基建：本地 mock 网关（OpenAI 兼容 /models 与 /chat/completions）。
 * 端口由系统分配（并发安全）；每个用例起自己的实例并显式关闭。
 * Test support: a local mock gateway (OpenAI-compatible /models and
 * /chat/completions). Ports are system-assigned (concurrency-safe); each test
 * starts its own instance and closes it explicitly.
 *
 * @module @veren/opencode-go/tests
 */
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

/** mock 网关的行为开关与请求记录。The mock gateway's behavior switches and request log. */
export interface MockGateway {
  url: string
  requests: { path: string; headers: Record<string, string | undefined>; body: string }[]
  close(): Promise<void>
  /** /models 的响应（默认全量 id 列表）。The /models response (defaults to the full id list). */
  modelsStatus: number
  modelsBody: string
  /** chat completions 的 SSE 体与状态。The chat completions SSE body and status. */
  chatStatus: number
  chatBody: string
}

/** 起一个 mock 网关；用例内直接改写行为字段。Starts a mock gateway; tests rewrite behavior fields in place. */
export async function startMockGateway(): Promise<MockGateway> {
  const requests: MockGateway['requests'] = []
  const modelsBody = JSON.stringify({
    object: 'list',
    data: [
      { id: 'deepseek-v4.1-flash', object: 'model', owned_by: 'opencode' },
      { id: 'glm-5.3-flash', object: 'model', owned_by: 'opencode' },
    ],
  })
  const chatBody = [
    'data: {"choices":[{"delta":{"reasoning_content":"想想"}}]}',
    'data: {"choices":[{"delta":{"content":"OK"}}]}',
    'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":35,"completion_tokens":10,"total_tokens":45,"prompt_tokens_details":{"cached_tokens":3},"completion_tokens_details":{"reasoning_tokens":7}}}',
    'data: [DONE]',
    '',
  ].join('\n')
  const server: Server = createServer((req, res) => {
    let body = ''
    req.on('data', (chunk: Buffer) => { body += chunk.toString() })
    req.on('end', () => {
      requests.push({ path: req.url ?? '/', headers: req.headers, body })
      if (req.url?.endsWith('/models')) {
        res.writeHead(gateway.modelsStatus, { 'content-type': 'application/json' })
        res.end(gateway.modelsBody)
        return
      }
      res.writeHead(gateway.chatStatus, { 'content-type': 'text/event-stream' })
      res.end(gateway.chatBody)
    })
  })
  const gateway: MockGateway = {
    url: '',
    requests,
    modelsStatus: 200,
    modelsBody,
    chatStatus: 200,
    chatBody,
    close: async () => undefined,
  }
  gateway.close = () => new Promise((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  gateway.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return gateway
}
