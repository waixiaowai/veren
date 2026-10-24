/**
 * TaskCenterService: the host-level persistent work queue + personal inbox.
 *
 * This file keeps the public face: the Service class, its config, the event
 * contract, and the unchanged re-export surface. By responsibility the module
 * is split into `service-storage.ts` (domain open + FIFO write chain),
 * `service-tree.ts` (index, save, sweep pump, cascades, tree guards),
 * `service-tasks.ts` (send / subtask / reads / orphaning),
 * `service-mutations.ts` (take / release / complete / fail / cancel), and
 * `service-delivery.ts` (the inbox seam).
 *
 * Every mutation runs on one FIFO write chain (§4.4: 每次迁移都在一个串行写链里完成).
 * Expiry and lease recycling are lazy — evaluated from `expiresAt` / `leaseUntil`
 * at the head of every operation; there is no background timer. Completion and
 * failure are idempotent: a task already terminal returns its first outcome
 * unchanged. Task targets store the canonical URL only; session attribution is
 * the page runtime's job (session C).
 *
 * 任务中心：宿主级持久工作队列 + 个人收件箱。
 *
 * 本文件保留公开门面：Service 类、配置、事件契约与原样不变的再导出面。模块按职责拆为
 * `service-storage.ts`（域打开 + FIFO 写链）、`service-tree.ts`（索引、写入口、清扫泵、级联、
 * 树级守卫）、`service-tasks.ts`（send / 子任务 / 读取 / 孤儿扫入）、`service-mutations.ts`
 * （接取 / 释放 / 完成 / 失败 / 取消）与 `service-delivery.ts`（收件箱接缝）。
 *
 * 所有迁移都在一条 FIFO 串行写链上完成（§4.4）。过期与租约回收是懒判定——每次操作开头按
 * `expiresAt` / `leaseUntil` 现算，没有后台定时器。complete/fail 幂等：任务已到终态时原样
 * 返回首次结果。任务目标只存规范 URL；会话归属由页面运行时（会话 C）解析。
 *
 * @module @veren/task-center/service
 */
import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { registerTaskTools } from './tools.ts'
import { TaskStorage } from './service-storage.ts'
import { TaskTree } from './service-tree.ts'
import type { TaskOps } from './service-tree.ts'
import { createSubtask, getTask, listTasks, orphanAppTasks, sendTask } from './service-tasks.ts'
import { cancelTask, completeTask, failTask, releaseTask, takeTask } from './service-mutations.ts'
import { collectPendingDeliveries, markDelivered } from './service-delivery.ts'
import { TaskError } from './tree.ts'
import type { DeliveryRecord, InboxNotice } from './storage.ts'
import type { TaskCenterContract, TaskDraft, TaskFailure, TaskId, TaskQuery, TaskRecord, TaskResult } from './types.ts'

/** 服务名（ctx.taskCenter / inject 'taskCenter'）/ service name */
export const TASK_CENTER_NAME = 'taskCenter'

/** The one structured-refusal class lives in tree.ts; re-exported unchanged here. */
export { TaskError }
/** Re-exported from the segments that own them; the surface is unchanged. */
export { MAX_BODY_CHARS, MAX_TITLE_CHARS } from './service-tasks.ts'
export { noticeText } from './service-delivery.ts'

/**
 * App facts the task center needs, resolved lazily so this package never
 * imports session A's implementation.
 * 任务中心需要的应用事实，惰性解析，本包绝不 import 会话 A 的实现。
 */
export interface AppSnapshot {
  readonly state: 'active' | 'disabled' | 'broken'
  readonly version: string
}

/** Delayed app lookup; the host (or session A) wires it via {@link setAppResolver}. */
export type AppResolver = (appId: string) => Promise<AppSnapshot | undefined>

/** Config schema (AGENTS: 插件必须用 schemastery 定义 config). */
export type TaskCenterConfig = { tools: { enabled: boolean } }
export const Config: z<TaskCenterConfig> = z.object({
  tools: z.object({ enabled: z.boolean().default(true) }).default({ enabled: true }),
})

declare module '@deepseek-ai/cordis' {
  interface Events {
    /** A task durably changed state (sent, taken, renewed, released, expired…). @mode emit */
    'task-center/changed'(payload: { taskId: TaskId; action: string }): void
    /** A task reached `done`; apps subscribe to report back. @mode emit */
    'task-center/completed'(payload: {
      taskId: TaskId
      appId: string
      result: TaskResult
      sessionId?: string
    }): void
  }
}

export class TaskCenterService extends Service implements TaskCenterContract {
  static inject = ['storageDomain', 'tools']
  static Config = Config

  private readonly ops: TaskOps
  private resolver: AppResolver | undefined

  constructor(ctx: Context, config: TaskCenterConfig = { tools: { enabled: true } }) {
    super(ctx, TASK_CENTER_NAME)
    const tree = new TaskTree()
    this.ops = {
      host: ctx,
      appResolver: () => this.resolver,
      storage: new TaskStorage(ctx),
      tree,
    }
    if (config.tools.enabled) registerTaskTools(ctx, () => this)
  }

  async [Service.init](): Promise<void> {
    await this.ops.storage.ready
  }

  /** Wire the app registry explicitly — app-host does this at assembly time.
   *  Unset, send degrades to warn-and-pass and no orphan sweep runs. */
  setAppResolver(resolver: AppResolver | undefined): void {
    this.resolver = resolver
  }

  async send(draft: TaskDraft): Promise<TaskRecord> {
    return sendTask(this.ops, draft)
  }

  /**
   * 在 `parentId` 下新建一条子任务（§4.7.6 第 1 阶段唯一的拆分入口）。
   * 父指针不可变：本方法永远创建新记录，不做任何改挂。
   * / Create one subtask under `parentId` (§4.7.6). The parent pointer is
   * immutable: this always creates a new record, never re-parents.
   */
  async addSubtask(
    parentId: TaskId,
    draft: TaskDraft,
    opts: { readonly claimantSessionId?: string } = {},
  ): Promise<TaskRecord> {
    return createSubtask(this.ops, parentId, draft, opts)
  }

  async list(query: TaskQuery): Promise<readonly TaskRecord[]> {
    return listTasks(this.ops, query)
  }

  async get(id: TaskId): Promise<TaskRecord | undefined> {
    return getTask(this.ops, id)
  }

  async take(id: TaskId, claim: Parameters<TaskCenterContract['take']>[1]): Promise<TaskRecord> {
    return takeTask(this.ops, id, claim)
  }

  async release(id: TaskId, reason: string): Promise<TaskRecord> {
    return releaseTask(this.ops, id, reason)
  }

  async complete(id: TaskId, result: TaskResult): Promise<TaskRecord> {
    return completeTask(this.ops, id, result)
  }

  async fail(id: TaskId, failure: TaskFailure): Promise<TaskRecord> {
    return failTask(this.ops, id, failure)
  }

  async cancel(id: TaskId, reason: string): Promise<TaskRecord> {
    return cancelTask(this.ops, id, reason)
  }

  /**
   * 投递接缝（会话 C 调这里）/ Delivery seam for session C; see
   * `service-delivery.ts`.
   */
  async pendingDeliveries(): Promise<readonly InboxNotice[]> {
    return collectPendingDeliveries(this.ops)
  }

  /** Session C reports one delivery attempt's outcome; see `service-delivery.ts`. */
  async markDelivered(deliveryId: string, error?: string): Promise<DeliveryRecord | undefined> {
    return markDelivered(this.ops, deliveryId, error)
  }

  /**
   * Uninstall semantics (§7.4): mark every open/taken task of `appId`
   * `orphaned` — records are kept, never deleted; see `service-tasks.ts`.
   * 卸载语义（§7.4）：该应用的 open/taken 任务全部标 `orphaned`——只保留，不删除。
   */
  async markAppOrphaned(appId: string, reason: string): Promise<readonly TaskRecord[]> {
    return orphanAppTasks(this.ops, appId, reason)
  }
}
