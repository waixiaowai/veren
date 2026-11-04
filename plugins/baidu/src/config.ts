/**
 * 插件配置：开放平台应用三元组（appKey/secretKey/授权根）与超时。缺省值
 * 集中在 resolveConfig；appKey/secretKey 是应用级凭据，写在配置行里会以
 * 明文落盘——OAuth 用户令牌则只进凭据库，两者不是一个安全级。
 * Plugin configuration: the open-platform app triple (appKey/secretKey/root)
 * and timeouts. Defaults live centrally in resolveConfig; appKey/secretKey
 * are app-level credentials whose config-row form lands in plaintext — the
 * OAuth user tokens, by contrast, live only in the credential store. The two
 * are not the same safety tier.
 *
 * @module @veren/baidu-pan
 */

/** 插件配置形状（z 契约在 index.ts 单处声明）。The plugin config shape (the z contract is declared once in index.ts). */
export interface Config {
  /** 开放平台应用 AppKey（必填；缺它无法授权也无法调用）。The open-platform AppKey (required; no auth and no API without it). */
  appKey?: string
  /** 开放平台应用 SecretKey（必填；仅用于令牌端点，永不进日志）。The open-platform SecretKey (required; token endpoint only, never logged). */
  secretKey?: string
  /** 授权根目录（服务端路径，缺省 /apps/bdpan）。The authorized root (server path, default /apps/bdpan). */
  root?: string
  /** 单请求超时（毫秒）。Per-request timeout in milliseconds. */
  requestTimeoutMs?: number
  /** 瞬态失败最大尝试次数。Maximum attempts for transient failures. */
  maxAttempts?: number
}

/** 开放平台令牌端点。The open-platform token endpoint. */
export const TOKEN_ENDPOINT = 'https://openapi.baidu.com/oauth/2.0/token'

/** 开放平台授权页（用户在此拿到授权码）。The open-platform authorize page (the user obtains the code here). */
export const AUTHORIZE_ENDPOINT = 'https://openapi.baidu.com/oauth/2.0/authorize'

/** 网盘 OpenAPI 根。The netdisk OpenAPI root. */
export const API_BASE = 'https://pan.baidu.com/rest/2.0'

/** 设计方案固定的缺省授权根。The design's fixed default root. */
export const DEFAULT_ROOT = '/apps/bdpan'

/** 解析后的完整配置。The fully resolved configuration. */
export interface ResolvedConfig {
  appKey: string
  secretKey: string
  root: string
  requestTimeoutMs: number
  maxAttempts: number
}

/** 规范化授权根：以 / 开头、无末尾斜杠、无穿越段；非法值响亮失败。Normalizes the root: leading slash, no trailing slash, no traversal; illegal values fail loudly. */
function resolveRoot(input: string | undefined): string {
  const root = (input ?? DEFAULT_ROOT).trim()
  if (!root.startsWith('/')) {
    throw new Error('@veren/baidu-pan: config.root must be an absolute server path starting with "/"')
  }
  const normalized = root.length > 1 ? root.replace(/\/+$/, '') : '/'
  if (/(^|\/)\.\.?(\/|$)/.test(normalized)) {
    throw new Error('@veren/baidu-pan: config.root must not contain traversal segments')
  }
  return normalized
}

/** 缺省值与配置行合并；必填缺失在此响亮失败，不带病运行。Merges defaults with the config row; missing required fields fail loudly here instead of running sick. */
export function resolveConfig(config: Config): ResolvedConfig {
  const appKey = config.appKey?.trim() ?? ''
  const secretKey = config.secretKey?.trim() ?? ''
  if (appKey.length === 0 || secretKey.length === 0) {
    throw new Error('@veren/baidu-pan: config.appKey and config.secretKey are required (open-platform console)')
  }
  const resolved: ResolvedConfig = {
    appKey,
    secretKey,
    root: resolveRoot(config.root),
    requestTimeoutMs: config.requestTimeoutMs ?? 30_000,
    maxAttempts: config.maxAttempts ?? 3,
  }
  if (!Number.isFinite(resolved.requestTimeoutMs) || resolved.requestTimeoutMs <= 0) {
    throw new Error('@veren/baidu-pan: config.requestTimeoutMs must be a positive number')
  }
  if (!Number.isInteger(resolved.maxAttempts) || resolved.maxAttempts < 1 || resolved.maxAttempts > 10) {
    throw new Error('@veren/baidu-pan: config.maxAttempts must be an integer between 1 and 10')
  }
  return resolved
}

/** 拼授权页地址：用户打开后登录并拿到授权码（oob 形态，无回调服务）。Builds the authorize URL: the user opens it, signs in, and gets a code (oob shape — no callback server). */
export function authorizeUrl(config: ResolvedConfig): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.appKey,
    redirect_uri: 'oob',
    scope: 'basic,netdisk',
    display: 'page',
  })
  return `${AUTHORIZE_ENDPOINT}?${params.toString()}`
}
