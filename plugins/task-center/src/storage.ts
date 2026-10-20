/**
 * Durable task-center data: the one storage domain every write goes through.
 *
 * Two tables, on purpose (§4.5): a task's lifecycle status and a notice's
 * delivery state are two independent axes — a task can be done while its
 * notice was never delivered, and vice versa. The domain routes to the
 * profile's default storage backend, so records land under `$DSH_HOME/storages`
 * and survive restarting the Harness.
 *
 * 持久化的任务中心数据：所有写入都经过的唯一存储域。
 *
 * 刻意分成两张表（§4.5）：任务的生命周期状态与通知的投递状态是两条互相独立的轴——任务可能
 * 已完成而通知从未送达，反之亦然。域走 profile 的默认存储后端，记录落在 `$DSH_HOME/storages`
 * 下，重启 Harness 都不会丢。
 *
 * @module @veren/task-center/storage
 */

import { z } from 'zod'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import type { Domain, KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { DeliveryStatus, TaskRecord } from './types.ts'

/**
 * One delivery attempt row for one task (§4.2 通知记录).
 *
 * Phase 1 only writes `mode: 'inbox'`; `wake` is a deliberate non-goal.
 * 一条任务的一次投递行（§4.2 通知记录）。第 1 阶段只写 `mode: 'inbox'`；`wake` 是已定的不做项。
 */
export interface DeliveryRecord {
  /** Notice id, globally unique. */
  readonly id: string
  /** The task this notice delivers. */
  readonly taskId: string
  /** Recipient; phase 1 is single-user `local`. */
  readonly recipient: 'local'
  /** Delivery channel; phase 1 fixes `inbox`. */
  readonly mode: 'inbox'
  /** Delivery state; independent from the task's status. */
  readonly state: DeliveryStatus
  /** Delivery attempts so far. */
  readonly attempts: number
  readonly createdAt: string
  /** Last attempt instant, successful or not. */
  readonly lastAt?: string
  /** Why the last attempt failed; a pending row keeps its reason here. */
  readonly lastError?: string
}

const targetSchema = z.object({
  url: z.string().min(1),
  appId: z.string().min(1),
  page: z.string().min(1),
  params: z.record(z.string(), z.string()),
})

const claimSchema = z.object({
  sessionId: z.string().optional(),
  actor: z.string().min(1),
  leaseUntil: z.string().min(1),
})

const taskSchema = z.object({
  id: z.string().min(1),
  appId: z.string().min(1),
  kind: z.string().min(1),
  title: z.string().min(1),
  body: z.string().optional(),
  target: targetSchema,
  appVersion: z.string(),
  pageRevision: z.number().int().min(0),
  assignee: z.literal('local'),
  status: z.enum(['open', 'taken', 'done', 'failed', 'expired', 'cancelled', 'orphaned']),
  revision: z.number().int().min(1),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  dueAt: z.string().optional(),
  expiresAt: z.string().optional(),
  claimedBy: claimSchema.optional(),
  result: z.object({
    summary: z.string().min(1),
    artifacts: z.array(z.string()).optional(),
  }).optional(),
  failure: z.object({ code: z.string().min(1), message: z.string().min(1) }).optional(),
  origin: z.object({ sessionId: z.string().min(1) }).optional(),
  idempotencyKey: z.string().min(1).optional(),
  schemaVersion: z.number().int().min(1),
})

const deliverySchema = z.object({
  id: z.string().min(1),
  taskId: z.string().min(1),
  recipient: z.literal('local'),
  mode: z.literal('inbox'),
  state: z.enum(['pending', 'delivered', 'read']),
  attempts: z.number().int().min(0),
  createdAt: z.string().min(1),
  lastAt: z.string().optional(),
  lastError: z.string().optional(),
})

/**
 * Authoritative task-center storage.
 *
 * A row that fails its schema rejects opening the whole domain rather than
 * being dropped: a silently vanished task is a task the user believes exists.
 * 权威任务中心存储。某一行不合 schema 会让整个域打开失败，而不是被丢弃：悄悄消失的任务，
 * 在用户看来仍然存在。
 */
export const taskCenterDomain = defineDomain({
  name: 'task_center',
  version: 1,
  tables: {
    // TaskRecord 的字段是 readonly 视图，schema 校验的是同一份数据形状（一次性收窄）
    tasks: domainTable<string, TaskRecord>(taskSchema as never),
    deliveries: domainTable<string, DeliveryRecord>(deliverySchema),
  },
})

/** Storage domain name, shared with diagnostics. */
export const TASK_CENTER_DOMAIN_NAME = taskCenterDomain.name

/**
 * One deliverable notice handed across the delivery seam to session C.
 * 跨投递接缝交给会话 C 的一条可投递通知。
 */
export interface InboxNotice {
  /** The delivery row to report back through `markDelivered`. */
  readonly deliveryId: string
  /** The task being delivered, already lazily swept. */
  readonly task: TaskRecord
  /** The rendered model-facing text to inject as a user message. */
  readonly text: string
}

/** One opened task-center domain. */
export type TaskCenterStore = Domain<typeof taskCenterDomain>

/**
 * Synchronous view over one key/value table; the only surface the service uses.
 * 单张键值表的同步视图；服务只用这四个方法。
 */
export interface TaskTable<T> {
  readonly get: (key: string) => T | undefined
  readonly put: (key: string, value: T) => Promise<void>
  readonly all: () => T[]
}

/** Project one domain table onto the narrow view. */
export function view<T>(table: KvTable<string, T>): TaskTable<T> {
  return {
    get: key => table.get(key),
    put: (key, value) => table.put(key, value),
    all: () => [...table.entries()].map(([, value]) => value),
  }
}
