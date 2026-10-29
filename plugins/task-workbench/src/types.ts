/**
 * 领域类型（只放类型）/ Domain types (types only)
 *
 * 任务工作台 v2（推进/派发/导航三概念，docs/task-workbench-modes-dispatch.*）：
 * 队列权威在任务中心，本地条目只是页面首屏投影（§1.1）；状态词与任务中心
 * TaskStatus 同一口径，lane 是策略纯函数的派生（§3.2），不落 store。
 * Workbench v2 (the drive/dispatch/navigation concepts): the queue's authority
 * is the task center and local items are only the page first-screen projection
 * (§1.1); status words share the center's TaskStatus vocabulary, lanes are
 * derived by the strategy pure function (§3.2) and never stored.
 * @module @veren/task-workbench
 */
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { TaskStatus } from '@veren/task-center'

export type { TaskStatus }

/**
 * 列表页展示的工作单条目（任务中心记录的投影）：链接字段只有三个——当前执行
 * 载体、改派去向、派发次数（§1.1）。
 * A queue work order (a projection of task-center records): exactly three link
 * fields — the active execution vehicle, the re-file destination, the attempts.
 */
export interface TaskItem {
  readonly id: string
  readonly title: string
  readonly status: TaskStatus
  readonly ownerId?: string
  /** 直接父任务 id（子任务投影行）；缺省 = 根工作单 / parent id (subtask projection row); absent = root order */
  readonly parentId?: string
  /** 当前执行载体的任务中心记录 id / the active vehicle record's task-center id */
  readonly activeRecordId?: string
  /** 改派目标应用（出站工作单）/ the app this order was re-filed to (outbound) */
  readonly dispatchedTo?: string
  /** 根级派发/发布次数 / how many root-level publish/requeue attempts */
  readonly attempts?: number
}

/**
 * 整棵子树的进度口径（§4.7.8 第 1 条的 `2/5`）：全树终态数 / 全树节点数。
 * Whole-subtree progress (§4.7.8 item 1's `2/5`): terminal nodes / all nodes.
 */
export interface SubtreeProgress {
  readonly rootId: string
  readonly total: number
  readonly done: number
  readonly label: string
  readonly active: boolean
}

/** 详情页子任务树节点投影 / detail-page subtask-tree node projection */
export interface SubtaskNode {
  readonly item: TaskItem
  /** 相对根的深度（根的直接子节点为 1）/ depth below the root (direct children = 1) */
  readonly depth: number
  readonly expanded: boolean
  readonly progress: SubtreeProgress
}

/** 工具执行结果：ok=false 时带稳定 code 与人读说明 / tool outcome with a stable code on failure */
export interface ToolOutcome {
  readonly ok: boolean
  readonly code?: string
  readonly detail?: string
}

/**
 * 工具执行上下文（本包只读 agent；session 是 DSH 真实 Session，同意门按对象
 * 读台账）。/ The tool execution context (this package reads the agent only;
 * session is the real DSH Session — the consent ledger keys on the object).
 */
export interface ToolCallContext {
  readonly agent?: Agent
}

/**
 * 详情页会话解析出的那条任务：taskId 供本地投影，url 是任务中心 target 的
 * 主键（§4.2「任务目标存规范 URL」）。
 * / The task a detail-page session resolves to: taskId feeds the local
 * projection; url is the task center's target primary key (§4.2).
 */
export interface PageTaskRef {
  readonly taskId: string
  readonly url: string
}

/**
 * 详情页→任务 的作用域解析面（§3.10.1）：本会话在详情页上的那条 live 行。
 * / The detail-page→task scope resolver (§3.10.1): this session's live detail row.
 */
export interface PageTaskScope {
  readonly liveDetailTaskOf: (sessionId: string) => Promise<PageTaskRef | undefined>
}

// ---- 策略视图（§3.2 lane 表）/ strategy view (the §3.2 lane table) ----

/** 工作单 lane（§3.2）/ work-order lane (§3.2) */
export type QueueLane = 'takeable' | 'dispatched' | 'held' | 'completed' | 'returned' | 'stale'

/** 策略视图的一行：lane + 等待时长 + 是否需确认 / one strategy row: lane + wait time + needs-confirmation */
export interface StrategyRow {
  /** 工作单 id（详情 URL 参数）/ the work-order id (the detail url param) */
  readonly id: string
  /** 当前执行载体的记录 id / the active vehicle record's id */
  readonly recordId: string
  readonly title: string
  readonly lane: QueueLane
  readonly targetApp: string
  readonly targetUrl: string
  /** 入队至今的整分钟数 / whole minutes since the record was created */
  readonly waitMinutes: number
  /** 需用户确认才能写（drive 不得自动动它）/ needs explicit user confirmation before writes */
  readonly needsConfirmation: boolean
  readonly claimantSessionId?: string
  readonly leaseUntil?: string
  readonly summary?: string
  readonly failureCode?: string
  readonly dispatchedTo?: string
  readonly attempts?: number
}

/** 计数（闭集字段，不用 Record 逃逸）/ counts (closed fields, no Record escape) */
export interface StrategyCounts {
  readonly takeable: number
  readonly dispatched: number
  readonly held: number
  readonly completed: number
  readonly returned: number
  readonly stale: number
}

/** 工单化首屏的策略视图 / the ticket-style first screen's strategy view */
export interface StrategyView {
  readonly rows: readonly StrategyRow[]
  readonly counts: StrategyCounts
}

/** 跨应用目录行（来源 = 注册表；D 的地图补充）/ a cross-app catalog row (source = the registry; D's map supplement) */
export interface CatalogRow {
  readonly appId: string
  readonly name: string
  /** 入口 URL（规则 1 保证无 :param）/ the entry url (rule 1 guarantees no :param) */
  readonly entryUrl: string
  /** 一句话用途 / the one-line purpose */
  readonly description: string
  /** 该应用名下的在途派发（open/taken 记录数）/ in-flight dispatches targeting this app */
  readonly inflight: number
}

// ---- 同意门（§2）/ the consent gate (§2) ----

/**
 * 一个会话当前回合的同意切片：人类消息 = 广域同意；投递指令 = 按任务 id 收窄。
 * A session's current-turn consent slice: a human message grants broad consent;
 * delivery instructions grant consent narrowed to the named task ids.
 */
export interface TurnConsent {
  readonly userTurn: boolean
  readonly deliveredTaskIds: readonly string[]
}

/** drive 台账项（逐轮声明范围，随 agent 对象回收）/ a drive grant (per-turn scope, reclaimed with the agent) */
export interface DriveGrant {
  /** 'turn' = 本回合任意声明范围（仅人类同意可授）；'tasks' = 仅点名任务 / 'turn' = any declared scope this turn (human consent only); 'tasks' = named tasks only */
  readonly scope: 'turn' | 'tasks'
  readonly taskIds: ReadonlySet<string>
  readonly reason: string
  readonly at: string
}
