/**
 * 类型定义（只放类型）/ Type definitions (types only)
 */

/** 任务条目 / Task item —— id 稳定（React key 思想） */
export interface TaskItem {
  id: string
  title: string
  status: 'open' | 'taken' | 'done'
  ownerId: string | null
}

/** 单个变更操作 / One change op */
export type Op =
  | { op: 'upsert'; item: TaskItem }
  | { op: 'remove'; id: string }

/** 增量补丁 / Delta patch */
export interface Patch {
  kind: 'patch'
  fromVersion: number
  toVersion: number
  ops: Op[]
}

/** 全量快照 / Full snapshot（正确性兜底） */
export interface Snapshot {
  kind: 'snapshot'
  version: number
  items: TaskItem[]
}

export type Sync = Patch | Snapshot

/** 工具执行结果 / Tool execution result（结构化错误：稳定 code） */
export type ToolOutcome =
  | { ok: true; detail: string }
  | { ok: false; code: string; detail: string }

/** 单次 LLM 调用的用量 / Usage of one LLM call */
export interface CallUsage {
  promptTokens: number
  completionTokens: number
  cacheHitTokens: number
  cacheMissTokens: number
}

/** 单轮的统计 / Per-round statistics */
export interface RoundStat {
  round: number
  /** 本轮上下文注入字节数（快照或补丁）/ bytes injected this round */
  injectedBytes: number
  calls: CallUsage[]
  /** 本轮工具调用是否全部成功 / all tool calls succeeded */
  toolCallsTotal: number
  toolCallsOk: number
  /** 指令是否最终完成（服务端状态验证）/ directive verified server-side */
  directiveOk: boolean
}

/** 一场基准的总统计 / Aggregate stats of one benchmark run */
export interface BenchReport {
  mode: 'full' | 'delta'
  rounds: number
  listSize: number
  roundStats: RoundStat[]
  totals: {
    promptTokens: number
    completionTokens: number
    cacheHitTokens: number
    llmCalls: number
    toolCallsTotal: number
    toolCallsOk: number
    directivesOk: number
  }
}
