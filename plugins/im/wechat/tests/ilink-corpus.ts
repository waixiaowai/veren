/**
 * Recorded iLink corpus loader and wire-shape assertions (L2).
 *
 * The send-face suite replays verbatim recorded responses instead of hand-written
 * stubs; the same JSONL lives in the Go client's testdata with the same SHA256,
 * so both clients are judged against one source of truth.
 *
 * 录制 iLink 语料装载与线形状断言（L2）。发送面用例逐字回放录制响应，替代手写桩；
 * 同一份 JSONL 以相同 SHA256 存在 Go 客户端 testdata——两个客户端被同一事实源裁决。
 *
 * @module @veren/im-wechat/tests/ilink-corpus
 */

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 契约文档 §5 同值；副本漂移即红。 */
export const CORPUS_SHA256 = 'bbeef4cf3706f0066615b0605d117342048465b94a829af132f5ec97b2ea6a41'

/** One recorded exchange and its per-client expected classification. */
export interface CorpusCase {
  id: string
  endpoint: string
  request: { method: string; headers: Record<string, string>; body: string }
  response: { status: number; headers: Record<string, string>; body: string }
  expect: {
    go: { kind: string; ret?: string }
    ts: { kind: string; code?: string; providerCode?: string }
  }
}

const corpusPath = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'ilink-send-cases.jsonl')

/** Load and integrity-check the corpus; a drifted copy fails loudly. */
export function loadCorpus(): CorpusCase[] {
  const payload = readFileSync(corpusPath)
  const digest = createHash('sha256').update(payload).digest('hex')
  if (digest !== CORPUS_SHA256) {
    throw new Error(`iLink corpus drifted: sha256=${digest} want=${CORPUS_SHA256}`)
  }
  return payload
    .toString('utf8')
    .trim()
    .split('\n')
    .map(line => JSON.parse(line) as CorpusCase)
}

/** One case by id. */
export function corpusCase(cases: CorpusCase[], id: string): CorpusCase {
  const found = cases.find(item => item.id === id)
  if (found === undefined) throw new Error(`corpus has no case ${id}`)
  return found
}

/** The verbatim recorded response as a fetch Response. */
export function recordedResponse(item: CorpusCase): Response {
  return new Response(item.response.body, {
    status: item.response.status,
    headers: { 'content-type': 'application/json' },
  })
}

/** Header lookup that ignores case (fetch init headers may be a plain record). */
function headerOf(init: RequestInit, name: string): string | undefined {
  const headers = init.headers
  if (headers === undefined) return undefined
  if (headers instanceof Headers) return headers.get(name) ?? undefined
  const entries = Array.isArray(headers) ? headers : Object.entries(headers as Record<string, string>)
  for (const [key, value] of entries) {
    if (key.toLowerCase() === name.toLowerCase()) return value
  }
  return undefined
}

/** Parse one JSON request body from a fetch init. */
export function jsonBodyOf(init: RequestInit): Record<string, unknown> {
  if (typeof init.body !== 'string') throw new Error('expected a string request body')
  const value: unknown = JSON.parse(init.body)
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('expected a JSON object body')
  return value as Record<string, unknown>
}

/**
 * Assert the client's outgoing request matches the recorded wire shape.
 *
 * Pinned: the protocol headers, the client version (132102 for every client
 * frame), and the body skeleton. Volatile fields (client_id, Authorization
 * value, X-WECHAT-UIN) are deliberately excluded; the 4102 case is the recorded
 * proof that upstream tolerates the old header, not a request target.
 *
 * 断言客户端请求与录制线形状一致。钉住：协议头、版本头（客户端恒 132102）、body 骨架；
 * 易变字段（client_id、Authorization 值、X-WECHAT-UIN）不比对；4102 用例只证明上游容忍旧头。
 */
export function assertWireShape(item: CorpusCase, init: RequestInit): void {
  const expected = item.id === 'sendmessage-ok-4102' ? '132102' : item.request.headers['Ilink-App-Clientversion']
  const version = headerOf(init, 'iLink-App-ClientVersion')
  if (version !== expected) throw new Error(`${item.id}: client version ${version} != ${expected}`)
  if (headerOf(init, 'iLink-App-Id') !== 'bot') throw new Error(`${item.id}: app id missing`)
  if (headerOf(init, 'AuthorizationType') !== 'ilink_bot_token') throw new Error(`${item.id}: auth type missing`)
  if (!(headerOf(init, 'Authorization') ?? '').startsWith('Bearer ')) throw new Error(`${item.id}: bearer missing`)

  const sent = jsonBodyOf(init)
  const base = sent.base_info as Record<string, unknown> | undefined
  if (base?.channel_version !== '2.4.6') throw new Error(`${item.id}: base_info channel_version = ${String(base?.channel_version)}`)
  if (item.endpoint.endsWith('/sendmessage')) {
    const message = sent.msg as Record<string, unknown> | undefined
    if (message?.message_type !== 2 || message?.message_state !== 2) throw new Error(`${item.id}: msg skeleton drifted`)
    const items = message.item_list as Array<Record<string, unknown>> | undefined
    if (!Array.isArray(items) || items.length !== 1 || items[0]?.type !== 1) throw new Error(`${item.id}: item_list drifted`)
  }
}
