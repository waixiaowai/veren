/**
 * guard 安全闸门：任何请求出网前先过这里——路径是否落在授权根内、名称
 * 是否合法、危险动作是否持有恰好覆盖目标集合的确认凭证。拒绝（不可重试）
 * 与"需要确认"（可重试）必须分开。日志与诊断统一脱敏。
 * The guard gate: every request passes here before leaving the process —
 * is the path inside the authorized root, is the name legal, and does a
 * dangerous action carry a confirmation covering exactly the target set.
 * Deny (unretryable) and "needs confirmation" (retryable) stay distinct.
 * Logs and diagnostics are uniformly redacted.
 *
 * @module @veren/baidu-pan
 */

/** 路径裁决理由（闭集）。The path-verdict reason (closed set). */
export type PathReason =
  | 'ok' | 'traversal' | 'outside-root' | 'encoded-traversal'
  | 'tilde' | 'invalid-name' | 'platform-trap' | 'empty'

/** 路径裁决：allowed 决定放行与否，normalized 是服务端路径，displayPath 面向用户。The path verdict: allowed gates the call, normalized is the server path, displayPath is user-facing. */
export interface PathVerdict {
  allowed: boolean
  normalized: string
  displayPath: string
  reason: PathReason
}

/** 确认凭证：绑定对象集合（归一后路径），集合变化即失效。The confirmation voucher: bound to the object set (normalized); any set change voids it. */
export interface Confirmation {
  readonly paths: readonly string[]
}

/** 危险动作裁决。The dangerous-action verdict. */
export type ActionVerdict =
  | { readonly decision: 'allow' }
  | { readonly decision: 'deny'; readonly reason: PathReason }
  | { readonly decision: 'confirm'; readonly code: 'BDPAN_CONFIRM_REQUIRED' }

/** 判断输入是否为独立的父目录段（'..'，含解码后形态）。Whether the input holds a standalone parent-directory segment ('..', including decoded forms). */
function hasStandaloneDotDot(path: string): boolean {
  return path.split('/').some(segment => segment === '..')
}

/** 反复解码至多两遍，防双重编码穿越；解码失败原样返回。Decodes at most twice against double-encoded traversal; malformed input returns verbatim. */
function decodeRepeatedly(input: string): string {
  let decoded = input
  for (let round = 0; round < 2; round += 1) {
    try {
      const next = decodeURIComponent(decoded)
      if (next === decoded) break
      decoded = next
    } catch {
      break
    }
  }
  return decoded
}

/** 折叠重复分隔符、去掉末尾斜杠、解析 '.' 段。Collapses repeated separators, strips trailing slashes, resolves '.' segments. */
function collapse(path: string): string {
  const segments: string[] = []
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue
    segments.push(segment)
  }
  return `/${segments.join('/')}`
}

/** 面向用户的显示路径：/apps 前缀映射为"我的应用数据"。The user-facing display path: the /apps prefix maps to "我的应用数据". */
function toDisplay(path: string): string {
  return path.replace(/^\/apps\//u, '我的应用数据/')
}

/** 拒绝的便捷构造。Convenience deny builder. */
function deny(reason: PathReason): PathVerdict {
  return { allowed: false, normalized: '', displayPath: '', reason }
}

/**
 * 路径裁决：先本地归一与越界判断，再放行；根外路径一律本地拒绝、不发请求。
 * relative 输入相对授权根解析；绝对路径必须位于授权根内；合法连续点号原样保留。
 * The path verdict: normalize locally and bound-check before anything goes
 * out; out-of-root paths are refused locally with no request fired. Relative
 * inputs resolve against the root; absolute ones must sit inside it;
 * legitimate consecutive dots pass through untouched.
 */
export function checkPath(input: string, root: string, options: { singleName?: boolean } = {}): PathVerdict {
  const trimmed = input.trim()
  if (trimmed.length === 0) return options.singleName === true ? deny('empty') : deny('empty')
  if (options.singleName === true && /[\\/]/u.test(trimmed)) return deny('invalid-name')
  if (trimmed.includes('~')) return deny('tilde')
  if (/[\\:]/u.test(trimmed) || /[\u0000-\u001f]/u.test(trimmed)) return deny('platform-trap')
  const decoded = decodeRepeatedly(trimmed)
  if (decoded !== trimmed && hasStandaloneDotDot(decoded)) return deny('encoded-traversal')
  if (hasStandaloneDotDot(decoded)) return deny('traversal')
  const joined = decoded.startsWith('/') ? decoded : `${root}/${decoded}`
  const normalized = collapse(joined)
  const rootNorm = collapse(root)
  if (normalized !== rootNorm && !normalized.startsWith(`${rootNorm}/`)) return deny('outside-root')
  return { allowed: true, normalized, displayPath: toDisplay(normalized), reason: 'ok' }
}

/**
 * 危险动作裁决：确认凭证的路径集合（归一后）必须恰好覆盖目标集合——
 * 多、少、错任何一项都返回"需要确认"，不沿用旧确认。
 * The dangerous-action verdict: the voucher's normalized path set must cover
 * exactly the target set — any extra, missing, or wrong entry returns
 * "needs confirmation"; old confirmations never carry over.
 */
export function checkAction(root: string, targetPaths: readonly string[], confirmation: Confirmation | undefined): ActionVerdict {
  const targets: string[] = []
  for (const path of targetPaths) {
    const verdict = checkPath(path, root)
    if (!verdict.allowed) return { decision: 'deny', reason: verdict.reason }
    targets.push(verdict.normalized)
  }
  if (targets.length === 0) return { decision: 'deny', reason: 'empty' }
  if (confirmation === undefined) return { decision: 'confirm', code: 'BDPAN_CONFIRM_REQUIRED' }
  const granted = new Set<string>()
  for (const path of confirmation.paths) {
    const verdict = checkPath(path, root)
    if (!verdict.allowed) return { decision: 'confirm', code: 'BDPAN_CONFIRM_REQUIRED' }
    granted.add(verdict.normalized)
  }
  const exact = targets.length === granted.size && targets.every(path => granted.has(path))
  return exact ? { decision: 'allow' } : { decision: 'confirm', code: 'BDPAN_CONFIRM_REQUIRED' }
}

/** 需要脱敏的键名（大小写不敏感）。Key names to redact (case-insensitive). */
const SENSITIVE_KEY = /token|secret|password|authorization|credential/iu

/** 掩码一段敏感值。Masks one sensitive value. */
function mask(value: string): string {
  return value.length <= 4 ? '***' : `${value.slice(0, 2)}***${value.slice(-2)}`
}

/**
 * 日志脱敏：深遍对象与数组，键名命中敏感词的字符串值一律掩码；
 * 原对象不被修改。诊断与调试输出都必须先过这里。
 * Log redaction: deep-walks objects and arrays and masks string values under
 * sensitive keys; the input is never mutated. All diagnostics and debug
 * output must pass through here first.
 */
export function redact<T>(value: T): T {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(item => redact(item)) as T
  if (typeof value === 'object' && value !== null) {
    const source = value as Record<string, unknown>
    const output: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(source)) {
      output[key] = typeof item === 'string' && SENSITIVE_KEY.test(key) ? mask(item) : redact(item)
    }
    return output as T
  }
  return value
}
