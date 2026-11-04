/**
 * B 站登录面：搜索与 nav 通道免登录，探测恒命中（design/modules/crawler.md
 * §5：bili 纯算法签名，免登录可搜索；登录后二次探测为画质兜底，属后续迭代）。
 * The bilibili login face: search and nav are login-free, so the probe
 * always hits (crawler.md §5: pure-algorithm signing; the post-login
 * second probe for full-quality is a later iteration).
 *
 * @module @veren/crawler/platform/bili/auth
 */
import type { AbstractLogin, LoginProbe } from '../../auth/contract.ts'
import type { BrowserSession } from '../../browser/contract.ts'
import type { Platform } from '../../types.ts'
import type { CrawlerRunRequest } from '../../control/runner.ts'

/**
 * 免登录通道探测：恒命中（搜索与 nav 均免 Cookie）。
 * The login-free channel probe: always hits (search and nav need no cookies).
 */
export async function probeBiliLoggedIn(_session: BrowserSession): Promise<LoginProbe> {
  return { loggedIn: true, probeMethod: 'api' }
}

/**
 * 造 B 站登录器：免登录通道，登录方式一律显式占位。
 * Builds the bilibili login: login-free channel; every method is an
 * explicit no-op.
 */
export function createBiliLogin(_session: BrowserSession, _request: CrawlerRunRequest): AbstractLogin {
  return {
    platform: 'bili' as Platform,
    begin: async () => undefined,
    loginByQrcode: async () => false,
    loginByMobile: async () => false,
    loginByCookies: async () => undefined,
  }
}
