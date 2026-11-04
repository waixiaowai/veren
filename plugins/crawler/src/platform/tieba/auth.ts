/**
 * 贴吧登录面：公共 JSON 通道免登录，探测恒命中（design/modules/crawler.md
 * §5：tieba 无加密签名，大量数据免 Cookie 可取）。
 * The tieba login face: the public json channel is login-free, so the probe
 * always hits (crawler.md §5: no encrypted signature; much data is
 * reachable without cookies).
 *
 * 「探测恒命中」不是假装登录：它表达的是**本平台公共通道不要求登录**这一
 * 事实，管线因此跳过登录流程直接采集；登录方式一栏全部为显式占位。
 * "Always-hit" is not pretend-login: it states the fact that this
 * platform's public channel requires no login, so the pipeline skips the
 * login flow; every login method is an explicit no-op placeholder.
 *
 * @module @veren/crawler/platform/tieba/auth
 */
import type { AbstractLogin, LoginProbe } from '../../auth/contract.ts'
import type { BrowserSession } from '../../browser/contract.ts'
import type { Platform } from '../../types.ts'
import type { CrawlerRunRequest } from '../../control/runner.ts'

/**
 * 公共通道登录探测：恒命中（免登录通道）。
 * The public-channel login probe: always hits (login-free channel).
 */
export async function probeTiebaLoggedIn(_session: BrowserSession): Promise<LoginProbe> {
  return { loggedIn: true, probeMethod: 'api' }
}

/**
 * 造贴吧登录器：公共通道免登录，登录方式一律显式占位。
 * Builds the tieba login: the public channel is login-free; every login
 * method is an explicit no-op.
 */
export function createTiebaLogin(_session: BrowserSession, _request: CrawlerRunRequest): AbstractLogin {
  return {
    platform: 'tieba' as Platform,
    begin: async () => undefined,
    loginByQrcode: async () => false,
    loginByMobile: async () => false,
    loginByCookies: async () => undefined,
  }
}
