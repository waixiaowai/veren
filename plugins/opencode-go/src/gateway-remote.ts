/**
 * OpenCode Go 网关：插件的 Web 面（`opencodeGo` 远端命名空间）。刻意只做
 * 薄传输，且 `begin`/`beginAuto` **立即返回**——登录尝试跑在宿主纤程里，
 * 轮询是唯一的状态通道；密钥只在 `answer` 的请求体里单向进入宿主，轮询
 * 永不回传。长挂的 begin 请求会被传输层掐死（真机踩过的 "Failed to fetch"）。
 *
 * The OpenCode Go gateway: the plugin's web surface (the `opencodeGo` Remote
 * namespace). Deliberately thin, and `begin`/`beginAuto` **return
 * immediately** — attempts run in a host fiber and polling is the only state
 * channel; the key enters the host only inside the `answer` request body and
 * never travels back through a poll. A long-held begin request gets killed by
 * the transport (the "Failed to fetch" we hit live).
 *
 * @module @veren/opencode-go/gateway-remote
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { AuthorizationNotice, AuthorizationPrompt } from '@deepseek-ai/dsh-authorization'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { OPENCODE_GO_PROVIDER } from './catalog.js'
import { OPENCODE_GO_RECORD, readStoredKey } from './credential.js'
import { watchAuthFile, type AuthFileWatch } from './watch-auth-file.js'

/** 一次待答提问与其等待者。One pending prompt and its waiter. */
interface PendingPrompt {
  readonly prompt: AuthorizationPrompt
  resolve: (value: string) => void
  reject: (error: Error) => void
}

/** 一次尝试的终局（从发起者视角）。One attempt's settlement (as its starter sees it). */
interface WebSettlement {
  readonly status: 'authorized' | 'cancelled'
}

/** 尝试失败的结构化事实（failures 走 poll，不作为终局）。A failed attempt's structured facts (failures ride poll, not the settlement). */
interface WebFailure {
  readonly code: string | undefined
  readonly message: string
}

/** 自动模式的监听超时：到点未检测到 CLI 登录即自停并提示。The auto watch timeout: stops itself with a hint when no CLI login appears. */
const AUTO_WATCH_TIMEOUT_MS = 90_000

/** OpenCode Go 登录网关。The OpenCode Go sign-in gateway. */
export class OpencodeGoGatewayService extends TypertRemoteService {
  static inject = ['authorization', 'credentials']

  private readonly host: Context
  private notices: AuthorizationNotice[] = []
  private pending: PendingPrompt | undefined
  private settled: WebSettlement | undefined
  private failure: WebFailure | undefined
  private running = false
  private autoWaiting = false
  private autoTimedOut = false
  private autoImported = false
  private autoWatch: AuthFileWatch | undefined

  constructor(ctx: Context) {
    super(ctx, 'opencodeGoGateway', { namespace: 'opencodeGo' })
    this.host = ctx
  }

  /** 登录面的一次自述：流与两方法、登录态、是否进行中。One describe: the flow with both methods, sign-in state, and in-flight. */
  @Remote('describe')
  async describe() {
    const entry = this.host.authorization.describe(OPENCODE_GO_RECORD)
    return {
      provider: OPENCODE_GO_PROVIDER,
      label: entry?.label ?? 'OpenCode Go',
      methods: entry?.methods ?? [],
      signedIn: (await readStoredKey(this.host)) !== undefined,
      inFlight: entry?.inFlight ?? false,
    }
  }

  /**
   * 手动方法的一次登录尝试：**立即返回**，尝试跑在宿主纤程里；失败经
   * poll 的 `failed` 送达，成功落在 `settled`。并发的缝拒绝同样异步送达。
   * One manual-method attempt: **returns immediately**, the attempt runs in a
   * host fiber; failures arrive via poll's `failed`, success lands in
   * `settled`. A concurrent seam refusal is delivered the same async way.
   */
  @Remote('begin')
  async begin(request: { readonly method?: string }) {
    return this.startAttempt(request?.method)
  }

  /**
   * 自动获取：打开监听（客户端负责开浏览器到 /auth）。本机 CLI 登录产物
   * 一旦变化即自动走导入流程（校验→提交），成功结算 authorized 并标记
   * autoImported；90 秒未检测到则 autoTimedOut 并自停。
   * Auto mode: starts the watch (the client opens the browser to /auth). Once
   * the local CLI artifact changes, the import flow (validate → commit) runs
   * by itself; success settles authorized with autoImported; 90s without a
   * CLI login sets autoTimedOut and stops.
   */
  @Remote('beginAuto')
  async beginAuto() {
    if (this.running) return { started: false, reason: 'ALREADY_IN_FLIGHT' as const }
    this.notices = []
    this.pending = undefined
    this.settled = undefined
    this.failure = undefined
    this.autoTimedOut = false
    this.autoImported = false
    this.autoWaiting = true
    const authPath = join(homedir(), '.local', 'share', 'opencode', 'auth.json')
    this.autoWatch = watchAuthFile({
      path: authPath,
      timeoutMs: AUTO_WATCH_TIMEOUT_MS,
      onChange: () => { void this.startAttempt('import-local-cli') },
    })
    void this.expireAutoWatch()
    // CLI 已登录的情形零等待：立即先试一次导入；失败则留给监听继续等。
    // An already-signed-in CLI imports with zero wait: try once right away;
    // a failure just leaves the watch waiting for the next change.
    void this.startAttempt('import-local-cli')
    return { started: true, timeoutMs: AUTO_WATCH_TIMEOUT_MS }
  }

  /**
   * 手动/自动尝试的宿主纤程：跑缝流程，结算与失败各自归位。结束（含失败）
   * 时合上未答的提问；自动模式下失败不惊扰（监听继续等下一次变化）。
   * The host fiber behind manual/auto attempts: runs the seam flow, files the
   * settlement and failure. An unfinished prompt closes when the attempt
   * ends; in auto mode a failed import stays quiet (the watch keeps waiting).
   */
  private async startAttempt(method: string | undefined): Promise<void> {
    if (this.running) {
      this.failure = { code: 'ALREADY_IN_FLIGHT', message: 'an authorization attempt for "opencode-go/account" is already running' }
      return
    }
    this.resetAttemptState()
    try {
      const outcome = await this.host.authorization.begin({
        key: OPENCODE_GO_RECORD,
        ...(method === undefined ? {} : { method }),
        interaction: {
          notify: (notice) => { this.notices.push(notice) },
          prompt: (prompt) => new Promise<string>((resolve, reject) => {
            this.pending = { prompt, resolve, reject }
          }),
        },
      })
      this.settleStatus(outcome.status)
    } catch (error) {
      // 自动等待期内的导入失败保持安静（监听继续等），只有手动尝试才上抛到 poll。
      // Failures while auto-watching stay quiet (the watch keeps waiting); only
      // manual attempts surface to poll.
      if (!this.autoWaiting) this.recordFailure(error)
    } finally {
      this.closeAttempt()
    }
  }

  /** 清空上一轮尝试的痕迹并标记进行中。Clears the previous attempt's traces and marks in-flight. */
  private resetAttemptState(): void {
    this.notices = []
    this.pending = undefined
    this.settled = undefined
    this.failure = undefined
    this.running = true
  }

  /** 结算一次尝试：记录终局；自动模式下成功即收掉监听。Settles one attempt: files the outcome; auto mode stops the watch on success. */
  private settleStatus(status: WebSettlement['status']): void {
    this.settled = { status }
    if (status === 'authorized' && this.autoWaiting) {
      this.autoWaiting = false
      this.autoImported = true
      this.autoWatch?.stop()
      this.autoWatch = undefined
    }
  }

  /** 记录一次失败的结构化事实。Records one failure's structured facts. */
  private recordFailure(error: unknown): void {
    this.failure = {
      code: (error as { code?: string }).code,
      message: (error as { message?: string }).message ?? String(error),
    }
  }

  /** 收尾一次尝试：清除进行中标记并合上未答提问。Finishes one attempt: clears the in-flight mark and closes the open prompt. */
  private closeAttempt(): void {
    this.running = false
    const open = this.pending
    this.pending = undefined
    open?.reject(new Error('opencode-go: the attempt ended'))
  }

  /** 自动监听到点：未成功即标记超时并自停。The auto watch deadline: marks the timeout and stops without success. */
  private async expireAutoWatch(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, AUTO_WATCH_TIMEOUT_MS))
    if (this.autoWaiting && !this.running) {
      this.autoWaiting = false
      this.autoTimedOut = true
      this.autoWatch?.stop()
      this.autoWatch = undefined
    }
  }

  /** 轮询一次：通知 + 待答提问 + 终局/失败 + 自动模式状态。One poll: notices + the open prompt + settlement/failure + auto-mode state. */
  @Remote('poll')
  async poll() {
    const pending = this.pending
    const textLike = pending?.prompt
    return {
      notices: [...this.notices],
      ...(pending === undefined || textLike === undefined || textLike.kind === 'select' ? {} : {
        prompt: {
          kind: textLike.kind,
          message: textLike.message,
          ...textLike.placeholder === undefined ? {} : { placeholder: textLike.placeholder },
        },
      }),
      ...this.settled === undefined ? {} : { settled: this.settled },
      ...this.failure === undefined ? {} : { failed: this.failure },
      autoWaiting: this.autoWaiting,
      autoTimedOut: this.autoTimedOut,
      autoImported: this.autoImported,
      inFlight: this.running || (this.host.authorization.describe(OPENCODE_GO_RECORD)?.inFlight ?? false),
    }
  }

  /** 提交待答提问的答案（密钥只在这里单向进入宿主）。Answers the open prompt (the key enters the host only here, one way). */
  @Remote('answer')
  async answer(request: { readonly value: string }) {
    const pending = this.pending
    if (pending === undefined) {
      throw new Error('opencode-go: no prompt is open to answer')
    }
    this.pending = undefined
    pending.resolve(request.value)
    return { answered: true }
  }

  /** 撤销进行中的尝试；缝把撤销结算为 cancelled。Withdraws the running attempt; the seam settles the withdrawal as cancelled. */
  @Remote('cancel')
  async cancel() {
    this.host.authorization.cancel(OPENCODE_GO_RECORD)
    this.autoWaiting = false
    this.autoWatch?.stop()
    this.autoWatch = undefined
    return { cancelled: true }
  }

  /** 退出登录：删除凭据记录并清空交互缓冲——上一轮的终局不得顶掉未登录态的方法按钮。Signs out: deletes the credential record AND clears the interaction buffer — a previous attempt's settlement must not crowd out the signed-out method buttons. */
  @Remote('signOut')
  async signOut() {
    await this.host.credentials.deleteRecord(OPENCODE_GO_RECORD)
    this.notices = []
    this.pending = undefined
    this.settled = undefined
    this.failure = undefined
    this.autoWaiting = false
    this.autoTimedOut = false
    this.autoImported = false
    this.autoWatch?.stop()
    this.autoWatch = undefined
    this.running = false
    return { signedOut: true }
  }
}
