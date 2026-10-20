/**
 * Tool-boundary values: JSON projection, argument guards, and view builders.
 *
 * Every tool returns one JSON object. Failures are values, not thrown errors:
 * `{ ok: false, error: { code, message } }`. The code is a stable `IM_*` value
 * so a model can branch without parsing prose.
 *
 * 工具边界值：JSON 投影、参数守卫与视图构造。
 *
 * 每个工具都返回一个 JSON 对象。失败是值而不是抛出的错误：`{ ok: false, error: { code, message } }`。
 * code 是稳定的 `IM_*` 值，模型无需解析自然语言即可分支。
 *
 * @module @veren/im-tool/values
 */

import { readFile, stat } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { ImError } from '@veren/im'
import type {
  ImAccount,
  ImBindAttempt,
  ImBinding,
  ImBindingSettings,
  ImMessageContent,
} from '@veren/im'

/** Project one plain record onto lossless JSON. */
export function jsonOf(value: Record<string, unknown>): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue
}

/** Wrap a successful payload. */
export function ok(value: Record<string, unknown>): JsonValue {
  return jsonOf({ ok: true, ...value })
}

/** Turn any failure into the stable failure result. */
export function fail(error: unknown): JsonValue {
  const code = error instanceof ImError ? error.code : 'IM_INTERNAL'
  const message = error instanceof ImError ? error.message : 'the IM operation failed'
  const details = error instanceof ImError ? error.details : undefined
  return jsonOf({
    ok: false,
    error: {
      code,
      message,
      ...(details === undefined ? {} : { details: { ...details } }),
    },
  })
}

/** Run one tool body, converting failures into the failure result. */
export async function run(work: () => Promise<JsonValue>): Promise<JsonValue> {
  try {
    return await work()
  } catch (error: unknown) {
    return fail(error)
  }
}

/** Require a non-empty string argument. */
export function requireString(value: string | undefined, field: string): string {
  if (value === undefined || value.trim() === '') {
    throw new ImError('IM_INVALID_REQUEST', `${field} is required`)
  }
  return value
}

/** Validate and copy the optional binding settings object. */
export function settingsOf(value: JsonValue | undefined): ImBindingSettings {
  if (value === undefined) return {}
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ImError('IM_INVALID_REQUEST', 'settings must be an object')
  }
  const record = value as Record<string, JsonValue>
  const settings: ImBindingSettings = {}
  for (const key of ['presetId', 'provider', 'model', 'reasoning'] as const) {
    const field = record[key]
    if (field === undefined) continue
    if (typeof field !== 'string' || field.length === 0) {
      throw new ImError('IM_INVALID_REQUEST', `settings.${key} must be a non-empty string`)
    }
    settings[key] = field
  }
  return settings
}

/** Project one account onto the tool view. */
export function accountView(account: ImAccount): Record<string, unknown> {
  return {
    id: account.id,
    displayName: account.displayName,
    status: account.status,
    ...(account.ownerId === undefined ? {} : { ownerId: account.ownerId }),
  }
}

/** Project one binding onto the tool view. */
export function bindingView(binding: ImBinding): Record<string, unknown> {
  return {
    id: binding.id,
    accountId: binding.accountId,
    conversationId: binding.conversationId,
    sessionId: binding.sessionId,
    active: binding.active,
    settings: binding.settings,
  }
}

/**
 * Project one bind attempt onto the tool view.
 *
 * The remote challenge URL is deliberately stripped: only the local QR path and
 * the expiry are safe to hand to a tool caller.
 */
export function bindView(attempt: ImBindAttempt, account?: ImAccount): JsonValue {
  const challenge = attempt.challenge
  const view: Record<string, unknown> = {
    bindId: attempt.bindId,
    status: attempt.status,
  }
  if (challenge !== undefined) {
    view.challenge = {
      kind: challenge.kind,
      ...(challenge.userCode === undefined ? {} : { userCode: challenge.userCode }),
      ...(challenge.expiresAt === undefined ? {} : { expiresAt: challenge.expiresAt }),
      ...(challenge.imagePath === undefined ? {} : { imagePath: challenge.imagePath }),
    }
    if (challenge.expiresAt !== undefined) view.expiresAt = challenge.expiresAt
    if (challenge.imagePath !== undefined) view.qrPath = challenge.imagePath
  }
  if (account !== undefined) view.account = accountView(account)
  return jsonOf({ ok: true, ...view })
}

/** Build one local file content block. */
export async function fileContentOf(path: string): Promise<ImMessageContent> {
  const info = await stat(path)
  if (!info.isFile()) throw new ImError('IM_INVALID_REQUEST', `not a file: ${path}`)
  const name = basename(path)
  return {
    type: 'file',
    mime: mimeOf(path),
    name,
    size: info.size,
    load: () => readFile(path),
  }
}

/** Minimal MIME table for the file extension point. */
function mimeOf(path: string): string {
  switch (extname(path).toLowerCase()) {
    case '.txt': return 'text/plain'
    case '.md': return 'text/markdown'
    case '.json': return 'application/json'
    case '.pdf': return 'application/pdf'
    case '.png': return 'image/png'
    case '.jpg':
    case '.jpeg': return 'image/jpeg'
    case '.gif': return 'image/gif'
    case '.webp': return 'image/webp'
    case '.zip': return 'application/zip'
    default: return 'application/octet-stream'
  }
}
