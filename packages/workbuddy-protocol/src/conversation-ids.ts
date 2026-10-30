/**
 * 会话追踪头族：`X-Conversation-*` / `X-Request-ID` 的派生。
 * The conversation-tracking header family: `X-Conversation-*` / `X-Request-ID`.
 *
 * 为什么存在：上游按 `X-Conversation-Request-ID` 把一次用户发送计为一次请求。
 * 每次调用带全新 id 会把一次发送在使用明细里碎片化成多条——这是参考项目修
 * 掉的症状。派生规则：一次发送的每一步（重试、工具续跑、换账号）重复同一
 * 回合 id；用户下一条真实消息才换新回合。
 * Why: the upstream counts one user send as one request by
 * `X-Conversation-Request-ID`; a fresh id per call fragments one send into many
 * rows in the usage detail — the symptom the reference projects fixed. One
 * send's every step (retry, tool continuation, account change) repeats the turn
 * id; the user's next genuine message starts a new turn.
 *
 * 红线：原始本地会话 id **绝不外发**——派生 id 用每进程新盐，不可读回原文。
 * Red line: raw local session ids are **never forwarded** — derived ids use a
 * fresh per-process salt and cannot be read back as their input.
 *
 * 证据：docs/workbuddy-protocol.cn.md §3.1；卷宗 upstream.ts:509-690。
 * Evidence: docs/workbuddy-protocol.md §3.1; dossier upstream.ts:509-690.
 *
 * @module @veren/workbuddy-protocol/conversation-ids
 */

import { createHash, randomBytes } from 'node:crypto'

/**
 * 派生盐，每进程新。WorkBuddy 自己的 id 在一次运行内是一个会话自己的；派生
 * id 不得可读回它来自的文本。每进程（而非每账号）：重启开新命名空间，正如
 * 一个新启动的客户端。
 * The derivation salt, fresh per process. Per-process rather than per-account:
 * a restart starts a new namespace, exactly as a freshly launched client would.
 */
const CONVERSATION_ID_SALT = randomBytes(16).toString('hex')

/** WorkBuddy 自家 id 的 32 hex 形状。The 32-hex shape of WorkBuddy's own ids. */
function conversationIdHex(): string {
  return randomBytes(16).toString('hex')
}

/** 从"命名这个东西的东西"派生 32 hex id，使一次发送的每一步重复同值。 */
/** Derive one 32-hex id from what names the thing, so every step of one send repeats the value. */
function derivedConversationId(kind: string, key: string): string {
  return createHash('sha256').update(`${CONVERSATION_ID_SALT}|${kind}|${key}`).digest('hex').slice(0, 32)
}

/**
 * 消息内容签名：文本 + 每个非文本部分的摘要（图、文件），纯图回合也是自己
 * 的回合。"是不是工具结果"不在这里回答——那是 isToolResultOnly 的职责，
 * 且必须先于本函数回答：按部分回答会把同消息里用户自己的话排除掉。
 * A message's signature: its text plus a digest of every non-text part, so a
 * turn of images alone is a turn of its own too. "Is this a tool result?" is
 * *not* answered here and must be answered before this runs.
 */
function messageSignature(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  let out = ''
  for (const part of content) {
    if (typeof part !== 'object' || part === null) continue
    const record = part as Record<string, unknown>
    const type = typeof record['type'] === 'string' ? record['type'] : ''
    if (type === '' || type === 'text') {
      out += typeof record['text'] === 'string' ? record['text'] : ''
    } else {
      out += `[${type}:${createHash('sha256').update(JSON.stringify(part)).digest('hex').slice(0, 8)}]`
    }
  }
  return out
}

/**
 * 这条消息的内容是否只有工具结果。工具结果住在 `role:'tool'` 消息里（OpenAI
 * 形），或作为 user 消息里的 `tool_result` 块（Anthropic 形）——两种都跳过：
 * 它们不是用户自己的话，回合键若随它们变化就失去了意义。**空文本消息刻意
 * 不覆盖**：含糊时放弃（每请求新 id）是安全失败，静默复用旧回合会合并两次
 * 发送。
 * Whether a message's content is nothing but tool results. Tool results live in
 * `role:'tool'` messages (OpenAI shape) or as `tool_result` parts of a user
 * message (Anthropic shape) — both skip. An *empty* text message is
 * deliberately not covered: per-request ids are the safe failure there.
 */
export function isToolResultOnly(role: string, content: unknown): boolean {
  if (role === 'tool') return true
  if (!Array.isArray(content) || content.length === 0) return false
  for (const part of content) {
    if (typeof part !== 'object' || part === null) return false
    const type = (part as Record<string, unknown>)['type']
    if (type !== 'tool_result' && type !== 'tool-result') return false
  }
  return true
}

/**
 * 命名这次 chat 回答的用户发送：倒数第一条真实用户消息（位置+签名）。
 * 重试/工具续跑/换账号重复它；用户下一条消息改变它。没有可签消息返回 ''，
 * 调用方改用每请求 id。
 * Names the user send a chat answers: the last genuine user message by place
 * and signature. Repeats across retries/continuations/account changes; changes
 * on the user's next message. Returns '' when nothing is signable.
 */
export function turnKeyOf(body: Record<string, unknown> | undefined): string {
  const messages = Array.isArray(body?.['messages']) ? (body['messages'] as unknown[]) : []
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (typeof message !== 'object' || message === null) continue
    const record = message as Record<string, unknown>
    if (record['role'] !== 'user') continue
    if (isToolResultOnly('user', record['content'])) continue
    const signature = messageSignature(record['content'])
    return signature === '' ? '' : `u${i}:${signature}`
  }
  return ''
}

/**
 * 命名会话：显式会话键优先，回退 chat 的首条真实用户消息。'' 表示无名——
 * 编造一个会话 id 正是碎片化使用明细的起点。
 * Names the conversation: an explicit session key first, else the chat's first
 * genuine user message. '' names nothing — a made-up id is where the
 * fragmentation starts.
 */
export function conversationKeyOf(body: Record<string, unknown> | undefined, sessionKey: string | undefined): string {
  if (sessionKey !== undefined && sessionKey !== '') return `session:${sessionKey}`
  const messages = Array.isArray(body?.['messages']) ? (body['messages'] as unknown[]) : []
  for (const message of messages) {
    if (typeof message !== 'object' || message === null) continue
    const record = message as Record<string, unknown>
    if (record['role'] !== 'user' || isToolResultOnly('user', record['content'])) continue
    const signature = messageSignature(record['content'])
    if (signature !== '') return `first:${signature}`
  }
  return ''
}

/**
 * 把会话追踪头族挂到 chat 请求上。入参是**已备好的** JSON 文本（真正发出的
 * 值），id 命名上线的东西而不是调用方的意图。非 JSON 体不抛：读不出形状的
 * chat 仍要可归因（只挂每请求 id）。调用方已带的同名头保留（HTTP 头名大小
 * 写不敏感，不加变体重名——fetch 会合并值）。
 * Attach the tracking family to a chat request. The body is the **prepared**
 * JSON text (what actually goes out), so ids name the wire, not the intent. A
 * non-JSON body still gets the per-request ids (attribution is unconditional).
 * Caller-carried headers win; no case-variant duplicates.
 */
export function withGatewayChatHeaders(
  headers: Record<string, string>,
  preparedBody: string,
  sessionKey?: string,
): Record<string, string> {
  let body: Record<string, unknown> | undefined
  try {
    const parsed: unknown = JSON.parse(preparedBody)
    body = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>) : undefined
  } catch {
    body = undefined
  }
  const getHeader = (name: string): string | undefined => {
    const key = Object.keys(headers).find(key => key.toLowerCase() === name.toLowerCase())
    return key === undefined ? undefined : headers[key]
  }
  const messageId = getHeader('X-Conversation-Message-ID') ?? getHeader('X-Request-ID') ?? conversationIdHex()
  if (getHeader('X-Conversation-Message-ID') === undefined) headers['X-Conversation-Message-ID'] = messageId
  if (getHeader('X-Request-ID') === undefined) headers['X-Request-ID'] = messageId
  const conversation = getHeader('X-Conversation-ID') ?? conversationKeyOf(body, sessionKey)
  const turn = turnKeyOf(body)
  if (getHeader('X-Conversation-Request-ID') === undefined) {
    headers['X-Conversation-Request-ID'] = turn === ''
      ? conversationIdHex()
      : derivedConversationId('turn', JSON.stringify([conversation, turn]))
  }
  if (conversation !== '' && getHeader('X-Conversation-ID') === undefined) {
    headers['X-Conversation-ID'] = derivedConversationId('conversation', conversation)
  }
  return headers
}
