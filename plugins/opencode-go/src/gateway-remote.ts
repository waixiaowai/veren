/**
 * OpenCode Go 网关：插件的 Web 面（`opencodeGo` 远端命名空间）。刻意只做
 * 薄传输：把授权缝的一次登录尝试翻译成"描述 → 发起 → 轮询 → 作答/取消"
 * 四个远端方法。通知与提问在宿主缓冲，浏览器按轮询取用——密钥永不经由
 * 轮询回传，只在 `answer` 的请求体里单向进入宿主。
 *
 * The OpenCode Go gateway: the plugin's web surface (the `opencodeGo` Remote
 * namespace). Deliberately thin transport: one authorization-seam attempt
 * translated into four Remote methods (describe → begin → poll → answer /
 * cancel). Notices and the prompt buffer host-side and reach the browser by
 * polling — the key never travels back through a poll; it enters the host
 * only inside the `answer` request body.
 *
 * @module @veren/opencode-go/gateway-remote
 */
import type { Context } from '@deepseek-ai/cordis'
import type { AuthorizationNotice, AuthorizationPrompt } from '@deepseek-ai/dsh-authorization'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { OPENCODE_GO_PROVIDER } from './catalog.js'
import { OPENCODE_GO_RECORD, readStoredKey } from './credential.js'

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

/**
 * 交互缓冲：notify 直接入列；prompt 挂起等待 `answer`。轮询把这些送达
 * 浏览器；`cancel` 撤销整次尝试（缝把撤销报告为 cancelled）。
 * The interaction buffer: notify appends; prompt parks until `answer`.
 * Polling carries both to the browser; `cancel` withdraws the attempt (the
 * seam reports the withdrawal as cancelled).
 */
function webInteraction(state: {
  notices: AuthorizationNotice[]
  setPending: (pending: PendingPrompt | undefined) => void
}): { notify: (notice: AuthorizationNotice) => void; prompt: (prompt: AuthorizationPrompt) => Promise<string> } {
  return {
    notify: (notice) => { state.notices.push(notice) },
    prompt: (prompt) => new Promise<string>((resolve, reject) => {
      state.setPending({ prompt, resolve, reject })
    }),
  }
}

/** OpenCode Go 登录网关。The OpenCode Go sign-in gateway. */
export class OpencodeGoGatewayService extends TypertRemoteService {
  static inject = ['authorization']

  private readonly host: Context
  private notices: AuthorizationNotice[] = []
  private pending: PendingPrompt | undefined
  private settled: WebSettlement | undefined
  private running = false

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
   * 发起一次登录尝试；同名尝试并发会被缝以 ALREADY_IN_FLIGHT 拒绝（原样
   * 透传给浏览器）。尝试结束（含失败）后终局停在 `poll` 里供读取。
   * Starts one sign-in attempt; a concurrent attempt is refused by the seam
   * with ALREADY_IN_FLIGHT (passed through verbatim). After the attempt ends
   * (failures included) the settlement rests in `poll` for reading.
   */
  @Remote('begin')
  async begin(request: { readonly method?: string }) {
    this.notices = []
    this.pending = undefined
    this.settled = undefined
    this.running = true
    try {
      const outcome = await this.host.authorization.begin({
        key: OPENCODE_GO_RECORD,
        ...(request?.method === undefined ? {} : { method: request.method }),
        interaction: webInteraction({
          notices: this.notices,
          setPending: (pending) => { this.pending = pending },
        }),
      })
      this.settled = { status: outcome.status }
      return { status: outcome.status }
    } finally {
      this.running = false
      // 闭包在 await 期间可能改写 pending；显式宽化断言破开 CFA 的 undefined 窄化。
      // The closure may reassign pending across awaits; widen past CFA's undefined narrowing.
      const open = this.pending as PendingPrompt | undefined
      this.pending = undefined
      open?.reject(new Error('opencode-go: the attempt ended'))
    }
  }

  /** 轮询一次：累计通知 + 待答提问 + 终局 + 是否进行中。One poll: accumulated notices + the open prompt + the settlement + in-flight. */
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
      inFlight: this.running,
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
    return { cancelled: true }
  }
}
