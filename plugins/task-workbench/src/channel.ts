/**
 * 任务接缝（本包与任务中心之间的唯一通道）。taskCenter 是声明的硬 inject：
 * 通道从注入的服务面纯参数构建，没有"缺席即降级"的运行期探测（G13）。
 * The task-channel seam (the only path between this package and the task
 * center). taskCenter is a declared hard inject: the channel is built from the
 * injected service face as a pure parameter — no availability probing (G13).
 *
 * v2（队列权威搬家，§1.1）：通道扩成中心优先的完整读写面——接取（CAS+租约）、
 * 完成/放弃/失败（带接取者校验）、列表与子树查询。工具动作体只经由通道触达
 * 任务中心，不直接持有服务对象。
 * v2 (the queue-authority move, §1.1): the channel widens to the full
 * center-first read/write face — take (CAS + lease), complete/release/fail
 * (claimant-checked), list and subtree queries. Tool action bodies reach the
 * center only through this channel, never by holding the service object.
 * @module @veren/task-workbench
 */
import { TaskErrorCode } from '@veren/task-center'
import type {
  TaskCenterContract, TaskDraft, TaskFailure, TaskId, TaskQuery, TaskRecord, TaskResult,
} from '@veren/task-center'
import { SELF_APP_ID } from './strategy.ts'

/** 子任务创建选项 / options for creating a subtask */
export interface SplitOptions {
  /** 调用会话 id；任务中心用它校验"仅当前接取者可拆"（§4.7.6） */
  readonly claimantSessionId?: string
  readonly body?: string
}

/** 页面作用域接取的租约声明 / the lease claim for the page-scoped take */
export interface PageTakeClaim {
  readonly sessionId: string
  readonly leaseUntil: string
}

/** 任务中心契约的任务通道投影 / the task-center contract projected onto the channel */
export interface TaskChannel {
  send(draft: TaskDraft): Promise<TaskRecord>
  /** 现拆子任务（§4.7.6）；服务面校验 target 一致与安全上限，返回子任务记录 */
  addSubtask(parentId: TaskId, title: string, opts?: SplitOptions): Promise<TaskRecord>
  /** 按目标规范 URL 找根任务记录；无对应记录 → undefined */
  findByTarget(url: string): Promise<TaskRecord | undefined>
  /** 接取租约（CAS；同一接取者重复接取幂等，§4.4）*/
  take(id: TaskId, claim: PageTakeClaim): Promise<TaskRecord>
  list(query?: TaskQuery): Promise<readonly TaskRecord[]>
  get(id: TaskId): Promise<TaskRecord | undefined>
  /** 完成前校验调用会话就是接取者（task/not-claimant）*/
  completeAsClaimant(id: TaskId, result: TaskResult, sessionId: string | undefined): Promise<TaskRecord>
  /** 放弃 = 中心 release（回 open 队列）；同样校验接取者 */
  releaseAsClaimant(id: TaskId, reason: string, sessionId: string | undefined): Promise<TaskRecord>
  /** 失败 = 中心 fail（退回队列的 returned lane 入口）*/
  failAsClaimant(id: TaskId, failure: TaskFailure, sessionId: string | undefined): Promise<TaskRecord>
  cancel(id: TaskId, reason: string): Promise<TaskRecord>
}

/** 接取者校验：改写 taken 任务前确认调用方就是接取者（§5.6 语义，中心工具同款）*/
function assertClaimant(record: TaskRecord, sessionId: string | undefined): void {
  if (record.status === 'taken' && record.claimedBy?.sessionId !== undefined
    && record.claimedBy.sessionId !== sessionId) {
    throw Object.assign(new Error(`task ${record.id} is claimed by session ${record.claimedBy.sessionId}`), {
      code: TaskErrorCode.NotClaimant,
    })
  }
}

/** 从注入的服务面构建通道：纯参数，不触碰 ctx / build the channel from the injected face: pure parameters */
export function createTaskChannel(taskCenter: TaskCenterContract): TaskChannel {
  return {
    send: async (draft) => await taskCenter.send(draft),
    addSubtask: async (parentId, title, opts) => {
      // 父记录在这里解析，工具侧只传 id + 标题 / the parent is resolved here; the tool passes id + title
      const parent = await taskCenter.get(parentId)
      if (parent === undefined) {
        throw Object.assign(new Error(`parent task ${parentId} not found in the task center`), {
          code: TaskErrorCode.ParentGone,
        })
      }
      return await taskCenter.addSubtask(parent.id, {
        kind: parent.kind,
        title,
        target: parent.target,
        ...(opts?.body === undefined ? {} : { body: opts.body }),
      }, { ...(opts?.claimantSessionId === undefined ? {} : { claimantSessionId: opts.claimantSessionId }) })
    },
    findByTarget: async (url) => {
      const records = await taskCenter.list({ appId: SELF_APP_ID })
      // 收件箱只出现根任务（§4.7.5）：先取根再按 URL 匹配 / roots only (§4.7.5): roots first, then match by url
      return records.find((record) => record.parentId === undefined && record.target.url === url)
    },
    take: (id, claim) => taskCenter.take(id, {
      sessionId: claim.sessionId,
      actor: 'model',
      leaseUntil: claim.leaseUntil,
    }),
    list: (query) => taskCenter.list(query ?? {}),
    get: (id) => taskCenter.get(id),
    completeAsClaimant: async (id, result, sessionId) => {
      const current = await taskCenter.get(id)
      if (current !== undefined) assertClaimant(current, sessionId)
      return await taskCenter.complete(id, result)
    },
    releaseAsClaimant: async (id, reason, sessionId) => {
      const current = await taskCenter.get(id)
      if (current !== undefined) assertClaimant(current, sessionId)
      return await taskCenter.release(id, reason)
    },
    failAsClaimant: async (id, failure, sessionId) => {
      const current = await taskCenter.get(id)
      if (current !== undefined) assertClaimant(current, sessionId)
      return await taskCenter.fail(id, failure)
    },
    cancel: (id, reason) => taskCenter.cancel(id, reason),
  }
}
