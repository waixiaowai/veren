/**
 * 统一错误码：四条通路（工具、客户端、守门、授权流）共用的唯一语义来源。
 * 码只描述"失败的性质"，不描述界面文案；上游四种错误形态先归一再消费。
 * 文案遵循三段式（事实—原因—下一步），中英双语。
 * Unified error codes: the single semantic source shared by tools, the
 * client, the guard, and the auth flow. Codes describe the nature of the
 * failure, never the copy; all four upstream error shapes normalize here
 * first. Copy follows the fact-cause-next-step pattern, bilingual.
 *
 * @module @veren/baidu-pan
 */
import type { OAuthTokens } from './types.js'

/** 统一错误码闭集。The closed set of unified error codes. */
export type BaiduPanCode =
  | 'BDPAN_INVALID_ARG'
  | 'BDPAN_INVALID_FSID'
  | 'BDPAN_INVALID_NAME'
  | 'BDPAN_PATH_OUT_OF_SCOPE'
  | 'BDPAN_CONFIRM_REQUIRED'
  | 'BDPAN_NOT_FOUND'
  | 'BDPAN_ALREADY_EXISTS'
  | 'BDPAN_AUTH_REQUIRED'
  | 'BDPAN_TOKEN_EXPIRED'
  | 'BDPAN_TOKEN_INVALID'
  | 'BDPAN_FORBIDDEN'
  | 'BDPAN_QUOTA_EXCEEDED'
  | 'BDPAN_RATE_LIMITED'
  | 'BDPAN_CONFIG_MISSING'
  | 'BDPAN_OUTPUT_UNCERTAIN'
  | 'BDPAN_NETWORK'
  | 'BDPAN_UPSTREAM'
  | 'BDPAN_UNKNOWN'

/** 每个码的双语用户可见文案（三段式）。Bilingual user-facing copy per code (fact-cause-next-step). */
const CODE_COPY: Readonly<Record<BaiduPanCode, { zh: string; en: string }>> = {
  BDPAN_INVALID_ARG: { zh: '请求的参数不完整或互相冲突，请检查后重试。', en: 'The arguments are incomplete or conflict; check them and retry.' },
  BDPAN_INVALID_FSID: { zh: '文件标识不正确，请重新选择文件。', en: 'That file id is not valid; pick the file again.' },
  BDPAN_INVALID_NAME: { zh: '名称不能包含路径分隔符，请换一个名称。', en: 'Names cannot contain path separators; pick another name.' },
  BDPAN_PATH_OUT_OF_SCOPE: { zh: '只能操作"我的应用数据"授权根目录下的内容。', en: 'Only content under the app\'s authorized root ("My App Data") can be touched.' },
  BDPAN_CONFIRM_REQUIRED: { zh: '这个操作会影响已有内容，需要用户确认后我再执行。', en: 'This would affect existing content; it needs the user\'s confirmation first.' },
  BDPAN_NOT_FOUND: { zh: '没有找到对应内容，请确认路径或名称。', en: 'Nothing was found there; double-check the path or name.' },
  BDPAN_ALREADY_EXISTS: { zh: '目标位置已有同名内容，可以另存或覆盖。', en: 'A same-named item already exists there; save-as or overwrite instead.' },
  BDPAN_AUTH_REQUIRED: { zh: '还没有登录百度网盘，请先完成授权。', en: 'Not signed in to Baidu Netdisk yet; complete the sign-in first.' },
  BDPAN_TOKEN_EXPIRED: { zh: '授权已过期，需要重新登录。', en: 'The authorization has expired; sign in again.' },
  BDPAN_TOKEN_INVALID: { zh: '授权已失效，需要重新登录。', en: 'The authorization is no longer valid; sign in again.' },
  BDPAN_FORBIDDEN: { zh: '当前账号没有访问这个内容的权限。', en: 'This account has no access to that content.' },
  BDPAN_QUOTA_EXCEEDED: { zh: '网盘空间不足，请清理后再试。', en: 'The netdisk is out of space; free some up and retry.' },
  BDPAN_RATE_LIMITED: { zh: '请求太频繁，稍等片刻再试。', en: 'Requests are too frequent; wait a moment and retry.' },
  BDPAN_CONFIG_MISSING: { zh: '插件缺少 appKey/secretKey 配置，请在宿主配置里补齐后再授权。', en: 'The plugin lacks appKey/secretKey config; fill them in the host config before signing in.' },
  BDPAN_OUTPUT_UNCERTAIN: { zh: '这次操作的结果还不确定，先查一下实际落盘情况再下结论。', en: 'The outcome of this operation is uncertain; verify what actually landed before concluding.' },
  BDPAN_NETWORK: { zh: '网络连接不稳定，稍后重试。', en: 'The network connection is unstable; retry shortly.' },
  BDPAN_UPSTREAM: { zh: '服务暂时没有返回可用结果，请稍后再试。', en: 'The service returned nothing usable; try again shortly.' },
  BDPAN_UNKNOWN: { zh: '遇到了未预期的问题，请稍后重试。', en: 'An unexpected problem occurred; retry later.' },
}

/** 结构化失败对象：稳定码 + 机器可读字段 + 脱敏诊断。The structured failure: stable code + machine-readable fields + redacted diagnostics. */
export class BaiduPanError extends Error {
  readonly code: BaiduPanCode
  readonly retryable: boolean
  /** 上游原始错误号，仅用于排查。The raw upstream errno, diagnostics only. */
  readonly upstreamCode?: number
  /** 脱敏后的诊断信息（方法与 URL，无响应体原文）。Redacted diagnostics (method and URL, no raw body). */
  readonly diagnostics: { method?: string; url?: string }

  constructor(code: BaiduPanCode, message: string, options: {
    retryable?: boolean
    upstreamCode?: number
    diagnostics?: { method?: string; url?: string }
    cause?: unknown
  } = {}) {
    super(message, options.cause === undefined ? {} : { cause: options.cause })
    this.name = 'BaiduPanError'
    this.code = code
    this.retryable = options.retryable ?? false
    this.upstreamCode = options.upstreamCode
    this.diagnostics = options.diagnostics ?? {}
  }
}

/** 便捷构造：带上该码的双语文案。Convenience builder: attaches the code's bilingual copy. */
export function baiduPanError(code: BaiduPanCode, options: {
  retryable?: boolean
  upstreamCode?: number
  detail?: string
  diagnostics?: { method?: string; url?: string }
  cause?: unknown
} = {}): BaiduPanError {
  const copy = CODE_COPY[code]
  const detail = options.detail === undefined ? '' : ` (${options.detail})`
  return new BaiduPanError(code, `${copy.zh} ${copy.en}${detail}`, options)
}

/** 上游错误号 → 统一码的映射表（唯一依据，禁止在接口内另写判断）。The upstream-errno → unified-code map (the sole authority; no per-call-site re-judgement). */
const UPSTREAM_MAP: Readonly<Record<number, BaiduPanCode>> = {
  [-6]: 'BDPAN_FORBIDDEN',
  [-7]: 'BDPAN_INVALID_NAME',
  [-8]: 'BDPAN_ALREADY_EXISTS',
  [-9]: 'BDPAN_NOT_FOUND',
  [-10]: 'BDPAN_QUOTA_EXCEEDED',
  2: 'BDPAN_INVALID_ARG',
  12: 'BDPAN_UPSTREAM',
  20016: 'BDPAN_TOKEN_EXPIRED',
  20017: 'BDPAN_TOKEN_INVALID',
  31045: 'BDPAN_TOKEN_INVALID',
  31023: 'BDPAN_FORBIDDEN',
  31034: 'BDPAN_RATE_LIMITED',
  31190: 'BDPAN_QUOTA_EXCEEDED',
  64004: 'BDPAN_RATE_LIMITED',
}

/** 可重试的统一码集合（其余一律不重试）。The retryable unified codes (everything else never retries). */
const RETRYABLE_CODES: ReadonlySet<BaiduPanCode> = new Set([
  'BDPAN_RATE_LIMITED', 'BDPAN_NETWORK', 'BDPAN_UPSTREAM',
])

/** 把上游错误号归一成统一失败；映射表外的号码一律 BDPAN_UPSTREAM。Normalizes an upstream errno into the unified failure; unmapped errnos land on BDPAN_UPSTREAM. */
export function mapUpstream(errno: number, diagnostics: { method?: string; url?: string } = {}): BaiduPanError {
  const code = UPSTREAM_MAP[errno] ?? 'BDPAN_UPSTREAM'
  return baiduPanError(code, { upstreamCode: errno, retryable: RETRYABLE_CODES.has(code), diagnostics })
}

/** 网络层失败（中断/超时/DNS）→ 可重试的 BDPAN_NETWORK。Network-layer failure → retryable BDPAN_NETWORK. */
export function networkError(cause: unknown, diagnostics: { method?: string; url?: string } = {}): BaiduPanError {
  return baiduPanError('BDPAN_NETWORK', { retryable: true, cause, diagnostics })
}

/** 工具输出的错误规范值：错误走值不走异常，模型读结构化 code 自行纠偏。The tool-output error value: errors travel as values, so the model reads the code and self-corrects. */
export interface ToolErrorValue {
  readonly kind: 'error'
  readonly code: BaiduPanCode
  readonly message: string
  readonly retryable: boolean
}

/** 把任意抛出折成规范错误值；非本域错误折成 BDPAN_UNKNOWN。Folds any thrown value into the canonical error value; foreign errors fold to BDPAN_UNKNOWN. */
export function toErrorValue(error: unknown): ToolErrorValue {
  if (error instanceof BaiduPanError) {
    return { kind: 'error', code: error.code, message: error.message, retryable: error.retryable }
  }
  const message = error instanceof Error ? error.message : String(error)
  return { kind: 'error', code: 'BDPAN_UNKNOWN', message: `${CODE_COPY.BDPAN_UNKNOWN.zh} ${CODE_COPY.BDPAN_UNKNOWN.en} (${message})`, retryable: false }
}

/** 凭据载荷的形状守卫：GrantRecord.payload 按 OAuthTokens 逐字段校验。The grant-payload shape guard: validates GrantRecord.payload field-by-field as OAuthTokens. */
export function parseGrantPayload(payload: unknown): OAuthTokens | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined
  const candidate = payload as Partial<OAuthTokens>
  if (typeof candidate.accessToken !== 'string' || candidate.accessToken.length === 0) return undefined
  if (typeof candidate.refreshToken !== 'string' || candidate.refreshToken.length === 0) return undefined
  if (typeof candidate.expiresAt !== 'string' || Number.isNaN(Date.parse(candidate.expiresAt))) return undefined
  if (typeof candidate.scope !== 'string') return undefined
  return { accessToken: candidate.accessToken, refreshToken: candidate.refreshToken, expiresAt: candidate.expiresAt, scope: candidate.scope }
}
