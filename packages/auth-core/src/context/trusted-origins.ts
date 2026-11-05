/**
 * 受信来源表：合并、匹配与回调地址判定（设计文档 modules/07-guard.md §7.3）。
 * 匹配支持精确来源、通配主机（*、**、?）、自定义协议（myapp://）与路径钉扎；
 * 相对路径仅在回调地址场景允许（allowRelativePaths）。
 * 跳转目标与来源共用同一张受信表——分裂的信任根即开放重定向。
 *
 * The trusted-origin list: merging, matching and callback validation
 * (design modules/07-guard.md §7.3). Matching supports exact origins,
 * wildcard hosts (*, **, ?), custom protocols (myapp://) and path pinning;
 * relative paths are allowed only in the callback scenario
 * (allowRelativePaths). Redirect targets share the same trust root as
 * origins — a split root is an open redirect.
 *
 * @module @veren/auth-core/context/trusted-origins
 */

/** loopback 主机集合。 / The loopback host set. */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

/**
 * 展开 loopback origin 的孪生写法（127.0.0.1 ↔ localhost）：用户经任一主机
 * 名到达同一监听器，受信表必须同时承认。非 loopback 原样返回。
 * / Expand loopback sibling spellings (127.0.0.1 ↔ localhost): users reach
 * the same listener through either host, so the trust list must admit both.
 * Non-loopback origins pass through.
 */
export function loopbackOriginAliases(origin: string): string[] {
  let url: URL
  try {
    url = new URL(origin)
  } catch {
    return [origin]
  }
  const list = [origin.replace(/\/$/, '')]
  if (!LOOPBACK_HOSTS.has(url.hostname)) return list
  for (const host of ['127.0.0.1', 'localhost']) {
    const alias = new URL(origin)
    alias.hostname = host
    const text = alias.toString().replace(/\/$/, '')
    if (!list.includes(text)) list.push(text)
  }
  return list
}

/** 合并受信来源：baseURL 推导 + 配置静态表（保持去重与 loopback 展开）。 / Merge trusted origins: baseURL-derived plus the static list, deduplicated with loopback expansion. */
export function mergeTrustedOrigins(baseURL: string, configured: readonly string[]): string[] {
  const merged: string[] = []
  for (const candidate of [...loopbackOriginAliases(baseURL), ...configured]) {
    const text = candidate.trim()
    if (text !== '' && !merged.includes(text)) merged.push(text)
  }
  return merged
}

/** 通配模式 → 正则：** 任意段、* 段内任意、? 单字符。 / Wildcard pattern → regex: ** any run, * within a segment, ? one char. */
function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\u0000')
    .replace(/\*/g, '[^.]')
    .replace(/\u0000/g, '.*')
    .replace(/\?/g, '[^.]')
  return new RegExp(`^${escaped}$`, 'i')
}

/** 单条受信项是否命中给定 URL。 / Whether one trusted entry matches the URL. */
function entryMatches(entry: string, target: URL): boolean {
  if (entry.includes('*') || entry.includes('?')) {
    const match = /^(https?:|[^/]+:\/\/)([^/]+)(\/.*)?$/.exec(entry)
    if (match === null) return wildcardToRegExp(entry).test(target.origin)
    return wildcardToRegExp(match[1] ?? '' + (match[2] ?? '')).test(`${target.protocol}//${target.host}`)
  }
  let candidate: URL
  try {
    candidate = new URL(entry)
  } catch {
    // 自定义协议（如 myapp://pocket）：按字符串前缀比较。
    // Custom protocols (e.g. myapp://pocket): compare by string prefix.
    return target.origin === entry || `${target.protocol}//${target.host}` === entry
  }
  if (candidate.protocol !== target.protocol || candidate.host !== target.host) return false
  const entryPath = candidate.pathname.replace(/\/$/, '')
  return entryPath === '' || entryPath === '/' || target.pathname.startsWith(entryPath)
}

/**
 * 受信判定：URL（绝对或相对）是否命中受信表。
 * / Trusted check: whether a URL (absolute or relative) hits the trust list.
 */
export function isTrustedOrigin(url: string, trusted: readonly string[], settings?: { allowRelativePaths?: boolean }): boolean {
  const text = url.trim()
  if (text.startsWith('/')) return settings?.allowRelativePaths === true && !text.startsWith('//')
  let target: URL
  try {
    target = new URL(text)
  } catch {
    return false
  }
  return trusted.some((entry) => entryMatches(entry, target))
}
