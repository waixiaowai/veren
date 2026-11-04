/**
 * Agent long-term memory: durable facts an agent chooses to keep across turns
 * (design §5).
 *
 * The shipped recall is the design's degradation path — pinned entries first,
 * then most-recently-updated — because vectors are a later refinement and
 * degraded recall must never block a turn. Scope filtering follows the design:
 * global memories are visible everywhere; a project-scoped memory is visible
 * only to wakes in that project (DSH workspace). Same-path writes overwrite
 * rather than append, so repeated saves of the same fact stay one entry.
 * 智能体长期记忆：智能体选择跨回合保留的持久事实（设计 §5）。
 *
 * 交付的召回是设计的降级路径——置顶优先，其余按最近更新——因为向量是后续精化，而降级的召回
 * 绝不能阻塞回合。作用域过滤遵循设计：全局记忆处处可见；项目作用域记忆只对属于该项目
 * （DSH 工作区）的唤醒可见。同路径的写入是覆盖而非追加，同一事实的反复保存仍是一条条目。
 *
 * @module @veren/im/memory
 */

import { randomUUID } from 'node:crypto'
import { defineToken } from '@veren/core'
import type { ImMemoryRow } from './store.ts'
import type { ImMemoryStore } from './store.ts'

/** One memory write. Identity fields are assigned here, not by the caller. */
/** 一次记忆写入。标识字段在这里分配，不由调用方给。 */
export interface ImRememberInput {
  readonly agentParticipantId: string
  readonly kind: ImMemoryRow['kind']
  readonly body: string
  /** The participant (or free-form subject) this memory is about. */
  /** 这条记忆指向的参与者（或自由主题）。 */
  readonly about?: string
  /** DSH workspace scope; omit for a global memory. */
  /** DSH 工作区作用域；省略即全局记忆。 */
  readonly projectId?: string
  /** Room the memory was taken from, for provenance. */
  /** 记忆来源的房间，用于溯源。 */
  readonly roomId?: string
  /** Pinned entries always surface first in recall. */
  /** 置顶条目在召回中恒在最前。 */
  readonly pinned?: boolean
}

/** One recall request. */
/** 一次召回请求。 */
export interface ImRecallQuery {
  readonly agentParticipantId: string
  /** Narrow to memories about this participant or subject. */
  /** 只召回指向该参与者或主题的记忆。 */
  readonly about?: string
  /**
   * The project (DSH workspace) the waking rooms belong to; global memories
   * and matching project memories pass the filter.
   * 唤醒房间所属的项目（DSH 工作区）；全局记忆与项目匹配的记忆通过过滤。
   */
  readonly projectId?: string
  /** Maximum entries returned; default 40 per the design. */
  /** 返回条数上限；设计默认 40。 */
  readonly limit?: number
}

/** Construction options; store and clock are injectable for tests. */
/** 构造选项；存储与时钟可注入，供测试使用。 */
export interface ImMemoryOptions {
  readonly store: ImMemoryStore
  readonly now?: () => number
}

/** Default recall limit, per the design's memory query contract. */
/** 召回默认上限，取设计的记忆查询契约。 */
export const DEFAULT_RECALL_LIMIT = 40

/** The agent memory service. */
/** 智能体记忆服务。 */
export class ImMemory {
  private readonly now: () => number
  /**
   * @param options - the backing store and an optional clock.
   */
  constructor(private readonly options: ImMemoryOptions) {
    this.now = options.now ?? Date.now
  }

  /**
   * Write one memory. The write is an upsert on the row id, so callers that
   * hold an existing id update in place instead of cloning.
   * 写入一条记忆。写入是按行 id 的 upsert，持有既有 id 的调用方就地更新而不是克隆。
   */
  async remember(input: ImRememberInput, existingId?: string): Promise<ImMemoryRow> {
    const at = this.now()
    const existing = existingId === undefined ? undefined : this.options.store.getMemory(existingId)
    const row: ImMemoryRow = {
      id: existing?.id ?? `mem-${randomUUID()}`,
      agent_participant_id: input.agentParticipantId,
      kind: input.kind,
      body: input.body,
      pinned: input.pinned ?? false,
      created_at: existing?.created_at ?? at,
      updated_at: at,
      ...(input.about === undefined ? {} : { about: input.about }),
      ...(input.projectId === undefined ? {} : { project_id: input.projectId }),
      ...(input.roomId === undefined ? {} : { source_room_id: input.roomId }),
    }
    await this.options.store.putMemory(row)
    return row
  }

  /**
   * Recall the agent's memories: pinned first, then recency; global and
   * project-matching entries only. Never throws for an empty store — an
   * empty list is a valid answer.
   * 召回智能体的记忆：置顶优先，其余按近期；只含全局与项目匹配的条目。空存储不是错误
   * ——空列表是合法答案。
   */
  recall(query: ImRecallQuery): ImMemoryRow[] {
    const limit = query.limit ?? DEFAULT_RECALL_LIMIT
    const visible = this.options.store.memories().filter(row =>
      row.agent_participant_id === query.agentParticipantId
      && memoryVisibleInProject(row, query.projectId)
      && (query.about === undefined || row.about === query.about),
    )
    const ordered = [...visible].sort(compareForRecall)
    return ordered.slice(0, limit)
  }

  /** Drop one memory; dropping an unknown id is a no-op. */
  /** 删除一条记忆；删除不存在的 id 是无操作。 */
  async forget(id: string): Promise<void> {
    await this.options.store.deleteMemory(id)
  }
}

/** Global memories pass everywhere; project memories pass only in that project. */
/** 全局记忆处处可见；项目记忆只在该项目内可见。 */
function memoryVisibleInProject(row: ImMemoryRow, projectId: string | undefined): boolean {
  if (row.project_id === undefined) return true
  return row.project_id === projectId
}

/** Pinned entries first, then the most recently updated first. */
/** 置顶条目在前，其后按最近更新在前。 */
function compareForRecall(a: ImMemoryRow, b: ImMemoryRow): number {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
  return b.updated_at - a.updated_at
}

/** The memory service token. */
/** 记忆服务令牌。 */
export const ImMemoryToken = defineToken<ImMemory>('imMemory')
declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The agent memory service provided by @veren/im. */
    /** 由 @veren/im 提供的智能体记忆服务。 */
    imMemory: ImMemory
  }
}
