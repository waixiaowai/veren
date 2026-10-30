/**
 * 插件的 Web 面（`workbuddyAuth` 远端命名空间）。刻意薄传输，`begin` **立即
 * 返回**——登录尝试跑在宿主纤程里，轮询是唯一状态通道（长挂 begin 会被传输
 * 层掐死，真机踩过的形态）。
 * The plugin's web surface (the `workbuddyAuth` Remote namespace). Deliberately
 * thin, and `begin` **returns immediately** — attempts run in a host fiber and
 * polling is the only state channel (a long-held begin gets killed by the
 * transport, a live-measured shape).
 *
 * @module @veren/workbuddy-auth/gateway-remote
 */
import type { Context } from '@deepseek-ai/cordis'
import type { AuthorizationNotice } from '@deepseek-ai/dsh-authorization'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import {
  displayNameOf, fetchCredits, probeModel, regionOfDomain,
  type ProbeOutcome, type WorkBuddyRegion, type WorkbuddyStateDocument,
} from '@veren/workbuddy-protocol'
import { probeEffort } from '@veren/workbuddy-protocol'
import { METHOD_CN, METHOD_GLOBAL, WORKBUDDY_RECORD, type WorkbuddyAccounts } from './state-store.ts'

/** 卡片账号行的形状（uid 只出前 8 位，昵称出脱敏形）。One card account row (uid truncated to 8, nickname masked). */
export interface CardAccount {
  readonly uid: string
  readonly name: string
  readonly region: WorkBuddyRegion
  readonly disabled: boolean
  readonly expired: boolean
  readonly cooldownRemainMs: number
  readonly enterprise: boolean
}

/** 一次待答提问与其等待者。One pending prompt and its waiter. */
interface PendingPrompt {
  readonly message: string
  resolve: (value: string) => void
  reject: (error: Error) => void
}

/** WorkBuddy 登录网关。The WorkBuddy sign-in gateway. */
export class WorkbuddyGatewayService extends TypertRemoteService {
  static inject = ['authorization', 'credentials']

  private readonly host: Context
  private readonly accounts: WorkbuddyAccounts
  private notices: AuthorizationNotice[] = []
  private pending: PendingPrompt | undefined
  private settled: { readonly status: 'authorized' | 'cancelled' } | undefined
  private failure: { readonly code: string | undefined; readonly message: string } | undefined
  private running = false

  constructor(ctx: Context, accounts: WorkbuddyAccounts) {
    super(ctx, 'workbuddyAuthGateway', { namespace: 'workbuddyAuth' })
    this.host = ctx
    this.accounts = accounts
  }

  /** 一次自述：流、方法、登录态、账号表（脱敏）。One describe: flow, methods, sign-in state, the masked account table. */
  @Remote('describe')
  async describe() {
    const entry = this.host.authorization.describe(WORKBUDDY_RECORD)
    const document = await this.accounts.read()
    return {
      provider: 'workbuddy' as const,
      label: entry?.label ?? 'WorkBuddy',
      methods: entry?.methods ?? [
        { id: METHOD_CN, label: '国内版 · WorkBuddy' },
        { id: METHOD_GLOBAL, label: '国际版 · WorkBuddy AI' },
      ],
      signedIn: document.accounts.length > 0,
      inFlight: entry?.inFlight ?? false,
      accounts: this.cardAccounts(document),
    }
  }

  /** 手动方法的一次登录尝试：**立即返回**，失败经 poll 的 failed 送达。 */
  /** One manual-method attempt: **returns immediately**; failures arrive via poll's failed. */
  @Remote('begin')
  async begin(request: { readonly method?: string }) {
    if (this.running) return { started: false, reason: 'ALREADY_IN_FLIGHT' as const }
    this.notices = []
    this.settled = undefined
    this.failure = undefined
    this.running = true
    void this.host.authorization.begin({
      key: WORKBUDDY_RECORD,
      ...(request?.method === undefined ? {} : { method: request.method }),
      interaction: {
        notify: (notice) => { this.notices.push(notice) },
        prompt: (prompt) => new Promise<string>((resolve, reject) => {
          this.pending = { message: prompt.message, resolve, reject }
        }),
      },
    }).then((outcome) => {
      this.settled = { status: outcome.status }
    }).catch((error: unknown) => {
      this.failure = {
        code: (error as { code?: string }).code,
        message: (error as { message?: string }).message ?? String(error),
      }
    }).finally(() => {
      this.running = false
      const open = this.pending
      this.pending = undefined
      open?.reject(new Error('workbuddy-auth: the attempt ended'))
    })
    return { started: true }
  }

  /** 轮询一次：通知 + 待答提问 + 终局/失败 + 进行中。One poll: notices, the open prompt, settlement/failure, in-flight. */
  @Remote('poll')
  async poll() {
    const pending = this.pending
    return {
      notices: [...this.notices],
      ...(pending === undefined ? {} : { prompt: { kind: 'text' as const, message: pending.message } }),
      ...this.settled === undefined ? {} : { settled: this.settled },
      ...this.failure === undefined ? {} : { failed: this.failure },
      inFlight: this.running,
    }
  }

  /** 撤销进行中的尝试；缝把撤销结算为 cancelled。Withdraws the running attempt; the seam settles it cancelled. */
  @Remote('cancel')
  async cancel() {
    this.host.authorization.cancel(WORKBUDDY_RECORD)
    return { cancelled: true }
  }

  /** 登出一个账号：四类痕迹一次删净（凭据/冷却/停用/探测）。Signs one account out: all four classes erased at once. */
  @Remote('signOut')
  async signOut(request: { readonly uid: string }) {
    await this.accounts.remove(request.uid)
    return { signedOut: true }
  }

  /** 启停一个账号（可逆）。Toggles one account (reversible). */
  @Remote('toggle')
  async toggle(request: { readonly uid: string; readonly disabled: boolean }) {
    await this.accounts.setDisabled(request.uid, request.disabled)
    return { disabled: request.disabled }
  }

  /** 一个账号的余额。One account's credits. */
  @Remote('credits')
  async credits(request: { readonly uid: string }) {
    const entry = await this.requireEntry(request.uid)
    const credits = await fetchCredits({
      accessToken: entry.accessToken,
      refreshToken: entry.refreshToken,
      expiresAtMs: entry.expiresAtMs,
      domain: entry.domain,
      uid: entry.uid,
      ...(entry.enterpriseId === undefined ? {} : { enterpriseId: entry.enterpriseId }),
      region: regionOfDomain(entry.domain),
    })
    return credits
  }

  /**
   * 推理档位探测：**消耗真实积分**，客户端卡片必须先双确认再调用。
   * The reasoning-effort probe: **consumes real credits**; the card must
   * double-confirm before calling.
   */
  @Remote('probe')
  async probe(request: { readonly uid: string; readonly model: string }) {
    const entry = await this.requireEntry(request.uid)
    const region = regionOfDomain(entry.domain)
    const credential = {
      accessToken: entry.accessToken,
      refreshToken: entry.refreshToken,
      expiresAtMs: entry.expiresAtMs,
      domain: entry.domain,
      uid: entry.uid,
      ...(entry.enterpriseId === undefined ? {} : { enterpriseId: entry.enterpriseId }),
      region,
    }
    const outcome: ProbeOutcome = await probeModel({
      region,
      send: (effort, signal) => probeEffort(credential, request.model, effort, signal),
    })
    await this.accounts.noteProbe(entry.uid, region, request.model, outcome)
    return outcome
  }

  /** 读取一个账号条目（缺失 = 结构化拒绝）。Reads one entry (missing = a structured refusal). */
  private async requireEntry(uid: string) {
    const document = await this.accounts.read()
    const entry = document.accounts.find(candidate => candidate.uid === uid)
    if (entry === undefined) throw new Error(`workbuddy-auth: no such account ${uid.slice(0, 8)}`)
    return entry
  }

  /** 卡片账号表（uid 截断、昵称脱敏、冷却剩余）。The card's account table. */
  private cardAccounts(document: WorkbuddyStateDocument): readonly CardAccount[] {
    const now = Date.now()
    return document.accounts.map(entry => ({
      uid: entry.uid.slice(0, 8),
      name: displayNameOf(entry.nickname, entry.uid),
      region: regionOfDomain(entry.domain),
      disabled: document.disabled.includes(entry.uid),
      expired: entry.expiresAtMs <= now,
      cooldownRemainMs: Math.max(0, (document.cooldowns[entry.uid] ?? 0) - now),
      enterprise: entry.enterpriseId !== undefined && entry.enterpriseId !== '',
    }))
  }
}
