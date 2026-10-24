/**
 * Trusted-URL policy of the WeChat iLink client: base-URL normalization, QR
 * URL normalization, and the host allowlist.
 *
 * No arbitrary redirect host is followed: only HTTPS on a WeChat host passes.
 * A rejected URL is an `IM_INTERNAL` failure, never a silent rewrite.
 *
 * 微信 iLink 客户端的可信 URL 策略：base URL 归一化、二维码 URL 归一化与主机白名单。
 *
 * 绝不跟随任意跳转主机：只有 WeChat 主机上的 HTTPS 放行。被拒的 URL 报 `IM_INTERNAL`，
 * 不会被悄悄改写。
 *
 * @module @veren/im-wechat/api-url
 */

import { ImError } from '@veren/im'

/** Normalize one configured base URL, rejecting untrusted hosts. */
export function normalizeBaseUrl(value: string, fallback: string): string {
  const url = new URL(value, fallback)
  assertTrustedUrl(url)
  url.search = ''
  url.hash = ''
  if (!url.pathname.endsWith('/')) url.pathname += '/'
  return url.toString()
}

/** Normalize one QR URL, rejecting untrusted hosts. */
export function normalizeQrUrl(value: string): string {
  const url = new URL(value)
  assertTrustedUrl(url)
  return url.toString()
}

/** Reject a URL that is not HTTPS on a WeChat host. */
export function assertTrustedUrl(url: URL): void {
  if (url.protocol !== 'https:' || !isTrustedHost(url.hostname)) {
    throw new ImError('IM_INTERNAL', 'wechat refused an untrusted URL')
  }
  url.username = ''
  url.password = ''
}

/** WeChat host allowlist; no arbitrary redirect host is followed. */
function isTrustedHost(host: string): boolean {
  return host === 'ilinkai.weixin.qq.com' || host.endsWith('.weixin.qq.com')
}
