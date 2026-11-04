/**
 * 请求前刷新钩子：各平台客户端每次请求前调用（design/modules/proxy.md §3）。
 * The pre-request refresh hook, called by every platform client before each
 * request (design proxy.md §3).
 *
 * 开关关闭直通；到期自动更换；刷新失败保留当前代理继续请求——不出现
 * 无代理裸奔。
 * The off switch passes through; expiry auto-switches; a failed refresh
 * keeps the current proxy — never running without one (acceptance 3).
 *
 * @module @veren/crawler/proxy/refresh
 */
import type { ProxyIpPool } from './pool.ts'
import { EXPIRY_BUFFER_SECONDS } from './ip-info.ts'

/** 刷新钩子依赖 / the refresh-hook dependencies */
export interface ProxyRefreshDeps {
  /** 代理开关 / the proxy switch */
  enabled: boolean
  /** 单活跃代理池 / the single-active pool */
  pool: ProxyIpPool | null
  /** 切换成功后的重建回调（重建浏览器与请求客户端配置）/ the rebuild callback after a switch (browser + client proxy config) */
  rebuild: (proxy: unknown) => void
  /** 告警日志 / the warning logger */
  warn: (message: string) => void
}

/**
 * 请求前刷新：直通 → 到期检查 → 更换并重建 → 失败保留旧代理。
 * The pre-request refresh: passthrough → expiry check → switch and rebuild
 * → keep the old proxy on failure.
 */
export async function refreshProxyIfExpired(deps: ProxyRefreshDeps): Promise<void> {
  if (!deps.enabled) return
  if (deps.pool === null) return
  if (!deps.pool.isCurrentProxyExpired(EXPIRY_BUFFER_SECONDS)) return
  try {
    const next = await deps.pool.getOrRefreshProxy()
    deps.rebuild(next)
  } catch (error) {
    deps.warn(`[Proxy] 刷新失败，保留当前代理继续请求: ${String(error)}`)
  }
}
