/**
 * 同意门（docs/task-workbench-modes-dispatch §2）：写工具的合法触发 =
 * 本回合会话日志里有 `kind:'user'` 的人类消息（广域同意）或任务中心投递指令
 * （按任务 id 收窄），且模型已用 drive_begin 声明本回合范围。
 * The consent gate (§2 of the design doc): a write tool fires legally only when
 * the current turn's session log carries a human message (`kind:'user'`, broad
 * consent) or a task-center delivery instruction (consent narrowed to named
 * task ids), AND the model has declared this turn's scope via drive_begin.
 *
 * 信号面走"处理刚投递事件"的 sanctioned 路径（ownEvents 等同步历史读已被 DSH
 * 禁止新调用）：装配时 `ctx.on('session/event', …, { global: true })` 喂给
 * {@link ConsentBook}——真机实证 turn/start 先于本回合全部 user/message 提交，
 * 所以"turn/start 重置、user/message 合并"恰好等于"最后一条 assistant 之后的
 * 切片"，且不受多步回合干扰。台账按 WeakMap<Session> 存活：没观察过的会话
 * （含重启恢复）= 空状态 = 拒写（fail-closed）。
 * The signal face takes the sanctioned "process the delivered current event"
 * path (synchronous history reads are deprecated for new calls): assembly feeds
 * {@link ConsentBook} from `ctx.on('session/event', …, { global: true })` —
 * verified on a real log that turn/start commits before the turn's user
 * messages, so reset-on-turn/start plus merge-on-user/message equals the slice
 * after the last assistant, undisturbed by multi-step turns. The ledger lives
 * in a WeakMap keyed by the Session: an unobserved session (a restart resume
 * included) reads as empty = writes refused (fail-closed).
 * @module @veren/task-workbench
 */
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { DriveGrant, ToolOutcome, TurnConsent } from './types.ts'

/** 同意门稳定错误码 / stable consent-gate error codes */
export const ConsentCode = {
  /** 本回合没有人类消息也没有点名本任务的投递指令 / neither a human message nor a delivery naming this task this turn */
  Required: 'consent/required',
  /** 有同意但 browse 未声明；先 drive_begin / consent exists but browse never declared; call drive_begin first */
  DriveRequired: 'consent/drive-required',
  /** 目标任务 id 不在本回合声明范围内 / the target task id is outside the declared scope */
  ScopeExceeded: 'consent/scope-exceeded',
} as const

/** 空切片（拒绝面）/ the empty slice (the refusing face) */
export const NO_CONSENT: TurnConsent = { userTurn: false, deliveredTaskIds: [] }

/**
 * 取一条 user/message 事件里的纯文本与 source kind（形状同观测 CLI 的口径：
 * `data.message ?? data`）。
 * The plain text and source kind of one user/message event (the audit CLI's
 * shape: `data.message ?? data`).
 */
function messageFaceOf(event: SessionEvent): { readonly kind: string; readonly text: string } {
  const message = (event.data as { message?: MessageFace } | undefined)?.message
    ?? (event.data as MessageFace | undefined)
  const kind = typeof message?.source?.kind === 'string' ? message.source.kind : 'user'
  const blocks = Array.isArray(message?.content) ? message.content : []
  const text = blocks.map((block) => (block.type === 'text' && typeof block.text === 'string' ? block.text : '')).join('')
  return { kind, text }
}

/** 观测口径的最小消息形状 / the minimal message face the fold reads */
interface MessageFace {
  readonly source?: { readonly kind?: unknown }
  readonly content?: readonly { readonly type?: unknown; readonly text?: unknown }[]
}

/** 从投递通知文本提取点名任务 id（service-delivery 的 `任务：<id>` 行）/ parse the notice's named task id */
export function taskIdOfNotice(text: string): string | undefined {
  return /^任务：(\S+)/m.exec(text)?.[1]
}

/** 从 TASK 块头行提取任务 id（`TASK <id> <title>`）/ parse the TASK block's id */
export function taskIdOfTaskBlock(text: string): string | undefined {
  return /^TASK\s+(\S+)/.exec(text)?.[1]
}

/**
 * 纯折叠：上一状态 + 一条已提交事件 → 下一状态。turn/start 开新回合即重置；
 * user/message 按 kind 合并（人类 = 广域；投递通知/TASK 块 = 点名 id）；其余
 * 事件原样返回同一引用（多步回合的 assistant/message 不清切片）。
 * The pure fold: previous state + one committed event → next state. turn/start
 * opens a turn and resets; user/message merges by kind (human = broad; notice /
 * TASK block = named ids); every other event returns the same reference (a
 * multi-step turn's assistant messages never clear the slice).
 */
export function foldConsent(previous: TurnConsent | undefined, event: SessionEvent): TurnConsent {
  if (event.type === 'turn/start') return NO_CONSENT
  if (event.type !== 'user/message') return previous ?? NO_CONSENT
  const { kind, text } = messageFaceOf(event)
  const named = kind === 'task-center/notice' ? taskIdOfNotice(text)
    : kind === 'app/task' ? taskIdOfTaskBlock(text)
    : undefined
  if (kind !== 'user' && named === undefined) return previous ?? NO_CONSENT
  return {
    userTurn: (previous?.userTurn ?? false) || kind === 'user',
    deliveredTaskIds: named === undefined || (previous?.deliveredTaskIds ?? []).includes(named)
      ? previous?.deliveredTaskIds ?? []
      : [...previous?.deliveredTaskIds ?? [], named],
  }
}

/**
 * 同意台账：装配层的 session/event 观察器喂 observe；工具在执行时按 session
 * 对象读当前回合切片。WeakMap 随会话对象回收，无清理面。
 * The consent book: the assembly's session/event observer feeds observe; tools
 * read the current turn's slice by the session object at execute time. The
 * WeakMap is reclaimed with the session object — no dispose face.
 */
export class ConsentBook {
  private readonly states = new WeakMap<object, TurnConsent>()

  /** session/event 观察器（装配层以 { global: true } 注册）/ the session/event observer (registered { global: true }) */
  readonly observe = (session: object, event: SessionEvent): void => {
    this.states.set(session, foldConsent(this.states.get(session), event))
  }

  /** 当前回合切片；未观察过的会话 = 空切片 / the current turn's slice; an unobserved session = the empty slice */
  consentOf(session: object | undefined): TurnConsent {
    return session === undefined ? NO_CONSENT : this.states.get(session) ?? NO_CONSENT
  }
}

/**
 * drive 台账：逐轮声明的范围，按 agent 对象存取（WeakMap 随 agent 回收；重挂
 * 后的新 agent 无台账 = 回到 browse）。
 * The drive ledger: the per-turn declared scope, keyed by the agent object (a
 * WeakMap reclaimed with the agent; a remounted session's fresh agent has no
 * grant = back to browse).
 */
export class DriveLedger {
  private readonly grants = new WeakMap<object, DriveGrant>()

  begin(agent: object, grant: DriveGrant): void {
    this.grants.set(agent, grant)
  }

  end(agent: object): void {
    this.grants.delete(agent)
  }

  grantOf(agent: object | undefined): DriveGrant | undefined {
    return agent === undefined ? undefined : this.grants.get(agent)
  }
}

/** 同意门拒绝（稳定 code + 模型可据此恢复的下一步）/ a gate refusal (stable code + the recoverable next step) */
function refusal(code: string, detail: string): ToolOutcome {
  return { ok: false, code, detail }
}

/**
 * 写工具统一入口（§2 检查序）：切片同意 → drive 台账 → 范围覆盖。返回
 * undefined = 放行。
 * The uniform write entrance (§2's check order): slice consent → drive ledger
 * → scope cover. Returns undefined = allowed through.
 */
export function gateWrite(
  book: ConsentBook,
  ledger: DriveLedger,
  agent: { readonly session?: object } | undefined,
  taskId: string | undefined,
  action: string,
): ToolOutcome | undefined {
  const consent = book.consentOf(agent?.session)
  const namedByDelivery = taskId !== undefined && consent.deliveredTaskIds.includes(taskId)
  if (!consent.userTurn && !namedByDelivery) {
    return refusal(ConsentCode.Required,
      `${action} needs this turn's consent: a user message, or a task-center delivery naming task ${taskId ?? '(none)'} / ${action} 需要本回合同意：用户消息，或点名任务 ${taskId ?? '（无）'} 的投递指令`)
  }
  const grant = ledger.grantOf(agent)
  if (grant === undefined) {
    return refusal(ConsentCode.DriveRequired,
      `${action} is blocked in browse mode; declare this turn's scope with drive_begin first / ${action} 在 browse 模式被挡；先用 drive_begin 声明本回合范围`)
  }
  if (grant.scope === 'tasks' && taskId !== undefined && !grant.taskIds.has(taskId)) {
    return refusal(ConsentCode.ScopeExceeded,
      `task ${taskId} is outside the declared drive scope / 任务 ${taskId} 不在本回合声明的 drive 范围内`)
  }
  return undefined
}

/**
 * drive_begin 的判定与登记：切片同意校验 + 台账写入。'turn' 范围仅限人类
 * 同意；投递同意只能声明被点名任务。
 * drive_begin's verdict and registration: validates slice consent, then writes
 * the ledger. Scope 'turn' requires human consent; delivery consent may only
 * declare the named tasks.
 */
export function beginDrive(
  book: ConsentBook,
  ledger: DriveLedger,
  agent: { readonly session?: object } | undefined,
  args: { readonly scope?: unknown; readonly task_ids?: unknown; readonly reason?: unknown },
): ToolOutcome {
  const consent = book.consentOf(agent?.session)
  if (!consent.userTurn && consent.deliveredTaskIds.length === 0) {
    return refusal(ConsentCode.Required,
      'drive_begin needs this turn\'s consent (a user message or a delivery) / drive_begin 需要本回合同意（用户消息或投递指令）')
  }
  const reason = typeof args.reason === 'string' ? args.reason.trim() : ''
  if (reason.length === 0) {
    return refusal(ConsentCode.Required,
      'drive_begin requires a one-sentence reason / drive_begin 需要一句话理由')
  }
  const requested = Array.isArray(args.task_ids)
    ? args.task_ids.filter((id): id is string => typeof id === 'string')
    : []
  const deliverable = consent.deliveredTaskIds
  if (!consent.userTurn) {
    const outside = requested.filter((id) => !deliverable.includes(id))
    if (outside.length > 0 || args.scope === 'turn') {
      return refusal(ConsentCode.Required,
        `delivery consent covers only ${deliverable.join(', ') || 'no task'} / 投递同意只覆盖 ${deliverable.join('、') || '（无任务）'}`)
    }
  }
  const scope: DriveGrant['scope'] = consent.userTurn && args.scope !== 'tasks' ? 'turn' : 'tasks'
  const taskIds = scope === 'turn' ? new Set(requested) : new Set(requested.length > 0 ? requested : deliverable)
  if (agent !== undefined) {
    ledger.begin(agent, { scope, taskIds, reason, at: new Date().toISOString() })
  }
  const declared = scope === 'turn' ? 'the whole turn' : [...taskIds].join(', ') || '(no task)'
  return { ok: true, detail: `drive granted for ${declared}: ${reason}` }
}
