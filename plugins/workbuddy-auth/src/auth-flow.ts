/**
 * 授权流：两区域设备码登录，经 `ctx.authorization.registerFlow` 注册。
 * The authorization flow: both regions' device-code sign-in, registered via
 * `ctx.authorization.registerFlow`.
 *
 * 契约要点（缝的语义）：flow 拥有写——`run()` resolve 前必须 `session.commit`，
 * 否则结算为 NOT_COMMITTED。本流程**经在线校验后才落凭据**：token 拿到后先
 * 用它拉一次目录（既验证令牌又预热目录），失败即整个 attempt 失败、什么都不
 * 写。轮询在 flow 内自转（3s 节奏下限由协议库执行，600s 上限在这里）。
 * Contract points (the seam's semantics): the flow owns the write — `run()` must
 * `session.commit` before resolving, else the attempt settles NOT_COMMITTED.
 * Credentials land **only after online validation**: once the token arrives the
 * flow pulls the catalog with it (validating the token and warming the catalog
 * in one move); failure fails the whole attempt and writes nothing. Polling
 * spins inside the flow (the protocol enforces the 3s floor; this file enforces
 * the 600s ceiling).
 *
 * @module @veren/workbuddy-auth/auth-flow
 */
import type { Context } from '@deepseek-ai/cordis'
import { LlmError } from '@deepseek-ai/dsh-llm'
import {
  LoginClient, LoginPendingError, MIN_POLL_INTERVAL_MS, fetchCatalog, regionOfDomain,
  resolveAppVersion, type LoginResult, type WorkBuddyRegion,
} from '@veren/workbuddy-protocol'
import type { ResolvedConfig } from './config.ts'
import { METHOD_CN, METHOD_GLOBAL, WORKBUDDY_RECORD, type WorkbuddyAccounts } from './state-store.ts'
import type { WorkbuddyCatalog } from './catalog.ts'

/** 授权流依赖。The flow's deps. */
export interface WorkbuddyFlowDeps {
  readonly config: ResolvedConfig
  readonly accounts: WorkbuddyAccounts
  readonly catalog: WorkbuddyCatalog
  /** 测试缝：登录与目录都指向同一 mock origin；生产恒空（恒用区域表）。Test seam: login and catalog both point at one mock origin; production always the region table. */
  readonly baseUrl?: string
}

/** 方法 id → 区域。Method id → region. */
export function regionOfMethod(method: string): WorkBuddyRegion {
  return method === METHOD_GLOBAL ? 'global' : 'cn'
}

/** 注册两区域授权流（dispose 随 fiber 卸载）。Registers the flows (disposal rides the fiber). */
export function registerWorkbuddyFlow(ctx: Context, deps: WorkbuddyFlowDeps): void {
  ctx.authorization.registerFlow({
    key: WORKBUDDY_RECORD,
    label: 'WorkBuddy / WorkBuddy AI',
    methods: [
      { id: METHOD_CN, label: '国内版 · WorkBuddy（copilot.tencent.com）/ WorkBuddy CN' },
      { id: METHOD_GLOBAL, label: '国际版 · WorkBuddy AI（workbuddy.ai）/ WorkBuddy AI International' },
    ],
    async run(session) {
      const region = regionOfMethod(session.method)
      const login = new LoginClient({
        fetchImpl: fetch,
        ...(deps.baseUrl === undefined ? {} : { loginBaseOverride: deps.baseUrl }),
      })
      const request = await login.begin(region)
      session.notify({
        message: region === 'global'
          ? '在浏览器打开以下链接并完成 WorkBuddy AI 授权，本窗口会自动等待 / Open the link, finish the WorkBuddy AI authorization; this window waits for you.'
          : '在浏览器打开以下链接并完成 WorkBuddy 授权，本窗口会自动等待 / Open the link, finish the WorkBuddy authorization; this window waits for you.',
        url: request.url,
        code: request.state,
      })
      const result = await pollUntilComplete(login, request.state, region, session.signal)
      await validateOnline(deps, result)
      // 在线校验通过才落位：commit 的载荷是"现文档 + 新账号"。
      // Commit lands only after online validation: the payload is the current document plus the new account.
      const document = deps.accounts.mergeLogin(await deps.accounts.read(), result, Date.now())
      await session.commit({ kind: 'grant', payload: document })
    },
  })
}

/**
 * 轮询到完成：pending 静默续转；session 被撤销则直接返回（缝把撤销结算为
 * cancelled，不会误报失败）；600s 上限显式报 LOGIN_EXPIRED。
 * Polls to completion: pending spins quietly; a withdrawn session returns
 * straight away (the seam settles the withdrawal as cancelled, never a false
 * failure); the 600s ceiling reports LOGIN_EXPIRED explicitly.
 */
async function pollUntilComplete(login: LoginClient, state: string, region: WorkBuddyRegion, signal: AbortSignal): Promise<LoginResult> {
  const deadline = Date.now() + 600_000
  while (!signal.aborted) {
    await new Promise<void>(resolve => {
      const timer = setTimeout(resolve, MIN_POLL_INTERVAL_MS)
      signal.addEventListener('abort', () => { clearTimeout(timer); resolve() }, { once: true })
    })
    if (Date.now() > deadline) {
      throw new LlmError('workbuddy: 授权等待超时（10 分钟），请重新发起。/ authorization timed out after 10 minutes', 'LOGIN_EXPIRED')
    }
    try {
      return await login.complete(state)
    } catch (error) {
      if (error instanceof LoginPendingError) continue
      throw error
    }
  }
  // 会话被撤销：直接以取消收场（缝把撤销结算为 cancelled，不误报失败）。
  // The session was withdrawn: settle as cancelled (the seam reports cancelled, never a false failure).
  throw new LlmError('workbuddy: authorization cancelled', 'SIGN_IN_CANCELLED')
}

/**
 * 在线校验：**直接用新令牌**打一次目录端点（此刻凭据还没落库，不能借道目录
 * 管理器的账号选取）。失败=整个 attempt 失败（凭据不落位）。
 * Online validation: hit the catalog endpoint **with the fresh token directly**
 * (the credential is not stored yet, so the catalog manager's account picking
 * cannot be borrowed). Failure fails the whole attempt (nothing commits).
 */
async function validateOnline(deps: WorkbuddyFlowDeps, result: LoginResult): Promise<void> {
  const region = regionOfDomain(result.token.domain)
  try {
    await fetchCatalog({
      accessToken: result.token.accessToken,
      refreshToken: result.token.refreshToken,
      expiresAtMs: Date.now() + result.token.expiresIn * 1000,
      domain: result.token.domain,
      uid: result.account.uid,
      ...(result.account.enterpriseId !== '' ? { enterpriseId: result.account.enterpriseId } : {}),
      region,
    }, resolveAppVersion(region, deps.config.identity), {
      ...(deps.baseUrl === undefined ? {} : { baseUrl: deps.baseUrl }),
    })
  } catch (error) {
    throw new LlmError(
      `workbuddy: 授权已拿到但目录校验未通过，凭据未保存。原因：${error instanceof Error ? error.message : String(error)}`,
      'SIGN_IN_VALIDATION_FAILED',
    )
  }
}
