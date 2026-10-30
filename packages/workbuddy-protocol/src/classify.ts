/**
 * 错误分类学：HTTP 状态 + 响应体摘录 → 失败闭集，及冷却时长表。
 * The error taxonomy: HTTP status + body excerpt → the closed failure set,
 * plus the cooldown duration table.
 *
 * **额度判定先于状态码兜底，刻意**：实测（2026-09-30，真耗尽账号）上游答
 * **HTTP 429** + code 14018 +「额度已用尽…购买加量包」。429 平日是限流——但
 * "没额度"在用户付费前是永久的，"慢一点"自己会好。把前者当后者，池子就会
 * 永远重试死账号。所以体标记对**每个**状态都查，不是只在 402 后查。
 * **Credit is checked before the status-code fallbacks, deliberately**: measured
 * live (2026-09-30, a genuinely exhausted account), the upstream answers **HTTP
 * 429** with code 14018. 429 otherwise means rate limiting — but "no credit" is
 * permanent until the user pays while "slow down" clears on its own; conflating
 * them makes the pool retry a dead account forever. Body markers are therefore
 * consulted for every status.
 *
 * 证据：docs/workbuddy-protocol.cn.md §6；卷宗 upstream.ts:336-400, shim.ts:42-45。
 * Evidence: docs/workbuddy-protocol.md §6; dossier upstream.ts:336-400, shim.ts:42-45.
 *
 * @module @veren/workbuddy-protocol/classify
 */

import { assertNeverKind, type UpstreamErrorKind } from './errors.ts'

/** 额度耗尽标记：ASCII 小写 + 中文原文（「已」变体单列——它们不是「额度用尽」的子串）。 */
/** Credit-exhaustion markers: ASCII lowercase plus the original Chinese (「已」variants listed separately — not substrings of the plain form). */
export const HARD_CREDIT_MARKERS: readonly string[] = [
  'insufficient credit', 'no credit', 'credit exhausted', 'credits exhausted', 'out of credit',
  'quota exceeded', 'quota exhaust', 'payment required', 'credit not enough', 'not enough credit',
  '额度已用尽', '额度已用完', '额度用尽', '额度不足', '额度已不足',
  '积分不足', '积分已用完', '积分用完', '余额不足', '没有积分',
]

/** 上游业务 code：`14018` 是实测耗尽码，嵌在 `error.data.code` 里，按体文本匹配。 */
/** Upstream business code `14018` is the measured exhaustion code; matched against the body text. */
export const HARD_CREDIT_CODES: readonly string[] = ['14018']

/** 会话失效标记（还有 401 本身）。Session-invalidation markers (plus a bare 401). */
export const SESSION_DEAD_MARKERS: readonly string[] = ['Offline user session not found', '12153']

/** 冷却时长表（毫秒）。session_dead/client/not_found 不冷却：重试无益或需人工。 */
/** Cooldown durations (ms). session_dead/client/not_found get none: retrying is pointless or needs a human. */
export const FAILURE_COOLDOWN_MS: Readonly<Record<'hard_credit' | 'soft_rate' | 'server', number>> = {
  hard_credit: 60 * 60_000,
  soft_rate: 60_000,
  server: 10_000,
}

/** 一个类别该冷却多久；不冷却的类别返回 undefined。How long one kind cools; non-cooling kinds answer undefined. */
export function cooldownForKind(kind: UpstreamErrorKind): number | undefined {
  switch (kind) {
    case 'hard_credit': return FAILURE_COOLDOWN_MS.hard_credit
    case 'soft_rate': return FAILURE_COOLDOWN_MS.soft_rate
    case 'server': return FAILURE_COOLDOWN_MS.server
    case 'session_dead': return undefined
    case 'not_found': return undefined
    case 'client': return undefined
    default: return assertNeverKind(kind)
  }
}

/**
 * 分类一条上游失败。顺序承重：402 → 401 → 体标记（额度先、会话死后）→ 状态码。
 * Classify one upstream failure. The order is load-bearing: 402 → 401 → body
 * markers (credit first, session-dead second) → status codes.
 */
export function classifyUpstreamError(status: number, body: string): UpstreamErrorKind {
  if (status === 402) return 'hard_credit'
  // 401 是鉴权失败，无论体说什么：本上游没有可覆盖它的业务含义；
  // 会话死标记只是附加信号（还接住答成 403 的死会话）。
  // A 401 is an auth failure whatever its body says; the markers below are an
  // additional signal (they also catch dead sessions answered as 403).
  if (status === 401) return 'session_dead'
  const lower = body.toLowerCase()
  for (const marker of HARD_CREDIT_MARKERS) {
    if (lower.includes(marker.toLowerCase()) || body.includes(marker)) return 'hard_credit'
  }
  for (const code of HARD_CREDIT_CODES) {
    if (body.includes(code)) return 'hard_credit'
  }
  for (const marker of SESSION_DEAD_MARKERS) {
    if (body.includes(marker)) return 'session_dead'
  }
  if (status === 429) return 'soft_rate'
  if (status === 404) return 'not_found'
  if (status >= 500) return 'server'
  return 'client'
}

/**
 * 从错误体提取用户可见消息：`displayMsg.zh` > `displayMsg.en` > `msg`。
 * 非 JSON 体返回 undefined。
 * Extract a user-facing message: `displayMsg.zh` > `displayMsg.en` > `msg`.
 * Non-JSON bodies answer undefined.
 */
export function extractDisplayErrorMessage(body: string): string | undefined {
  const trimmed = body.trim()
  if (!trimmed.startsWith('{')) return undefined
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
    const obj = parsed as Record<string, unknown>
    const displayMsg = obj['displayMsg']
    if (typeof displayMsg === 'object' && displayMsg !== null && !Array.isArray(displayMsg)) {
      const localized = displayMsg as Record<string, unknown>
      if (typeof localized['zh'] === 'string' && localized['zh'].trim() !== '') return localized['zh'].trim()
      if (typeof localized['en'] === 'string' && localized['en'].trim() !== '') return localized['en'].trim()
    }
    if (typeof obj['msg'] === 'string' && obj['msg'].trim() !== '') return obj['msg'].trim()
  } catch {
    // 非 JSON 体保持 undefined。Non-JSON bodies stay undefined.
  }
  return undefined
}
