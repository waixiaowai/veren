/**
 * 登录三段式流程：探测 → 登录 → 回写持久化（design/modules/auth.md §4）。
 * The three-segment login flow: probe → login → persist (design auth.md §4).
 *
 * 铁律「先凭证后请求」：探测失败的请求一律不发出；Cookie 注入后必须
 * 复验，无效凭证立即报错——不带着无效会话进入采集。
 * Invariant "credentials before requests": no business request is issued
 * without a passing probe; cookie injection is re-verified and invalid
 * credentials fail loudly.
 *
 * @module @veren/crawler/auth/flow
 */
import { CrawlerError } from '../errors.ts'
import { transitionLogin } from './state.ts'
import type { LoginFlowDeps, LoginFlowResult, LoginProbe } from './contract.ts'
import type { LoginSessionState } from '../types.ts'

/** cookie 方式未提供凭证串 / cookie login without a credential string */
function credentialMissing(): CrawlerError {
  return new CrawlerError('CREDENTIAL_MISSING', '请先提供登录 Cookie', {})
}

/** 注入后探测不通过 / the post-injection probe failed */
function credentialInvalid(): CrawlerError {
  return new CrawlerError('CREDENTIAL_INVALID', '登录 Cookie 已失效，请重新获取', {})
}

/** 扫码/验证码轮询窗口耗尽 / the scan/code polling window expired */
function loginTimeout(): CrawlerError {
  return new CrawlerError('LOGIN_TIMEOUT', '登录超时，请重试并尽快完成扫码', {})
}

/** cookie 方式：注入 → 复验 → 持久化 / cookie method: inject, re-verify, persist */
async function runCookieLogin(state: LoginSessionState, deps: LoginFlowDeps): Promise<LoginSessionState> {
  if (deps.cookies === null || deps.cookies.length === 0) throw credentialMissing()
  await deps.login.loginByCookies()
  const probe = await deps.probe()
  if (!probe.loggedIn) throw credentialInvalid()
  return transitionLogin(state, 'logged_in')
}

/** 扫码/手机号方式：进入登录态并等待完成 / qrcode/phone methods: enter the login flow and await completion */
async function runInteractiveLogin(state: LoginSessionState, deps: LoginFlowDeps): Promise<LoginSessionState> {
  const waiting = transitionLogin(transitionLogin(state, 'logging_in'), 'waiting_scan')
  const ok = deps.loginType === 'phone' ? await deps.login.loginByMobile() : await deps.login.loginByQrcode()
  if (!ok) throw loginTimeout()
  return transitionLogin(waiting, 'logged_in')
}

/**
 * 登录主流程：探测命中直接返回（免登录）；未命中走登录并持久化档案。
 * The main login flow: a cache-hit probe returns directly (no login
 * interaction); otherwise run the login and persist the profile.
 */
export async function runLoginFlow(deps: LoginFlowDeps): Promise<LoginFlowResult> {
  let state: LoginSessionState = 'unknown'
  const probe: LoginProbe = await deps.probe()
  if (probe.loggedIn) {
    return { state: transitionLogin(state, 'logged_in'), probeHit: probe }
  }
  state = deps.loginType === 'cookie' ? await runCookieLogin(state, deps) : await runInteractiveLogin(state, deps)
  await deps.persist({
    platform: deps.login.platform,
    cookieSnapshot: [],
    persistedDir: userDataDirOf(deps.login.platform, deps.profileRoot),
  })
  return { state, probeHit: null }
}

/**
 * 登录档案目录：按平台隔离（数据根外独立目录）。
 * The login profile directory: isolated per platform, outside the data root.
 *
 * 根目录可注入：宿主进程的工作目录不可假定可写，装配面按配置传入
 * `config.browserDataRoot`。
 * The root is injectable: the host process working directory is not assumed
 * writable, so the assembly passes `config.browserDataRoot`.
 */
export function userDataDirOf(platform: string, baseRoot = './browser-data'): string {
  return `${baseRoot.replace(/[\\/]+$/u, '')}/${platform}_user_data_dir`
}
