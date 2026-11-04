/**
 * Per-agent seen watermarks: the freshness gate's baseline.
 *
 * A watermark records the highest room sequence an agent has been shown.
 * Missing watermarks fail open (a never-woken agent has nothing stale to say);
 * the design's read cursors are a different fact and this module never
 * touches them.
 *
 * 按智能体的已见水位：新鲜度闸门的基线。
 *
 * 水位记录某智能体被展示过的房间最高序号。缺失的水位失败开放（从未被唤醒的智能体没有
 * 说过时话可言）；设计的已读游标是另一个事实，本模块绝不触碰它们。
 *
 * @module @veren/im-coordination/watermarks
 */

import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import { ImError } from '@veren/im'
import type { WatermarkView } from './types.ts'

const watermarkSchema = z.object({
  agent_id: z.string().min(1),
  room_id: z.string().min(1),
  watermark: z.number(),
  updated_at: z.number(),
})

/** One stored watermark row. */
/** 一行存储的水位。 */
export interface WatermarkRow {
  agent_id: string
  room_id: string
  watermark: number
  updated_at: number
}

/** The `im_coordination` domain: currently only watermarks are durable. */
/** `im_coordination` 域：当前只有水位是持久的。 */
export const coordinationDomain = defineDomain({
  name: 'im_coordination',
  version: 1,
  tables: {
    watermarks: domainTable<string, WatermarkRow>(watermarkSchema),
  },
})

/** One opened coordination domain. */
/** 一个已打开的协调域。 */
export type CoordinationStore = Domain<typeof coordinationDomain>

/** The raw-table seam; tests substitute maps. */
/** 裸表接缝；测试用内存 Map 替换。 */
export interface WatermarkTable {
  get(key: string): WatermarkRow | undefined
  put(key: string, value: WatermarkRow): Promise<void>
  delete(key: string): Promise<boolean>
  entries(): IterableIterator<[string, WatermarkRow]>
}

/** Stable key for one watermark row. */
/** 一行水位的稳定键。 */
export function watermarkKey(agentId: string, roomId: string): string {
  return `${agentId}\u0000${roomId}`
}

/** The watermark service. */
/** 水位服务。 */
export class Watermarks {
  private table: WatermarkTable | undefined
  private domain: CoordinationStore | undefined
  private now: () => number

  /**
   * @param now - injectable clock.
   */
  constructor(now: () => number = Date.now) {
    this.now = now
  }

  /** Attach an opened domain (production) or a fake table (tests). */
  /** 挂接已打开的域（生产）或假表（测试）。 */
  attach(table: WatermarkTable): void {
    this.table = table
  }

  /** Open the coordination domain on the host storage. */
  /** 在宿主存储上打开协调域。 */
  async openDomain(ctx: import('@deepseek-ai/cordis').Context): Promise<void> {
    const domain = await ctx.storageDomain.open(coordinationDomain)
    this.domain = domain
    this.attach(domain.table('watermarks'))
  }

  /** Close the opened domain; safe when only a fake table was attached. */
  /** 关闭已打开的域；只挂接假表时同样安全。 */
  async close(): Promise<void> {
    const domain = this.domain
    this.domain = undefined
    this.table = undefined
    await domain?.close()
  }

  /** One agent's watermark in one room; absent reads as zero (fail open). */
  /** 一个智能体在一个房间的水位；缺省按零理解（失败开放）。 */
  read(agentId: string, roomId: string): number {
    return this.table?.get(watermarkKey(agentId, roomId))?.watermark ?? 0
  }

  /** Advance one watermark; watermarks only move forward. */
  /** 推进一个水位；水位只进不退。 */
  async record(agentId: string, roomId: string, watermark: number): Promise<WatermarkView> {
    const existing = this.table?.get(watermarkKey(agentId, roomId))
    if (existing !== undefined && watermark <= existing.watermark) {
      return viewOf(existing)
    }
    const row: WatermarkRow = {
      agent_id: agentId,
      room_id: roomId,
      watermark,
      updated_at: this.now(),
    }
    await this.table?.put(watermarkKey(agentId, roomId), row)
    return viewOf(row)
  }

  /** Every recorded watermark (observability). */
  /** 全部已记录的水位（观测面）。 */
  list(): WatermarkView[] {
    return [...(this.table?.entries() ?? [])].map(([, row]) => viewOf(row))
  }

  /** Guard that the backing table is attached before first use. */
  /** 守卫：首次使用前必须挂接好底层表。 */
  requireTable(): WatermarkTable {
    const table = this.table
    if (table === undefined) throw new ImError('IM_INTERNAL', 'coordination storage is not open')
    return table
  }
}

/** Project one row into its public view. */
/** 把一行投影成公开视图。 */
function viewOf(row: WatermarkRow): WatermarkView {
  return {
    agentParticipantId: row.agent_id,
    roomId: row.room_id,
    watermark: row.watermark,
    updatedAt: row.updated_at,
  }
}
