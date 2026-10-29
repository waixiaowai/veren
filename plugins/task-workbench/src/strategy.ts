/**
 * 策略视图（docs/task-workbench-modes-dispatch §3.2/§6）：队列权威在任务中心，
 * 本文件是从记录集到五 lane 工单视图的全部确定性派生——不让模型即兴。
 * The strategy view (§3.2/§6 of the design doc): the queue's authority is the
 * task center; this file holds every deterministic derivation from the record
 * set to the five-lane work-order view — the model never improvises it.
 * @module @veren/task-workbench
 */
import type { AppRecord } from '@veren/app-registry'
import type { TaskRecord } from '@veren/task-center'
import type { CatalogRow, QueueLane, StrategyCounts, StrategyRow, StrategyView } from './types.ts'

/** 应用 id（页面 URL 前缀与入站判定的权威；app.ts 的定义引这里）/ the app id (url prefix and inbound-test authority) */
export const SELF_APP_ID = 'task-workbench'

/** 工作台自产记录的幂等键前缀（出站/种子共用）/ the idempotency-key prefix of workbench-originated records */
export const WORKBENCH_KEY_PREFIX = 'task-workbench/'

/** 记录终态集合（与 task-center 同一口径）/ the terminal statuses (same set as the task center) */
const TERMINAL: ReadonlySet<TaskRecord['status']> = new Set(['done', 'failed', 'expired', 'cancelled', 'orphaned'])

/** 目标应用 id 的 URL 段（/apps/<appId>/…）/ the appId segment of a canonical url */
function appIdOfUrl(url: string): string {
  return url.split('/').filter((segment) => segment.length > 0)[1] ?? ''
}

/**
 * 一条记录是否属于本工作台的队列：入站（target 是本应用）或工作台自产
 * （幂等键前缀）。别的应用互发的任务不入我们的队列。
 * Whether one record belongs to this workbench's queue: inbound (targeted at
 * this app) or workbench-originated (the idempotency-key prefix). Tasks other
 * apps send each other never enter our queue.
 */
export function belongsToQueue(record: TaskRecord): boolean {
  return record.target.appId === SELF_APP_ID
    || (record.idempotencyKey?.startsWith(WORKBENCH_KEY_PREFIX) === true)
}

/**
 * 根记录的工作单 id：入站取 target.params.taskId（详情 URL 参数，跨重启稳定）；
 * 出站取幂等键内嵌的 itemId；兜底 wb-<记录id>。
 * A root record's work-order id: inbound reads target.params.taskId (the detail
 * url param, stable across restarts); outbound reads the itemId embedded in the
 * idempotency key; the fallback is wb-<recordId>.
 */
export function itemKeyOf(record: TaskRecord): string {
  const inboundParam = record.target.params['taskId']
  if (record.target.appId === SELF_APP_ID && typeof inboundParam === 'string' && inboundParam.length > 0) {
    return inboundParam
  }
  const key = record.idempotencyKey
  if (key?.startsWith(WORKBENCH_KEY_PREFIX) === true) {
    return key.slice(WORKBENCH_KEY_PREFIX.length).split('/')[0] ?? `wb-${record.id}`
  }
  return `wb-${record.id}`
}

/** lane 判定（§3.2 表，对单条记录）/ the lane verdict (the §3.2 table, per record) */
export function laneOf(record: TaskRecord): QueueLane {
  switch (record.status) {
    case 'open': return record.target.appId === SELF_APP_ID ? 'takeable' : 'dispatched'
    case 'taken': return 'held'
    case 'done': return 'completed'
    case 'failed':
    case 'orphaned': return 'returned'
    default: return 'stale'
  }
}

/** 需确认面（§3.2：drive 不得自动动的行）/ the needs-confirmation face (§3.2: rows drive must not touch) */
function needsConfirmationOf(lane: QueueLane): boolean {
  return lane === 'dispatched' || lane === 'held' || lane === 'returned'
}

/**
 * 组内活跃载体：最新 updatedAt 的非终态记录优先，否则最新终态（历史行）。
 * A group's active vehicle: the latest non-terminal record by updatedAt, else
 * the latest terminal one (the history row).
 */
export function activeRecordOf(group: readonly TaskRecord[]): TaskRecord {
  const sortable = [...group].sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))
  return [...sortable].reverse().find((record) => !TERMINAL.has(record.status)) ?? sortable[sortable.length - 1]!
}

/** 以记录投影一行 / project one row from the active record */
function rowOf(id: string, record: TaskRecord, now: number): StrategyRow {
  const lane = laneOf(record)
  return {
    id,
    recordId: record.id,
    title: record.title,
    lane,
    targetApp: record.target.appId,
    targetUrl: record.target.url,
    waitMinutes: Math.max(0, Math.round((now - Date.parse(record.createdAt)) / 60_000)),
    needsConfirmation: needsConfirmationOf(lane),
    ...(record.claimedBy?.sessionId === undefined ? {} : { claimantSessionId: record.claimedBy.sessionId }),
    ...(record.claimedBy === undefined ? {} : { leaseUntil: record.claimedBy.leaseUntil }),
    ...(record.result?.summary === undefined ? {} : { summary: record.result.summary }),
    ...(record.failure === undefined ? {} : { failureCode: record.failure.code }),
    ...(lane === 'dispatched' ? { dispatchedTo: record.target.appId } : {}),
  }
}

/**
 * 策略视图：过滤本队列记录 → 按 working id 分组（根级记录计数 = attempts）→
 * 每组取活跃载体投影一行。
 * The strategy view: keep this queue's records → group by working id (root-level
 * records count = attempts) → project one row per group from its active vehicle.
 */
export function strategyView(records: readonly TaskRecord[], now = Date.now()): StrategyView {
  const groups = new Map<string, TaskRecord[]>()
  for (const record of records) {
    if (!belongsToQueue(record)) continue
    const key = record.parentId === undefined
      ? itemKeyOf(record)
      : rootKeyOf(record, records)
    if (key === undefined) continue
    const group = groups.get(key) ?? []
    group.push(record)
    groups.set(key, group)
  }
  const rows = [...groups.entries()]
    .map(([id, group]) => {
      const active = activeRecordOf(group)
      const attempts = group.filter((entry) => entry.parentId === undefined).length
      return { ...rowOf(id, active, now), ...(attempts > 1 ? { attempts } : {}) }
    })
    .sort((left, right) => left.waitMinutes - right.waitMinutes)
  return { rows, counts: countLanes(rows) }
}

/** 子任务记录归属其根的工作单 id / a subtask record joins its root's work-order id */
function rootKeyOf(record: TaskRecord, records: readonly TaskRecord[]): string | undefined {
  const rootId = record.ancestorIds[0] ?? record.parentId
  if (rootId === undefined) return itemKeyOf(record)
  const root = records.find((entry) => entry.id === rootId)
  return root === undefined ? undefined : itemKeyOf(root)
}

/** 闭集 lane 计数 / closed-set lane counts */
function countLanes(rows: readonly StrategyRow[]): StrategyCounts {
  const counts: { [K in QueueLane]: number } = { takeable: 0, dispatched: 0, held: 0, completed: 0, returned: 0, stale: 0 }
  for (const row of rows) counts[row.lane] += 1
  return counts
}

/**
 * 一棵记录子树（根自己 + ancestorIds 前缀查询）与其整树进度。
 * One record subtree (the root plus an ancestorIds prefix query) and its
 * whole-tree progress.
 */
export function subtreeOf(records: readonly TaskRecord[], rootRecordId: TaskRecord['id']): readonly TaskRecord[] {
  return records.filter((record) => record.id === rootRecordId || record.ancestorIds.includes(rootRecordId))
}

export function subtreeProgressLabel(records: readonly TaskRecord[], rootRecordId: TaskRecord['id']): string {
  const tree = subtreeOf(records, rootRecordId)
  const done = tree.filter((record) => TERMINAL.has(record.status)).length
  return `${done}/${tree.length}`
}

/**
 * 跨应用目录行（§6）：来源 = 注册表目录（active 应用），逐条带入口 URL、用途
 * 一句话、该应用名下的在途派发数。入口缺失（broken）的应用如实标注。
 * Cross-app catalog rows (§6): source = the registry catalog (active apps),
 * each with the entry url, its one-line purpose, and the in-flight dispatches
 * targeting it. Apps with a missing entry are marked honestly.
 */
export function catalogRows(catalog: readonly AppRecord[], records: readonly TaskRecord[]): readonly CatalogRow[] {
  return catalog
    .filter((record) => record.state === 'active')
    .map((record) => {
      const entryPage = record.pages?.get(record.definition.entry)
      return {
        appId: record.definition.id,
        name: record.definition.name,
        entryUrl: entryPage?.url ?? '(入口未注册 / entry not registered)',
        description: record.definition.description,
        inflight: records.filter((entry) =>
          entry.target.appId === record.definition.id
          && (entry.status === 'open' || entry.status === 'taken')).length,
      }
    })
}
