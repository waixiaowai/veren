/**
 * OAuth 设备码登录，本插件自有——不读桌面 App 的凭据文件，不做解密。
 * OAuth device-code sign-in owned by this plugin — no desktop-app credential
 * file is read, nothing is decrypted.
 *
 * 流程刻意非交互：state → 把 URL 交给用户 → 轮询 token。三个安全规则是
 * **账号安全**性质而非礼貌：轮询下限（密循环轮询长得像撞库）、state TTL
 * （过期一个上游早已遗忘的 state）、state 区域锁定（state 只能在签发它的
 * host 上兑）。
 * Deliberately non-interactive: state → hand the URL to the user → poll. The
 * three safety rules are **account-safety** properties, not politeness: the
 * poll floor (tight-loop polling reads as credential stuffing), the state TTL
 * (expire a state the upstream has long forgotten), region-locked redemption.
 *
 * 证据：docs/workbuddy-protocol.cn.md §1；卷宗 oauth.ts。
 * Evidence: docs/workbuddy-protocol.md §1; dossier oauth.ts.
 *
 * @module @veren/workbuddy-protocol/oauth
 */

import { randomUUID } from 'node:crypto'
import { regionProfile, type WorkBuddyRegion } from './region.ts'
import { LoginExpiredError, LoginPendingError } from './errors.ts'

/** 登录端点期望的 UA，禁止替换成插件自己的身份。 */
/** The UA the login endpoints expect. Never substitute the plugin's own. */
export const LOGIN_USER_AGENT = 'CLI/2.63.2 CodeBuddy/2.63.2'

/**
 * 登录请求的 `platform` 值：**不是 `CLI`**。桌面 App 的授权 URL 报
 * `platform=workbuddy`；对 `CLI` 作用域的 state，登录页手机流程会拒 OneID
 * token（实测「无效的token」）。这是对参考实现（两家用 `CLI`）的有据偏离。
 * The sign-in `platform` value: **not `CLI`**. The desktop app's URL reports
 * `platform=workbuddy`; on a `CLI`-scoped state the page's phone flow rejects
 * the OneID token (measured 「无效的token」). A deliberate, measured divergence
 * from the reference implementations (both send `CLI`).
 */
export const AUTH_PLATFORM = 'workbuddy'

/** 同一 state 两次轮询的最小间隔（发请求前执行）。Minimum gap between two polls of one state (enforced before the request). */
export const MIN_POLL_INTERVAL_MS = 3_000

/** state 签发后的可用窗口。How long an issued state stays usable. */
export const LOGIN_TTL_MS = 600_000

/** 上游 `{code,msg,data}` 信封；`code !== 0` 是业务失败。The upstream envelope; `code !== 0` is a business failure. */
interface Envelope<T> {
  code?: number
  msg?: string
  data?: T
}

/** 第一步的产物：用户必须打开的 URL。Step 1's product: the URL the user must open. */
export interface AuthorizationRequest {
  readonly region: WorkBuddyRegion
  readonly state: string
  readonly url: string
}

/** token 端点返回的令牌束。The token bundle as the token endpoint returns it. */
export interface TokenBundle {
  readonly accessToken: string
  readonly refreshToken: string
  /** 生命周期，**秒**，相对签发时刻。Lifetime in **seconds**, relative to issuance. */
  readonly expiresIn: number
  readonly domain: string
}

/** 与令牌一起返回的账号身份。The account identity reported alongside the token. */
export interface AccountInfo {
  readonly uid: string
  readonly enterpriseId: string
  readonly nickname: string
}

/** 一次完成登录的全部产物。Everything a completed sign-in produces. */
export interface LoginResult {
  readonly region: WorkBuddyRegion
  readonly token: TokenBundle
  readonly account: AccountInfo
}

/** 最小 fetch 形状，测试可注入。Minimal fetch shape so tests can inject a stub. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

/** 可注入选项。Injectable options. */
export interface LoginClientOptions {
  readonly fetchImpl?: FetchLike
  readonly timeoutMs?: number
  /** 时钟可注入，TTL 与节奏规则才可离线测。Injectable clock so TTL and cadence rules test offline. */
  readonly now?: () => number
  /** 轮询下限覆盖；仅测试调低，生产不碰。Poll-floor override; tests lower it, production never does. */
  readonly minPollIntervalMs?: number
  readonly loginTtlMs?: number
  /** 登录 base 覆盖；仅测试指向 mock 上游，生产恒用区域表。Login-base override; tests point at a mock upstream, production always uses the region table. */
  readonly loginBaseOverride?: string
}

/** 一次进行中的登录。A live sign-in attempt. */
interface PendingLogin {
  readonly region: WorkBuddyRegion
  readonly createdAt: number
  lastPolledAt?: number
}

/**
 * 在授权 URL 上补桌面页需要的 `loginSessionId`（端点忽略请求侧的它，是页面
 * OneID 手机流程的关联键）。**刻意不发 `version`**：有无 version 页面 HTML
 * 字节一致，发自己的=声称一个无法保持新鲜的客户端版本。坏 URL 原样返回：
 * 打得开的登录页严格好过硬失败。
 * Append the `loginSessionId` the desktop page needs (the endpoint ignores it on
 * request; it keys the page's OneID phone flow to this client). **`version` is
 * deliberately not sent**: the page HTML is byte-identical with or without it.
 * A malformed URL returns unchanged — an openable login page beats a hard throw.
 */
export function officialAuthUrl(authUrl: string): string {
  let parsed: URL
  try {
    parsed = new URL(authUrl)
  } catch {
    return authUrl
  }
  if (!parsed.searchParams.has('loginSessionId')) parsed.searchParams.set('loginSessionId', randomUUID())
  return parsed.href
}

/** 每个登录调用都带的头。Headers every login call sends. */
export function loginHeaders(origin: string, token?: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/plain, */*',
    'X-Requested-With': 'XMLHttpRequest',
    Origin: origin,
    Referer: `${origin}/`,
    'User-Agent': LOGIN_USER_AGENT,
    ...(token !== undefined && token !== '' ? { Authorization: `Bearer ${token}` } : {}),
  }
}

/**
 * 设备码流程驱动器。三步拆开而不包成一个 `login()`：浏览器步骤横在 begin 与
 * poll 之间，授权流必须能先交出 URL、再在用户操作后轮询。
 * Drives the device-code flow. Three calls, not one `login()`: the browser step
 * sits between begin and poll, so a flow can hand out the URL first and poll
 * after the user acts.
 */
export class LoginClient {
  private readonly fetchImpl: FetchLike
  private readonly timeoutMs: number
  private readonly now: () => number
  private readonly minPollIntervalMs: number
  private readonly loginTtlMs: number
  private readonly loginBaseOverride: string | undefined
  /** 进行中尝试，按 state 记账——TTL、节奏、区域锁定三条规则全靠它可执行。 */
  /** Live attempts keyed by state — the ledger that makes TTL, cadence and region-locking enforceable. */
  private readonly pending = new Map<string, PendingLogin>()

  constructor(options: LoginClientOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch
    this.timeoutMs = options.timeoutMs ?? 30_000
    this.now = options.now ?? (() => Date.now())
    this.minPollIntervalMs = options.minPollIntervalMs ?? MIN_POLL_INTERVAL_MS
    this.loginTtlMs = options.loginTtlMs ?? LOGIN_TTL_MS
    this.loginBaseOverride = options.loginBaseOverride
  }

  /** 登录 base：测试覆盖优先，生产恒用区域表。The login base: test override first, production always the region table. */
  private loginBase(region: WorkBuddyRegion): string {
    return this.loginBaseOverride ?? regionProfile(region).loginBase
  }

  /** 一次 JSON 调用并解信封；pending 形态（11217/login ing/4xx）映射为 LoginPending。One JSON call, envelope unwrapped; pending shapes map to LoginPending. */
  private async call<T>(url: string, region: WorkBuddyRegion, init: { method: string; body?: string; token?: string }): Promise<T> {
    const { origin } = regionProfile(region)
    let response: Response
    try {
      response = await this.fetchImpl(url, {
        method: init.method,
        headers: loginHeaders(origin, init.token),
        ...(init.body !== undefined ? { body: init.body } : {}),
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch (error) {
      throw new Error(`请求 ${url} 失败：${error instanceof Error ? error.message : String(error)}`)
    }
    const text = await response.text().catch(() => '')
    let envelope: Envelope<T>
    try {
      envelope = JSON.parse(text) as Envelope<T>
    } catch {
      throw new Error(`上游返回的不是 JSON（HTTP ${response.status}）：${text.slice(0, 200)}`)
    }
    if (envelope.code !== undefined && envelope.code !== 0) {
      const detail = `code=${envelope.code} msg=${envelope.msg ?? ''}`
      const msg = envelope.msg ?? ''
      // 「login ing」是业务级未完成（实测：HTTP 200 + code 11217、无 data；
      // 旧形状曾以 4xx 呈现），两形态都必须落到「等待」而不是「失败」。
      // "login ing" is a business-level pending state (measured: HTTP 200 +
      // code 11217, no data; an older shape used 4xx). Both map to "waiting".
      if (envelope.code === 11217 || msg.includes('login ing') || (response.status >= 400 && response.status < 500)) {
        throw new LoginPendingError(`登录尚未完成（${detail}）`)
      }
      throw new Error(detail)
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}：${text.slice(0, 200)}`)
    if (envelope.data === undefined) throw new Error(`上游响应缺少 data 字段：${text.slice(0, 200)}`)
    return envelope.data
  }

  /** 第一步：要 state 与授权 URL。Step 1 — ask for a `state` and the authorization URL. */
  async begin(region: WorkBuddyRegion): Promise<AuthorizationRequest> {
    // loginBase 而非 base：state 在哪个 host 签发，登录页与后续调用就在哪个 host。
    // `loginBase`, not `base`: the host a state is issued on hosts the page and every follow-up call.
    const data = await this.call<{ state?: unknown; authUrl?: unknown }>(
      `${this.loginBase(region)}/v2/plugin/auth/state?platform=${AUTH_PLATFORM}`, region, { method: 'POST', body: '{}' })
    if (typeof data.state !== 'string' || data.state === '') throw new Error('上游未返回 state，登录无法继续。')
    if (typeof data.authUrl !== 'string' || data.authUrl === '') throw new Error('上游未返回 authUrl，登录无法继续。')
    this.pending.set(data.state, { region, createdAt: this.now() })
    return { region, state: data.state, url: officialAuthUrl(data.authUrl) }
  }

  /** 解析 state 对应的活尝试并执行 TTL；未知/过期 → LoginExpired。Resolve a live attempt under the TTL; unknown/expired → LoginExpired. */
  private requirePending(state: string): PendingLogin {
    const entry = this.pending.get(state)
    if (entry === undefined) throw new LoginExpiredError('未知的登录状态：可能已过期，请重新发起登录。')
    if (this.now() - entry.createdAt > this.loginTtlMs) {
      this.pending.delete(state)
      throw new LoginExpiredError('登录窗口已超时，请重新发起登录。')
    }
    return entry
  }

  /** 第二步：轮询 token。区域取自记录的尝试（state 区域锁定）。Step 2 — poll; the region comes from the recorded attempt (region-locked). */
  async poll(state: string): Promise<TokenBundle> {
    const entry = this.requirePending(state)
    const sinceLast = entry.lastPolledAt === undefined ? undefined : this.now() - entry.lastPolledAt
    if (sinceLast !== undefined && sinceLast < this.minPollIntervalMs) {
      // 节奏下限在发请求前执行：急躁重试根本到不了上游。
      // The floor fires before the request: an impatient retry never reaches the upstream.
      const waitMs = this.minPollIntervalMs - sinceLast
      throw new LoginPendingError(`轮询过于频繁，请等待约 ${Math.ceil(waitMs / 1000)} 秒后再试（避免触发上游风控）。`)
    }
    entry.lastPolledAt = this.now()
    const data = await this.call<{
      accessToken?: unknown; refreshToken?: unknown; expiresIn?: unknown; domain?: unknown
    }>(`${this.loginBase(entry.region)}/v2/plugin/auth/token?state=${encodeURIComponent(state)}`, entry.region, { method: 'GET' })
    if (typeof data.accessToken !== 'string' || data.accessToken === '') {
      throw new LoginPendingError('登录尚未完成：token 端点还没有返回 accessToken。')
    }
    return {
      accessToken: data.accessToken,
      refreshToken: typeof data.refreshToken === 'string' ? data.refreshToken : '',
      expiresIn: typeof data.expiresIn === 'number' && Number.isFinite(data.expiresIn) ? data.expiresIn : 0,
      domain: typeof data.domain === 'string' ? data.domain : '',
    }
  }

  /** 第三步：读这束授权绑定的账号身份。Step 3 — read the account identity bound to this authorization. */
  async account(state: string, accessToken: string): Promise<AccountInfo> {
    const entry = this.requirePending(state)
    const data = await this.call<{ uid?: unknown; enterpriseId?: unknown; nickname?: unknown }>(
      `${this.loginBase(entry.region)}/v2/plugin/login/account?state=${encodeURIComponent(state)}`, entry.region,
      { method: 'GET', token: accessToken })
    return {
      uid: typeof data.uid === 'string' ? data.uid : '',
      enterpriseId: typeof data.enterpriseId === 'string' ? data.enterpriseId : '',
      nickname: typeof data.nickname === 'string' ? data.nickname : '',
    }
  }

  /** 轮询 + 读账号一步完成，成功后退役 state（一次授权不得二次铸币）。 */
  /** Poll + account in one step; the state retires on success (one authorization, one credential). */
  async complete(state: string): Promise<LoginResult> {
    const entry = this.requirePending(state)
    const token = await this.poll(state)
    const account = await this.account(state, token.accessToken)
    if (account.uid === '') throw new Error('上游未返回 uid，无法确定账号身份。')
    this.pending.delete(state)
    return { region: entry.region, token, account }
  }
}
