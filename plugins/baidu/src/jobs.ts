/**
 * 传输任务注册表：上传/下载是长时同步调用，网页网关用"受理后异步跑、
 * 快照轮询"的方式呈现——任务只承诺"已提交"，完成与否以快照为准（设计
 * §11.4：提交中只说 submitted）。注册表活在内存里，随 world 生死，重启
 * 即清空——传输本来就是不可续跑的一次性动作。
 * The transfer job registry: uploads/downloads are long synchronous calls,
 * so the web gateway presents them as "accepted, then run async, snapshot
 * polled" — a job only ever promises "submitted"; completion is read from
 * the snapshot (design §11.4: a pending submit says submitted only). The
 * registry lives in memory, lives and dies with the world, and a restart
 * clears it — a transfer is a one-shot action that never resumes.
 *
 * @module @veren/baidu-pan/jobs
 */
import { randomUUID } from 'node:crypto'
import type { BaiduPanCode, ToolErrorValue } from './errors.js'
import type { DownloadReceipt, UploadReceipt } from './types.js'

/** 任务种类。The job kind. */
export type TransferKind = 'upload' | 'download'

/** 任务阶段（终态：done / failed）。The job phase (terminal: done / failed). */
export type JobPhase = 'running' | 'done' | 'failed'

/** 任务失败值（与工具错误规范值同构，去 kind 字段）。The job failure value (the tool error value's shape minus kind). */
export interface JobFailure {
  readonly code: BaiduPanCode
  readonly message: string
  readonly retryable: boolean
}

/** 任务快照：轮询面唯一读取的形状。The job snapshot: the only shape the polling face reads. */
export interface TransferJobSnapshot {
  readonly id: string
  readonly kind: TransferKind
  /** 展示标签（显示路径 + 本地文件名）。The display label (display path + local file name). */
  readonly label: string
  readonly phase: JobPhase
  readonly startedAt: number
  readonly finishedAt?: number
  readonly receipt?: UploadReceipt | DownloadReceipt
  readonly failure?: JobFailure
}

/** 注册表内部行（可变部分与快照分离）。The registry's internal row (mutable parts kept apart from the snapshot). */
interface JobRow {
  readonly id: string
  readonly kind: TransferKind
  readonly label: string
  readonly startedAt: number
  phase: JobPhase
  finishedAt?: number
  receipt?: UploadReceipt | DownloadReceipt
  failure?: JobFailure
}

/** 快照保留上限与终态保留时长（防内存无界）。Snapshot retention cap and terminal retention (bounded memory). */
const MAX_ROWS = 20
const TERMINAL_TTL_MS = 3600 * 1000

/**
 * 传输任务注册表：start 即受理（同步入表、异步执行），list/snapshotOf
 * 供轮询；终态任务一小时后修剪，总量封顶 20 条。
 * The transfer job registry: start accepts (synchronous insert, async run);
 * list/snapshotOf serve polling; terminal jobs prune after an hour, capped
 * at 20 rows.
 */
export class TransferJobRegistry {
  private readonly rows = new Map<string, JobRow>()

  /**
   * 受理一个传输任务：立即返回任务号，run 在后台执行；run 的抛出折成
   * 规范失败值（foldJob 在网关侧接线）。接受即回执，绝不阻塞调用方。
   * Accepts one transfer job: the id returns immediately and run executes in
   * the background; a throw folds into the canonical failure (wired by
   * foldJob at the gateway). Acceptance answers at once, never blocking.
   */
  start(kind: TransferKind, label: string, run: () => Promise<UploadReceipt | DownloadReceipt>, fold: (error: unknown) => JobFailure): string {
    const row: JobRow = { id: randomUUID(), kind, label, startedAt: Date.now(), phase: 'running' }
    this.rows.set(row.id, row)
    this.prune()
    void this.execute(row, run, fold)
    return row.id
  }

  /** 全部任务的快照（先 running 后其余，各按开始时间倒序）。Snapshots of every job (running first, newest first within groups). */
  list(): TransferJobSnapshot[] {
    const snapshots = [...this.rows.values()].map(row => snapshotOf(row))
    const running = snapshots.filter(job => job.phase === 'running').reverse()
    const settled = snapshots.filter(job => job.phase !== 'running').reverse()
    return [...running, ...settled]
  }

  /** 单个任务的快照；未知任务号返回 undefined。One job's snapshot; unknown ids answer undefined. */
  snapshotOf(id: string): TransferJobSnapshot | undefined {
    const row = this.rows.get(id)
    return row === undefined ? undefined : snapshotOf(row)
  }

  /** 后台执行：终态落行；抛出走 fold 折成规范失败。Runs in the background: terminal states land on the row; throws fold via fold. */
  private async execute(row: JobRow, run: () => Promise<UploadReceipt | DownloadReceipt>, fold: (error: unknown) => JobFailure): Promise<void> {
    try {
      row.receipt = await run()
      row.phase = 'done'
    } catch (error) {
      row.failure = fold(error)
      row.phase = 'failed'
    } finally {
      row.finishedAt = Date.now()
    }
  }

  /** 修剪：总条数封顶，终态超时删除（Map 保插入序，最老的先出）。Prunes: caps rows, drops terminal jobs past the TTL (insertion order evicts oldest first). */
  private prune(): void {
    const now = Date.now()
    for (const [id, row] of this.rows) {
      if (row.phase !== 'running' && row.finishedAt !== undefined && now - row.finishedAt > TERMINAL_TTL_MS) {
        this.rows.delete(id)
      }
    }
    while (this.rows.size > MAX_ROWS) {
      const oldest = this.rows.keys().next().value
      if (oldest === undefined) break
      this.rows.delete(oldest)
    }
  }
}

/** 行 → 只读快照（终态行带 finishedAt）。Row → read-only snapshot (terminal rows carry finishedAt). */
function snapshotOf(row: JobRow): TransferJobSnapshot {
  return {
    id: row.id,
    kind: row.kind,
    label: row.label,
    phase: row.phase,
    startedAt: row.startedAt,
    ...(row.finishedAt === undefined ? {} : { finishedAt: row.finishedAt }),
    ...(row.receipt === undefined ? {} : { receipt: row.receipt }),
    ...(row.failure === undefined ? {} : { failure: row.failure }),
  }
}

/** ToolErrorValue → JobFailure 的窄化（去 kind）。Narrows a ToolErrorValue into a JobFailure (drops kind). */
export function foldJobFailure(error: ToolErrorValue): JobFailure {
  return { code: error.code, message: error.message, retryable: error.retryable }
}
