/**
 * 请求体准备：上游对 OpenAI 兼容体的方言约束。
 * Body preparation: the upstream's dialect constraints on an OpenAI-compatible
 * body.
 *
 * - `stream:true` 强制（上游拒绝非流式）。
 * - `developer` 角色改写为 `system`（上游拒 developer：HTTP 400/11128「Illegal
 *   API invocation from an unapproved channel」）。
 * - `tool_choice` 折叠为字符串（对象形原样发会 400）。
 * - `reasoning_effort:'off'` **两区域都删**：字段缺省是唯一各处实测皆过的形态；
 *   字面 `'none'` 不是安全替代（GPT-5.6 家族与 GLM 收、`gpt-6-astra` 拒）。
 * - 国际版独有：首条消息必须是 system（400/11128「first message is not system
 *   prompt」）——缺则前插最小 system 提示，前插不合并。
 * - `stream:true` forced (the upstream rejects non-streaming).
 * - `developer` rewritten to `system` (rejected upstream with 400/11128).
 * - `tool_choice` flattened to a string (object forms get 400).
 * - `reasoning_effort:'off'` dropped on both regions (omission is the only form
 *   measured good everywhere).
 * - International only: the first message must be a system prompt — prepend a
 *   minimal one when absent (prepend, never merge).
 *
 * 证据：docs/workbuddy-protocol.cn.md §3.2；卷宗 upstream.ts:708-784, 1590-1706。
 * Evidence: docs/workbuddy-protocol.md §3.2; dossier upstream.ts:708-784, 1590-1706.
 *
 * @module @veren/workbuddy-protocol/chat-body
 */

/** 国际版缺 system 时前插的最小提示：只为满足网关前置条件，绝不借它塑造人格。 */
/** The minimal system prompt prepended internationally: satisfies a gateway precondition, never a persona. */
export const INTERNATIONAL_SYSTEM_PROMPT = 'You are a helpful assistant.'

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** `developer` → `system`（上游拒 developer 角色，改写是兼容拼写）。 */
/** `developer` → `system` (the upstream rejects developer; the rewrite is the compatible spelling). */
function normalizeDeveloperRole(obj: Record<string, unknown>): void {
  const messages = obj['messages']
  if (!Array.isArray(messages)) return
  for (const message of messages) {
    if (!isObject(message)) continue
    if (message['role'] === 'developer') message['role'] = 'system'
  }
}

/** `tool_choice` 折叠为上游的字符串形。Flatten OpenAI `tool_choice` spellings into the upstream's string form. */
function normalizeToolChoice(obj: Record<string, unknown>): void {
  const suppress = (): void => {
    delete obj['tools']
    delete obj['functions']
  }
  if (!('tool_choice' in obj)) return
  const choice: unknown = obj['tool_choice']
  if (typeof choice === 'string') {
    if (choice.trim().toLowerCase() === 'none') {
      delete obj['tool_choice']
      suppress()
    }
    return
  }
  if (isObject(choice)) {
    const type = typeof choice['type'] === 'string' ? choice['type'].trim().toLowerCase() : ''
    if (type === 'none') {
      delete obj['tool_choice']
      suppress()
    } else if (type === 'auto' || type === 'required') {
      obj['tool_choice'] = type
    } else if (type === 'function') {
      const fn = isObject(choice['function']) ? choice['function'] : choice
      const name = typeof fn['name'] === 'string' ? fn['name'].trim() : ''
      obj['tool_choice'] = name !== '' ? name : 'auto'
    } else {
      delete obj['tool_choice']
    }
    return
  }
  delete obj['tool_choice']
}

/** 删掉两端都拒的 `off` 档位拼写（声明档位与显式 none 原样放行）。 */
/** Drop the `off` effort spelling both endpoints reject (declared spellings and an explicit none pass through). */
function dropUnsupportedEffort(obj: Record<string, unknown>): void {
  if (obj['reasoning_effort'] === 'off') delete obj['reasoning_effort']
}

/**
 * 公共准备：stream 强制 + developer 改写 + tool_choice 折叠 + off 删除。
 * 非 JSON 对象原样返回——对已备好或未备好的体都安全。
 * Common preparation. Non-JSON-object bodies return unchanged — safe over
 * prepared or unprepared bodies alike.
 */
export function prepareChatBody(source: string): string {
  let body: unknown
  try {
    body = JSON.parse(source)
  } catch {
    return source
  }
  if (!isObject(body)) return source
  body['stream'] = true
  normalizeDeveloperRole(body)
  normalizeToolChoice(body)
  dropUnsupportedEffort(body)
  return JSON.stringify(body)
}

/** CN 体准备：公共准备已覆盖全部 CN 已知方言，本函数只为调用点对称而存在。 */
/** CN body preparation: the common pass already covers every known CN dialect; kept for call-site symmetry. */
export function prepareCnChatBody(source: string): string {
  return prepareChatBody(source)
}

/**
 * 国际体准备：公共准备 + 首条消息必须是 system（400/11128）。缺则**前插**最
 * 小 system 提示——既有消息保持原有顺序与措辞。
 * International body preparation: the common pass plus the leading-system
 * precondition (400/11128). A minimal system prompt is **prepended** when
 * absent; existing messages keep their order and wording.
 */
export function prepareInternationalChatBody(source: string): string {
  const prepared = prepareChatBody(source)
  let body: unknown
  try {
    body = JSON.parse(prepared)
  } catch {
    return prepared
  }
  if (!isObject(body)) return prepared
  const messages = body['messages']
  if (!Array.isArray(messages)) return JSON.stringify(body)
  const first = messages[0]
  if (isObject(first) && first['role'] === 'system') return JSON.stringify(body)
  messages.unshift({ role: 'system', content: INTERNATIONAL_SYSTEM_PROMPT })
  return JSON.stringify(body)
}

/** 按区域分派的体准备入口。The region-dispatched body-preparation entry. */
export function prepareBodyForRegion(region: 'cn' | 'global', source: string): string {
  return region === 'global' ? prepareInternationalChatBody(source) : prepareCnChatBody(source)
}
