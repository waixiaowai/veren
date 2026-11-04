/**
 * Durable run records: one wake, one row, append-only event timeline, and the
 * input fingerprint that turns duplicate wakes into `skipped` instead of
 * duplicate thinking (design §3.6).
 *
 * 持久运行记录：一次唤醒一行、只追加的事件时间线，以及把重复唤醒变成 `skipped` 而不是
 * 重复思考的输入指纹（设计 §3.6）。
 *
 * @module @veren/im-turn/runs
 */

import { createHash, randomUUID } from 'node:crypto'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import { ImError } from '@veren/im'
import type { WakeReason } from '@veren/im-coordination'
import type { RunEventView, RunStatus, RunView, SkipCause } from './types.ts'

const runSchema = z.object({
  id: z.string().min(1),
  agent_id: z.string().min(1),
  room_id: z.string().min(1),
  reason: z.enum(['message.new', 'manual']),
  status: z.enum(['running', 'completed', 'failed', 'skipped']),
  skip_cause: z.enum(['nothing-to-read', 'fingerprint-hit', 'budget', 'held-out', 'model-rate-limited', 'model-quota']).optional(),
  error: z.string().optional(),
  reply_message_id: z.string().optional(),
  fingerprint: z.string().optional(),
  started_at: z.number(),
  finished_at: z.number().optional(),
})

const runEventSchema = z.object({
  id: z.string().min(1),
  run_id: z.string().min(1),
  kind: z.string().min(1),
  data: z.string().optional(),
  created_at: z.number(),
})

const agentSessionSchema = z.object({
  key: z.string().min(1),
  session_id: z.string().min(1),
  updated_at: z.number(),
})

/** One agent+room → session mapping row. */
/** 一行智能体+房间 → 会话的映射。 */
export interface AgentSessionRow {
  key: string
  session_id: string
  updated_at: number
}

/** One stored run row. */
/** 一行存储的运行记录。 */
export interface RunRow {
  id: string
  agent_id: string
  room_id: string
  reason: WakeReason
  status: RunStatus
  skip_cause?: SkipCause
  error?: string
  reply_message_id?: string
  fingerprint?: string
  started_at: number
  finished_at?: number
}

/** One stored run-event row; `data` carries one JSON string. */
/** 一行存储的运行事件；`data` 携带一个 JSON 字符串。 */
export interface RunEventRow {
  id: string
  run_id: string
  kind: string
  data?: string
  created_at: number
}

/** The `im_turn` domain. */
/** `im_turn` 域。 */
export const turnDomain = defineDomain({
  name: 'im_turn',
  version: 1,
  tables: {
    runs: domainTable<string, RunRow>(runSchema),
    run_events: domainTable<string, RunEventRow>(runEventSchema),
    agent_sessions: domainTable<string, AgentSessionRow>(agentSessionSchema),
  },
})

/** One opened turn domain. */
/** 一个已打开的回合域。 */
export type TurnStore = Domain<typeof turnDomain>

/** The raw-table seam; tests substitute maps. */
/** 裸表接缝；测试用内存 Map 替换。 */
export interface TurnTables {
  getRun(id: string): RunRow | undefined
  runs(): RunRow[]
  putRun(row: RunRow): Promise<void>
  events(): RunEventRow[]
  putEvent(row: RunEventRow): Promise<void>
}

/** How many recent runs the fingerprint check looks back over. */
/** 指纹检查回看的近期运行数。 */
const FINGERPRINT_LOOKBACK = 8

/** The run store. */
/** 运行记录存储。 */
export class RunStore {
  private tables: TurnTables | undefined
  private now: () => number

  /**
   * @param now - injectable clock.
   */
  constructor(now: () => number = Date.now) {
    this.now = now
  }

  /** Attach an assembled seam (production builds one from the domain). */
  /** 挂接组装好的接缝（生产从域构建）。 */
  attach(tables: TurnTables): void {
    this.tables = tables
  }

  /** Open the turn domain on the host storage. */
  /** 在宿主存储上打开回合域。 */
  async openDomain(ctx: import('@deepseek-ai/cordis').Context): Promise<void> {
    const domain = await ctx.storageDomain.open(turnDomain)
    this.attach({
      getRun: id => domain.table('runs').get(id),
      runs: () => [...domain.table('runs').entries()].map(([, row]) => row),
      putRun: async row => {
        await domain.table('runs').put(row.id, row)
      },
      events: () => [...domain.table('run_events').entries()].map(([, row]) => row),
      putEvent: async row => {
        await domain.table('run_events').put(row.id, row)
      },
    })
  }

  /** Close the opened domain. */
  /** 关闭已打开的域。 */
  async close(): Promise<void> {
    this.tables = undefined
  }

  /** Start one run in the `running` state and record its wake event. */
  /** 以 `running` 状态启动一次运行，并记录唤醒事件。 */
  async start(agentId: string, roomId: string, reason: WakeReason): Promise<RunView> {
    const row: RunRow = {
      id: `run-${randomUUID()}`,
      agent_id: agentId,
      room_id: roomId,
      reason,
      status: 'running',
      started_at: this.now(),
    }
    await this.requireTables().putRun(row)
    await this.append(row.id, 'run.started', { reason, roomId })
    return viewOf(row)
  }

  /** Land one run in a terminal state; terminal states never re-enter. */
  /** 把一次运行落到终态；终态绝不重入。 */
  async finish(
    run: RunView,
    status: Extract<RunStatus, 'completed' | 'failed' | 'skipped'>,
    extra: { skipCause?: SkipCause; error?: string; replyMessageId?: string } = {},
  ): Promise<RunView> {
    const existing = this.requireTables().getRun(run.id)
    if (existing === undefined) {
      throw new ImError('RESOURCE_NOT_FOUND', `unknown run: ${run.id}`)
    }
    if (existing.status !== 'running') {
      throw new ImError('STATE_CONFLICT', `run ${run.id} already finished as ${existing.status}`)
    }
    const row: RunRow = {
      ...existing,
      status,
      finished_at: this.now(),
      ...(extra.skipCause === undefined ? {} : { skip_cause: extra.skipCause }),
      ...(extra.error === undefined ? {} : { error: extra.error }),
      ...(extra.replyMessageId === undefined ? {} : { reply_message_id: extra.replyMessageId }),
    }
    await this.requireTables().putRun(row)
    await this.append(row.id, `run.${status}`, {
      ...(extra.skipCause === undefined ? {} : { skipCause: extra.skipCause }),
      ...(extra.error === undefined ? {} : { error: extra.error }),
    })
    return viewOf(row)
  }

  /** Attach one input fingerprint to a running run. */
  /** 给一个运行中的运行挂上输入指纹。 */
  async stampFingerprint(run: RunView, fingerprint: string): Promise<void> {
    const existing = this.requireTables().getRun(run.id)
    if (existing === undefined) return
    await this.requireTables().putRun({ ...existing, fingerprint })
  }

  /**
   * Whether the same input fingerprint already completed recently for this
   * agent — the duplicate-wake absorber.
   * 同一输入指纹是否近期已为该智能体完成过——重复唤醒的吸收器。
   */
  fingerprintRecentlyDone(agentId: string, fingerprint: string): boolean {
    const recent = this.requireTables().runs()
      .filter(row => row.agent_id === agentId && row.fingerprint === fingerprint)
      .sort((a, b) => b.started_at - a.started_at)
      .slice(0, FINGERPRINT_LOOKBACK)
    return recent.some(row => row.status === 'completed')
  }

  /** Every event of one run, oldest first. */
  /** 一次运行的全部事件，从旧到新。 */
  eventsOf(runId: string): RunEventView[] {
    return this.requireTables().events()
      .filter(row => row.run_id === runId)
      .sort((a, b) => a.created_at - b.created_at)
      .map(row => ({
        runId: row.run_id,
        kind: row.kind,
        ...(row.data === undefined ? {} : { data: JSON.parse(row.data) as unknown }),
        createdAt: row.created_at,
      }))
  }

  /** Every run, newest first (observability). */
  /** 全部运行，从新到旧（观测面）。 */
  list(): RunView[] {
    return this.requireTables().runs()
      .sort((a, b) => b.started_at - a.started_at)
      .map(viewOf)
  }

  /** Append one timeline event; payload is one JSON string, truncated. */
  /** 追加一条时间线事件；载荷为一个 JSON 字符串，超长截断。 */
  private async append(runId: string, kind: string, data: unknown): Promise<void> {
    const MAX_EVENT_JSON = 24_000
    const text = JSON.stringify(data) ?? ''
    await this.requireTables().putEvent({
      id: `evt-${randomUUID()}`,
      run_id: runId,
      kind,
      ...(data === undefined ? {} : { data: text.slice(0, MAX_EVENT_JSON) }),
      created_at: this.now(),
    })
  }

  /** Resolve the attached seam or fail loudly. */
  /** 解析已挂接的接缝，否则响亮失败。 */
  private requireTables(): TurnTables {
    const tables = this.tables
    if (tables === undefined) throw new ImError('IM_INTERNAL', 'turn storage is not open')
    return tables
  }
}

/** Project one run row into its public view. */
/** 把一行运行记录投影成公开视图。 */
function viewOf(row: RunRow): RunView {
  return {
    id: row.id,
    agentParticipantId: row.agent_id,
    roomId: row.room_id,
    reason: row.reason,
    status: row.status,
    ...(row.skip_cause === undefined ? {} : { skipCause: row.skip_cause }),
    ...(row.error === undefined ? {} : { error: row.error }),
    ...(row.reply_message_id === undefined ? {} : { replyMessageId: row.reply_message_id }),
    ...(row.fingerprint === undefined ? {} : { fingerprint: row.fingerprint }),
    startedAt: row.started_at,
    ...(row.finished_at === undefined ? {} : { finishedAt: row.finished_at }),
  }
}

/**
 * Hash one inbox into the run's input fingerprint: agent + room + the unread
 * message ids, order-sensitive.
 * 把一个收件箱散列成运行的输入指纹：智能体+房间+未读消息 id，顺序敏感。
 */
export function fingerprintOf(agentId: string, roomId: string, messageIds: readonly string[]): string {
  return createHash('sha256').update(`${agentId}\u0000${roomId}\u0000${messageIds.join('\u0001')}`).digest('hex')
}
