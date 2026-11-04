/**
 * 客户端核心：令牌生命周期（到期前刷新 + 失效重放一次）与 xpan 调用门面，
 * 外加账号资料与容量两个只读能力。所有出网请求都经这里，守门规则在
 * 调用方（工具面）执行，本层只管令牌与错误归一。
 * The client core: the token lifecycle (refresh before expiry + one replay
 * on invalid-token) and the xpan call facade, plus the profile and quota
 * read capabilities. Every outbound request passes through here; the guard
 * rules run at the call sites (the tool face), while this layer owns tokens
 * and error normalization only.
 *
 * @module @veren/baidu-pan
 */
import type { ResolvedConfig } from './config.js'
import { API_BASE } from './config.js'
import { baiduPanError } from './errors.js'
import { assertXpanOk, refreshTokens, wireRequest, type FetchLike, type WireRequest, type WireResponse } from './wire.js'
import type { OAuthTokens, QuotaSnapshot, AccountProfile } from './types.js'

/** 客户端依赖：令牌的读与写（由凭据面接线），fetch 可注入。The client's dependencies: token reads and writes (wired by the credential face), fetch injectable. */
export interface ClientDeps {
  readonly config: ResolvedConfig
  readonly readTokens: () => Promise<OAuthTokens | undefined>
  readonly commitTokens: (tokens: OAuthTokens) => Promise<void>
  readonly fetch?: FetchLike
}

/** 换新令牌后必须重放的判定：令牌过期/无效两个上游码。The replay trigger after a fresh pair: the two upstream token codes. */
function isTokenStale(error: unknown): boolean {
  return error instanceof Object && 'upstreamCode' in error
    && (error.upstreamCode === 20016 || error.upstreamCode === 20017)
}

/** uinfo 载荷的形状守卫：uid（uk）与会员类型必有，名字取其一。The uinfo payload shape guard: uid (uk) and vip type required, one name variant present. */
function parseProfile(json: Record<string, unknown>): AccountProfile {
  const uk = json['uk'] ?? json['baidu_uid']
  const vipType = json['vip_type']
  const displayName = json['netdisk_name'] ?? json['baidu_name']
  if ((typeof uk !== 'string' && typeof uk !== 'number') || typeof vipType !== 'number') {
    throw baiduPanError('BDPAN_UPSTREAM', { detail: 'uinfo payload missing uk/vip_type' })
  }
  const vip = (vipType === 1 || vipType === 2) ? vipType : 0
  return {
    uid: String(uk),
    displayName: typeof displayName === 'string' && displayName.length > 0 ? displayName : String(uk),
    vipType: vip as AccountProfile['vipType'],
  }
}

/** quota 载荷的形状守卫：total/used 必有且非负。The quota payload shape guard: total/used required and non-negative. */
function parseQuota(json: Record<string, unknown>): QuotaSnapshot {
  const total = json['total']
  const used = json['used']
  if (typeof total !== 'number' || typeof used !== 'number' || total < 0 || used < 0) {
    throw baiduPanError('BDPAN_UPSTREAM', { detail: 'quota payload missing total/used' })
  }
  const expire = json['expire']
  const expireAt = typeof expire === 'number' && expire > 0 ? expire * 1000 : undefined
  const within7Days = expireAt !== undefined && expireAt - Date.now() < 7 * 24 * 3600 * 1000
  return {
    totalBytes: total,
    usedBytes: used,
    freeBytes: Math.max(total - used, 0),
    expireWithin7Days: within7Days,
  }
}

/** 网盘客户端：call() 是唯一出网口，令牌到期自动刷新、失效重放一次。The netdisk client: call() is the sole outbound gate — auto refresh when expiring, one replay when invalid. */
export class BaiduPanClient {
  private readonly deps: ClientDeps

  constructor(deps: ClientDeps) {
    this.deps = deps
  }

  /** 当前 fetch（默认全局，测试可注入）。The current fetch (global by default; injectable in tests). */
  private get fetchLike(): FetchLike {
    return this.deps.fetch ?? globalThis.fetch
  }

  /** 读取令牌；无令牌响亮 BDPAN_AUTH_REQUIRED。Reads the tokens; absence is a loud BDPAN_AUTH_REQUIRED. */
  private async tokens(): Promise<OAuthTokens> {
    const tokens = await this.deps.readTokens()
    if (tokens === undefined) throw baiduPanError('BDPAN_AUTH_REQUIRED')
    return tokens
  }

  /** 用刷新令牌换新令牌并提交；失败折成需要重新授权的失败。Trades the refresh token for a fresh pair and commits; failure folds into a re-auth failure. */
  private async rotate(tokens: OAuthTokens): Promise<OAuthTokens> {
    const fresh = await refreshTokens(this.deps.config, tokens.refreshToken, this.fetchLike)
    await this.deps.commitTokens(fresh)
    return fresh
  }

  /**
   * 令牌化请求内核：access_token 走查询参数；令牌过期（20016/20017）刷新
   * 后重放一次，重放仍失败即抛出——不静默降级、不无限重试。
   * The tokenized request core: the access token rides the query; on token
   * expiry (20016/20017) refresh once and replay once — a failing replay
   * throws, with no silent downgrade and no unbounded retries.
   */
  private async request(url: string, params: Readonly<Record<string, string>>, request: Partial<WireRequest>): Promise<WireResponse> {
    const tokens = await this.tokens()
    const budget = { timeoutMs: this.deps.config.requestTimeoutMs, maxAttempts: this.deps.config.maxAttempts, fetch: this.fetchLike }
    try {
      const response = await wireRequest(url, { method: request.method ?? 'GET', query: { access_token: tokens.accessToken, ...params }, binary: request.binary }, budget)
      if (request.binary !== true) assertXpanOk(response.json, request.method ?? 'GET', url)
      return response
    } catch (error) {
      if (!isTokenStale(error)) throw error
      const fresh = await this.rotate(tokens)
      const response = await wireRequest(url, { method: request.method ?? 'GET', query: { access_token: fresh.accessToken, ...params }, binary: request.binary }, budget)
      if (request.binary !== true) assertXpanOk(response.json, request.method ?? 'GET', url)
      return response
    }
  }

  /** xpan 调用门面（API_BASE 下的端点）。The xpan call facade (endpoints under API_BASE). */
  async call(endpoint: string, params: Readonly<Record<string, string>>, request: Partial<WireRequest> = {}): Promise<WireResponse> {
    return this.request(`${API_BASE}/${endpoint}`, params, request)
  }

  /** 任意主机（如 d.pcs.baidu.com 分片上传）的令牌化调用。The tokenized call against an arbitrary host (e.g. the d.pcs.baidu.com slice upload). */
  async rawCall(url: string, params: Readonly<Record<string, string>>, request: Partial<WireRequest> = {}): Promise<WireResponse> {
    return this.request(url, params, request)
  }

  /** 账号资料。The account profile. */
  async profile(): Promise<AccountProfile> {
    const response = await this.call('xpan/nas', { method: 'uinfo' })
    return parseProfile(response.json)
  }

  /** 容量快照。The quota snapshot. */
  async quota(): Promise<QuotaSnapshot> {
    const response = await this.call('xpan/api', { method: 'quota' })
    return parseQuota(response.json)
  }
}
