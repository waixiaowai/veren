/**
 * Sub2API admin API kit: credential resolution, JWT login with automatic
 * re-login, the JSON envelope request helper, and the shared tool builder.
 * Sub2API 管理端套件：凭据解析、JWT 登录与自动重登、JSON 信封请求封装，
 * 以及共享的工具构造器。
 * @module @veren/sub2api-admin/client
 */
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ParameterSchemaSpec } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'

/** Plugin row config; every field is optional and falls back to `SUB2API_*` env. */
export interface AdminConfig {
  baseUrl?: string | null
  adminApiKey?: string | null
  adminJwt?: string | null
  email?: string | null
  password?: string | null
  timeoutMs?: number | null
}

/** Generic model-facing argument bag: action dispatchers read what they need. */
export type AdminArgs = Record<string, unknown>

/** Read one string argument. */
export function argString(args: AdminArgs, key: string): string | undefined {
  const value = args[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** Read one number argument. */
export function argNumber(args: AdminArgs, key: string): number | undefined {
  const value = args[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** Read one number-array argument (bulk ids). */
export function argNumbers(args: AdminArgs, key: string): number[] | undefined {
  const value = args[key]
  return Array.isArray(value) && value.every(item => typeof item === 'number') ? value : undefined
}

/** Read one free-form object argument (write patches). */
export function argObject(args: AdminArgs, key: string): Record<string, unknown> | undefined {
  const value = args[key]
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

/** String/number/boolean/object/integer parameter shorthands in the tool DSL. */
export const str = (description: string) => ({ type: 'string', description }) as const
export const integer = (description: string) => ({ type: 'integer', description }) as const
export const flag = (description: string) => ({ type: 'boolean', description }) as const
export const objParam = (description: string) => ({ type: 'object', description, additionalProperties: true }) as const
export const oneOf = (values: readonly string[], description: string) =>
  ({ type: 'string', enum: [...values], description }) as const
export const numberParam = (description: string) => ({ type: 'number', description }) as const
export const idList = (description: string) =>
  ({ type: 'array', items: { type: 'integer' }, description }) as const

/** The one output contract every admin tool uses: `{ result }` carrying API JSON. */
export const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    result: { type: 'object', required: true, additionalProperties: true },
  },
} as const

/** Wrap arbitrary API data so it always satisfies the `result: object` contract. */
function asObject(data: unknown): JsonValue {
  return typeof data === 'object' && data !== null && !Array.isArray(data)
    ? (data as JsonValue)
    : { value: data as JsonValue }
}

/** Deterministic JSON-text projection for every canonical tool value. */
function renderValue(_args: unknown, value: unknown): ContentBlock[] {
  return [{ type: 'text', text: JSON.stringify(value, undefined, 2) }]
}

/**
 * Build one admin tool: execute calls `run`, wraps its data in `{ result }`,
 * and fires the optional `after` hook on success (store-slice refresh).
 * 构造管理工具：execute 调 run、把数据包进 `{ result }`，成功后触发可选
 * `after` 钩子（用于 store 切片刷新）。run 收到工具执行上下文（无人值守
 * 分级门从它的 session 投影读本回合同意信号）。
 * run receives the tool execution context (the unattended level gate reads the
 * turn's consent signal from its session projection).
 */
/** 工具执行上下文里本包需要的最小结构面（真实 defineTool exec 结构兼容）
 * / the minimal structural face this package needs from the tool execution context (the real defineTool exec is structurally compatible) */
export interface GateExec {
  readonly agent?: {
    readonly session?: {
      readonly deriveMessages?: () => readonly import('@deepseek-ai/dsh-llm').Message[]
    }
  }
}

export function adminTool(options: {
  name: string
  description: string
  parameters: ParameterSchemaSpec
  timeoutMs?: number
  run: (args: AdminArgs, exec: GateExec) => Promise<unknown>
  after?: (args: AdminArgs) => void
}) {
  return defineTool({
    name: options.name,
    description: options.description,
    parameters: options.parameters,
    ...options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs },
    output: { schema: OUTPUT_SCHEMA, render: renderValue },
    async execute(args, exec) {
      // exec 缺省成空面：无会话投影 = 无人 = L2 门 fail-closed 拒绝
      // / exec defaults to an empty face: no session projection = unattended = the L2 gate refuses fail-closed
      const value = { result: asObject(await options.run((args ?? {}) as AdminArgs, (exec ?? {}) as GateExec)) as Record<string, JsonValue> }
      options.after?.((args ?? {}) as AdminArgs)
      // The output schema pins `result` to an object; asObject guarantees that shape.
      return value
    },
  })
}

/** Join optional query parameters into a `?a=b` suffix, dropping empty values. */
export function toQuery(query: Record<string, unknown>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value))
  }
  const encoded = search.toString()
  return encoded.length > 0 ? `?${encoded}` : ''
}

/** Auth login path of the Sub2API backend. */
const LOGIN_PATH = '/api/v1/auth/login'

/** Structured failure thrown for every non-success admin response. */
export class Sub2ApiError extends Error {
  readonly code: 'SUB2API_NETWORK' | 'SUB2API_REQUEST_FAILED'
  readonly status?: number

  constructor(code: 'SUB2API_NETWORK' | 'SUB2API_REQUEST_FAILED', message: string, status?: number) {
    super(message)
    this.code = code
    if (status !== undefined) this.status = status
  }
}

/** Normalize the base URL: strip trailing slashes, require http(s). */
function normalizeBaseUrl(raw: string | null | undefined): string {
  const url = String(raw ?? '').replace(/\/+$/, '')
  if (url.length === 0) {
    throw new Sub2ApiError('SUB2API_REQUEST_FAILED', 'Sub2API baseUrl is missing: set the plugin config baseUrl or SUB2API_BASE_URL')
  }
  if (!/^https?:\/\//.test(url)) {
    throw new Sub2ApiError('SUB2API_REQUEST_FAILED', `Sub2API baseUrl must start with http(s)://, got: ${url}`)
  }
  return url
}

/**
 * Credential resolution order: plugin row config first, `SUB2API_*` environment
 * variables as fallback. Credentials never live in plugin code.
 * 凭据解析顺序：插件行 config 优先，`SUB2API_*` 环境变量兜底；凭据不进代码。
 */
export function resolveSettings(config: AdminConfig) {
  const env = process.env
  const timeout = config.timeoutMs ?? env.SUB2API_TIMEOUT_MS
  return {
    baseUrl: normalizeBaseUrl(config.baseUrl ?? env.SUB2API_BASE_URL),
    apiKey: config.adminApiKey ?? env.SUB2API_ADMIN_API_KEY ?? '',
    jwt: config.adminJwt ?? env.SUB2API_JWT ?? '',
    email: config.email ?? env.SUB2API_EMAIL ?? '',
    password: config.password ?? env.SUB2API_PASSWORD ?? '',
    timeoutMs: Number(timeout) > 0 ? Number(timeout) : 30000,
  }
}

export class Sub2AdminClient {
  private readonly settings: ReturnType<typeof resolveSettings>
  private token = ''

  constructor(config: AdminConfig) {
    this.settings = resolveSettings(config)
    this.token = this.settings.jwt
  }

  /** Build auth headers; log in once when only email+password are available. */
  private async authHeaders(): Promise<Record<string, string>> {
    if (this.settings.apiKey.length > 0) return { 'x-api-key': this.settings.apiKey }
    if (this.token.length === 0) await this.login()
    return { Authorization: `Bearer ${this.token}` }
  }

  /** Email+password login; caches the access token for later requests. */
  async login(): Promise<void> {
    const { email, password } = this.settings
    if (email.length === 0 || password.length === 0) {
      throw new Sub2ApiError('SUB2API_REQUEST_FAILED', 'Sub2API credentials missing: set adminApiKey, adminJwt, or email+password (config or SUB2API_* env)')
    }
    const data = await this.raw('POST', LOGIN_PATH, { email, password })
    const token = typeof (data as { access_token?: unknown })?.access_token === 'string'
      ? (data as { access_token: string }).access_token
      : ''
    if (token.length === 0) {
      throw new Sub2ApiError('SUB2API_REQUEST_FAILED', 'Sub2API login succeeded but no access_token was returned')
    }
    this.token = token
  }

  /**
   * One admin request returning the envelope's `data` field; on 401 with
   * password credentials available, re-login once and retry.
   * 一次管理端请求并返回信封 `data`；401 且具备密码登录条件时重登一次后重试。
   */
  async request(method: string, pathname: string, body?: unknown, extraHeaders: Record<string, string> = {}): Promise<unknown> {
    try {
      return await this.raw(method, pathname, body, { ...(await this.authHeaders()), ...extraHeaders })
    } catch (error) {
      const relogin = error instanceof Sub2ApiError
        && error.status === 401 && this.settings.apiKey.length === 0 && this.settings.email.length > 0
      if (!relogin) throw error
      this.token = ''
      await this.login()
      return this.raw(method, pathname, body, { ...(await this.authHeaders()), ...extraHeaders })
    }
  }

  /** One HTTP call: parse the JSON envelope, treat non-zero `code` as failure. */
  private async raw(method: string, pathname: string, body: unknown, headers: Record<string, string> = {}): Promise<unknown> {
    const url = `${this.settings.baseUrl}${pathname.startsWith('/api/v1') ? pathname : `/api/v1${pathname}`}`
    const init: RequestInit = { method, headers: { Accept: 'application/json', ...headers } }
    if (body !== undefined) {
      init.headers = { ...init.headers, 'Content-Type': 'application/json' }
      init.body = JSON.stringify(body)
    }
    let response: Response
    try {
      response = await fetch(url, { ...init, signal: AbortSignal.timeout(this.settings.timeoutMs) })
    } catch (cause) {
      throw new Sub2ApiError('SUB2API_NETWORK', `Sub2API ${method} ${pathname} network error: ${String(cause instanceof Error ? cause.message : cause)}`)
    }
    const text = await response.text()
    let envelope: { code?: unknown, message?: string, data?: unknown }
    try {
      envelope = JSON.parse(text) as { code?: unknown, message?: string, data?: unknown }
    } catch {
      envelope = { code: response.ok ? 0 : -1, message: text.slice(0, 400), data: null }
    }
    const failed = !response.ok || (envelope.code !== undefined && envelope.code !== 0 && envelope.code !== '0')
    if (failed) {
      throw new Sub2ApiError('SUB2API_REQUEST_FAILED', `Sub2API ${method} ${pathname} failed (${response.status}): ${envelope.message ?? response.statusText}`, response.status)
    }
    return envelope.data
  }
}
