/**
 * 代理 IP 信息：到期判断与两种形态转换（design/modules/proxy.md §2）。
 * Proxy IP info: expiry judgement and the two format conversions
 * (design proxy.md §2).
 *
 * 格式转换统一收口：浏览器自动化用「ip:port」，内部请求客户端用完整 URL。
 * Format conversion is centralized: browser automation uses "ip:port",
 * internal request clients use the full URL.
 *
 * @module @veren/proxy/ip-info
 */

/** 单个代理 IP 信息 / one proxy IP record */
export interface IpInfo {
  ip: string
  port: number
  /** 默认 https / defaults to https */
  protocol: string
  user: string | null
  password: string | null
  /** 过期时刻 Unix 秒；null 视为永不过期（静态代理）/ expiry instant in unix seconds; null means never (static proxies) */
  expiredTimeTs: number | null
}

/** 到期缓冲默认 30 秒 / the default expiry buffer of 30 seconds */
export const EXPIRY_BUFFER_SECONDS = 30

/** 是否已到期（含缓冲窗口；null 到期时刻视为未到期）/ expired within the buffer window; a null instant never expires */
export function isExpired(ip: IpInfo, bufferSeconds: number = EXPIRY_BUFFER_SECONDS, nowTs: number = Math.floor(Date.now() / 1000)): boolean {
  if (ip.expiredTimeTs === null) return false
  return nowTs >= ip.expiredTimeTs - bufferSeconds
}

/** 浏览器自动化形态：「ip:port」/ the browser-automation form: "ip:port" */
export function toHostPort(ip: IpInfo): string {
  return `${ip.ip}:${ip.port}`
}

/** 内部请求客户端形态：完整 URL（含凭证）/ the request-client form: full URL with credentials */
export function toProxyUrl(ip: IpInfo): string {
  if (ip.user === null || ip.password === null) return `${ip.protocol}://${ip.ip}:${ip.port}`
  return `${ip.protocol}://${encodeURIComponent(ip.user)}:${encodeURIComponent(ip.password)}@${ip.ip}:${ip.port}`
}
