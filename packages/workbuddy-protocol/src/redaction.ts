/**
 * 显示层脱敏：手机号/邮箱只作用于展示，存储保持原值。
 * Display-layer redaction: phone numbers and emails are masked for display
 * only; stored values stay intact.
 *
 * 邮箱中间固定**一个**星号不是随手写的：脱敏名是所有列表里的账号标签，
 * 忠实长度的星号串会把整列撑宽（`2*********@gmail.com` 二十个字符）。
 * 固定一颗星，标签宽度才有上界。日志只允许 uid 前 8 位，从不记录昵称。
 * The email mask deliberately collapses to a *single* star: masked names are
 * the account label in every list, and a faithful-length star run stretches the
 * whole column. One star bounds the label's width. Logs may carry the first 8
 * chars of a uid, never a nickname.
 *
 * 证据：docs/workbuddy-protocol.cn.md §8；卷宗 dsh-workbuddy-oauth/src/credentials.ts:260-389。
 * Evidence: docs/workbuddy-protocol.md §8; dossier credentials.ts:260-389.
 *
 * @module @veren/workbuddy-protocol/redaction
 */

/**
 * 中国大陆手机号（可带 86 国家码）。前后 `(?!d)` 守卫防止长数字串被部分
 * 匹配：`113800138000` 的中间段不是手机号，脱敏它会毁掉一个恰好包含这些
 * 数字的 id。
 * A mainland-China mobile number, optionally with an `86` country code. The
 * lookaround guards keep a longer digit run from being partially masked: in
 * `113800138000` the inner digits are not a phone number.
 */
const PHONE_PATTERN = /(?<!\d)(?:\+?86[-\s]?)?(1[3-9]\d{9})(?!\d)/gu

/**
 * 首尾各保留 2 位（11 位里藏 7 位）。不是 3 位：前三位是运营商号段不是个人
 * 数据，第四位已是用户段首；两侧各 3 位只藏 5 位，太宽。
 * Two leading and trailing digits stay readable (7 of 11 hidden). Not three:
 * the first three digits are the carrier prefix, not personal data.
 */
const PHONE_VISIBLE_DIGITS = 2

/** 掩去文本中的全部手机号（原地掩，含「张三 138…」这类混合名）。 */
/** Mask every mobile number inside a display name (in place, including mixed names). */
export function maskPhoneNumbers(text: string): string {
  return text.replace(PHONE_PATTERN, (whole: string, digits: string) => {
    const stars = '*'.repeat(Math.max(0, digits.length - PHONE_VISIBLE_DIGITS * 2))
    const masked = `${digits.slice(0, PHONE_VISIBLE_DIGITS)}${stars}${digits.slice(-PHONE_VISIBLE_DIGITS)}`
    return whole.replace(digits, masked)
  })
}

/**
 * 邮箱地址。本地部分非空、域名至少带一个点——裸 `user@host` 是内部 id 不是
 * 地址，放过它。前导守卫防止从 token 中段开始匹配。
 * An email address. The local part must be non-empty and the domain carry a
 * dot, so a bare `user@host` (an internal id) is left alone.
 */
const EMAIL_PATTERN = /(?<![A-Za-z0-9._%+-])([A-Za-z0-9._%+-]+)@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)/gu

/** 本地部分首尾各保留的字符数。Leading/trailing local-part characters kept when there is room. */
const EMAIL_VISIBLE_CHARS = 2

/**
 * 本地部分折叠成固定短形，中间恰好一颗星——宽度有界是硬要求。
 * 至少藏一个字符（`ab` → `a*`，绝不两头全露）。
 * Collapse the local part to a fixed short form with a single star between —
 * bounded width is a hard requirement. At least one character is always hidden.
 */
function maskLocalPart(local: string): string {
  if (local.length <= 1) return '*'
  if (local.length >= EMAIL_VISIBLE_CHARS * 2 + 1) {
    return `${local.slice(0, EMAIL_VISIBLE_CHARS)}*${local.slice(-EMAIL_VISIBLE_CHARS)}`
  }
  return local.length >= 3 ? `${local.slice(0, 1)}*${local.slice(-1)}` : `${local.slice(0, 1)}*`
}

/** 去掉域名末段（TLD）：`example.com.cn` → `example.com`。`gmail.com` 里 `.com` 什么也不说明。 */
/** Drop the domain's last label: `example.com.cn` → `example.com`. */
function shortenDomain(domain: string): string {
  return domain.replace(/\.[A-Za-z0-9-]+$/, '')
}

/** 掩去文本中的全部邮箱：`alice1990@example.com` → `al*90@example`。 */
/** Mask every email address inside a display name. */
export function maskEmailAddresses(text: string): string {
  return text.replace(EMAIL_PATTERN, (whole: string, local: string, domain: string) =>
    `${maskLocalPart(local)}@${shortenDomain(domain)}`)
}

/**
 * 唯一脱敏入口：新增标识类型时只改这里，任何渲染面都不会被遗漏。
 * One redaction entry point: a new identifier type is added here and every
 * rendering surface inherits it.
 */
export function maskPersonalData(text: string): string {
  return maskEmailAddresses(maskPhoneNumbers(text))
}

/** 账号的展示名：有昵称用脱敏昵称，否则 uid 前 8 位。 */
/** Human account label: masked nickname when present, else the uid's first 8 chars. */
export function displayNameOf(nickname: string | undefined, uid: string): string {
  if (nickname !== undefined && nickname !== '') return maskPersonalData(nickname)
  return uid.slice(0, 8)
}
