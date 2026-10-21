/**
 * 任务侧共享契约（只放类型与常量）/ Task-side shared contracts (types & constants only)
 *
 * 本文件是会话 B（task-center 实现）与其它会话之间的接口合同：
 * - 字段语义以 docs/application-concept.cn.md §4.2、§4.4、§4.5 为准；
 * - 任务目标存规范 URL（`PageInstanceKey` 来自 @veren/prompt-page，不反向依赖插件）；
 * - 任务状态（status）与通知投递（delivery）是两条轴，互不推导。
 */
import type { PageInstanceKey } from '@veren/prompt-page'

/** 任务 id：全局唯一 / globally unique task id */
export type TaskId = string & { readonly __brand: 'TaskId' }

/** 任务 kind：`<appId>/<kind>`，应用自定义类型 / task kind like `review-workbench/review-request` */
export type TaskKind = string & { readonly __brand: 'TaskKind' }

/** 任务状态机（§4.4）/ task lifecycle states */
export type TaskStatus = 'open' | 'taken' | 'done' | 'failed' | 'expired' | 'cancelled' | 'orphaned'

/** 通知投递状态（§4.5；与任务状态互不推导）/ delivery states (independent axis from task status) */
export type DeliveryStatus = 'pending' | 'delivered' | 'read'

/** 任务目标：规范 URL 是主键，解析字段用于校验/分组/升级判断 / task target keyed by canonical url */
export interface TaskTarget {
  /** 规范 URL（页面实例主键）/ canonical url (page-instance primary key) */
  readonly url: PageInstanceKey
  readonly appId: string
  readonly page: string
  readonly params: Readonly<Record<string, string>>
}

/** 接取者与租约 / claimant and lease */
export interface TaskClaim {
  readonly sessionId?: string
  /** 第 1 阶段固定 'local' / fixed to 'local' in phase 1 */
  readonly actor: string
  /** 租约到期时间（ISO）；页面会话每次调任务工具续租 / lease deadline, renewed on each task tool call */
  readonly leaseUntil: string
}

/** 完成结果 / completion result */
export interface TaskResult {
  readonly summary: string
  readonly artifacts?: readonly string[]
}

/** 失败记录 / failure record */
export interface TaskFailure {
  /** 稳定错误码 / stable code */
  readonly code: string
  readonly message: string
}

/** 任务记录（§4.2）/ task record */
export interface TaskRecord {
  readonly id: TaskId
  /** 谁发的；只有注册且启用的应用能发 / sender app */
  readonly appId: string
  readonly kind: TaskKind
  /** 必填，已 trim，长度上限 200 / required, trimmed, capped */
  readonly title: string
  /** 可选说明（进上下文时有字节上限）/ optional body */
  readonly body?: string
  readonly target: TaskTarget
  /** 发送时快照，供升级判断（§7.3）/ snapshots for upgrade decisions */
  readonly appVersion: string
  /** 第 1 阶段固定 'local' / fixed recipient in phase 1 */
  readonly assignee: 'local'
  readonly status: TaskStatus
  /** 乐观并发版本；每次迁移 +1（CAS 用）/ optimistic revision for CAS */
  readonly revision: number
  readonly createdAt: string
  readonly updatedAt: string
  readonly dueAt?: string
  /** 过期只对 'open' 生效 / expiry applies only to 'open' */
  readonly expiresAt?: string
  readonly claimedBy?: TaskClaim
  readonly result?: TaskResult
  readonly failure?: TaskFailure
  /** 任务若由某个会话代发，回报给它 / origin session to report back to */
  readonly origin?: { readonly sessionId: string }
  /** 应用重试发送去重 / dedup on sender retries */
  readonly idempotencyKey?: string
  /** 持久化格式版本 / persistence schema version */
  readonly schemaVersion: number
  /**
   * 直接父任务 id；缺省 = 根任务（§4.7.1）。只在创建子任务时写一次，之后不可变——
   * 没有任何接口能改它，环因此结构上不可能。/ direct parent id; absent = root.
   * Written once at creation, immutable afterwards — no API can change it,
   * which is what makes cycles structurally impossible.
   */
  readonly parentId?: TaskId
  /**
   * 从根到直接父的 id 数组（根任务为 `[]`，孙任务为 `[根id, 父id]`），随创建一次定型。
   * 整棵子树的操作（级联/完成校验/互斥）都走它的前缀查询。
   * / ids from the root to the direct parent (root: [], grandchild: [root, parent]),
   * fixed at creation; every whole-subtree operation (cascade, completion check,
   * tree mutex) is one prefix query over it.
   */
  readonly ancestorIds: readonly TaskId[]
}

/** 发送草稿 / task draft for send() */
export interface TaskDraft {
  readonly kind: TaskKind
  readonly title: string
  readonly body?: string
  readonly target: TaskTarget
  readonly dueAt?: string
  readonly expiresAt?: string
  readonly origin?: { readonly sessionId: string }
  readonly idempotencyKey?: string
}

/** 列表查询 / list query */
export interface TaskQuery {
  readonly appId?: string
  readonly status?: TaskStatus
  readonly assignee?: 'local'
  /**
   * 按接取会话过滤（只对 `status: 'taken'` 有意义）：页面注册表废弃会话时
   * 用它找到该会话持有的租约并释放（§3.5.3）。
   * Filter by the claiming session (meaningful with `status: 'taken'`): the
   * page registry uses it to find and release the leases a deprecated session
   * holds (§3.5.3).
   */
  readonly claimedBySession?: string
}

/** TaskCenterService 的方法签名契约 / method-signature contract of TaskCenterService */
export interface TaskCenterContract {
  send(draft: TaskDraft): Promise<TaskRecord>
  /**
   * 在 `parentId` 下新建一条子任务（§4.7.6 第 1 阶段唯一的拆分入口）。
   * 父指针不可变：本方法永远创建新记录，不做任何改挂。
   * / create one subtask under `parentId` (the only split entry in phase 1).
   * The parent pointer is immutable: this always creates a new record,
   * never re-parents.
   */
  addSubtask(
    parentId: TaskId,
    draft: TaskDraft,
    opts?: { readonly claimantSessionId?: string },
  ): Promise<TaskRecord>
  list(query: TaskQuery): Promise<readonly TaskRecord[]>
  get(id: TaskId): Promise<TaskRecord | undefined>
  /** 接取是 CAS（比较 revision）；写租约 / take is CAS on revision with a lease */
  take(id: TaskId, claim: Omit<TaskClaim, 'leaseUntil'> & { leaseUntil: string }): Promise<TaskRecord>
  release(id: TaskId, reason: string): Promise<TaskRecord>
  /** 幂等：重复 complete 返回当前结果并标 alreadyCompleted / idempotent completion */
  complete(id: TaskId, result: TaskResult): Promise<TaskRecord>
  fail(id: TaskId, failure: TaskFailure): Promise<TaskRecord>
  cancel(id: TaskId, reason: string): Promise<TaskRecord>
}

/** 任务侧稳定错误码 / stable task error codes */
export const TaskErrorCode = {
  /** 任务过期（只对 open 生效）/ task expired before take */
  Expired: 'task/expired',
  /** 任务不存在 / task not found */
  NotFound: 'task/not-found',
  /** 已被别的接取者拿走；子任务后也覆盖“同树已被别的会话持有”（§4.7.3）/ taken by another claimant; after subtasks also "the tree is held by another session" */
  AlreadyTaken: 'task/already-taken',
  /** 租约过期被回收 / lease expired and recycled */
  LeaseExpired: 'task/lease-expired',
  /** 同一规范 URL 上其它任务树已有活跃接取者（跨树互斥，§4.7.3）/ another task tree on the same url has an active claimant (cross-tree mutex) */
  AnotherActive: 'task/another-active',
  /** 目标页面已不存在 / target page gone */
  TargetGone: 'task/target-gone',
  /** 应用升级导致目标过期（§7.3）/ target stale after app upgrade */
  AppUpgraded: 'task/app-upgraded',
  /** 发送方未声明 tasks:send / sender lacks tasks:send */
  SendForbidden: 'task/send-forbidden',
  /** 标题/正文/参数超限 / limits exceeded */
  DraftInvalid: 'task/draft-invalid',
  /** 改写 taken 任务的不是接取者 / the caller is not the claimant */
  NotClaimant: 'task/not-claimant',
  /** 任务属于已卸载应用 / task belongs to an uninstalled app */
  Orphaned: 'task/orphaned',
  /** 任务处于不允许迁移的状态 / task is in a state that forbids the migration */
  InvalidState: 'task/invalid-state',
  /** 父任务完成时子树仍有非终态后代（§4.7.2 规则一）/ the subtree still has non-terminal descendants at parent completion */
  ChildrenActive: 'task/children-active',
  /** 超出子树安全上限：深度/宽度/节点数（§4.7.1）/ a subtree safety limit (depth/width/size) is exceeded */
  SubtreeLimit: 'task/subtree-limit',
  /** 子任务 target.url 与父任务不一致 / the subtask target.url differs from its parent's */
  SubtaskTargetMismatch: 'task/subtask-target-mismatch',
  /** 要拆的父任务已不存在 / the parent task to split no longer exists */
  ParentGone: 'task/parent-gone',
  /** 因祖先取消/过期/孤儿而级联进入终态 / cascaded into a terminal state because an ancestor was cancelled/expired/orphaned */
  CascadeCancelled: 'task/cascade-cancelled',
  /** 存储域打不开，写面整体不可用（≠ task/* 的生命周期码）/ the storage domain cannot open; the write face is down */
  StorageUnavailable: 'task-center/storage-unavailable',
} as const

export type TaskErrorCode = (typeof TaskErrorCode)[keyof typeof TaskErrorCode]

/**
 * `task/subtree-limit` 拒绝时携带的机器可读明细（§4.7.1）。
 * The machine-readable detail a `task/subtree-limit` refusal carries.
 */
export interface SubtreeLimitDetail {
  /** 超的是哪条上限 / which limit was hit */
  readonly kind: 'depth' | 'width' | 'size'
  /** 上限值 / the limit */
  readonly limit: number
  /** 触发时的实际值 / the actual value at trigger time */
  readonly actual: number
}
