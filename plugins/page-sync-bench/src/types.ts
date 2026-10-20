/**
 * 类型定义（只放类型）/ Type definitions (types only)
 *
 * 同步协议类型统一来自 @veren/page-sync-core；这里只保留基准自身的领域类型。
 * Sync protocol types come from @veren/page-sync-core; only bench-domain types live here.
 */
export * from '@veren/page-sync-core'
import type { Entity } from '@veren/page-sync-core'

/** 任务条目 / Task item —— id 稳定（React key 思想）*/
export interface TaskItem extends Entity {
  title: string
  status: 'open' | 'taken' | 'done'
  ownerId: string | null
}

/** 工具执行结果 / Tool execution result（结构化错误：稳定 code）*/
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
  toolCallsTotal: number
  toolCallsOk: number
  /** 指令是否最终完成（服务端验证）/ directive verified server-side */
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
