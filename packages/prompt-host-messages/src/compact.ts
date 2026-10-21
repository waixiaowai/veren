/**
 * 上下文预算 GC / context budget GC
 *
 * 历史只追加 → “压实”的物理形态 = 开新页面会话（remount）：
 * anchor 宿主清空补丁链，用全量快照作为新会话的基线（代价一次缓存 miss，换回干净前缀）。
 */
import { renderSync } from './host.ts'
import type { MessageHost } from './host.ts'
import { planMessages, toChatMessages } from './cache.ts'
import type { CachePolicy, ContextBlock } from './cache.ts'

export interface LogStats {
  readonly entries: number
  readonly approxTokens: number
  readonly versionsSinceAnchor: number
}

export interface CompactionOptions {
  /** 补丁条数上限 / max staged+committed op count */
  maxEntries?: number
  /** 近似 token 上限 / approximate token ceiling */
  maxApproxTokens?: number
}

/** 预算策略：任一阈值触顶即需要 remount / threshold policy for remounting */
export function tokenBudgetPolicy(options: CompactionOptions = {}) {
  const maxEntries = options.maxEntries ?? 200
  const maxApproxTokens = options.maxApproxTokens ?? 200_000
  return {
    shouldCompact(stats: LogStats): boolean {
      return stats.entries >= maxEntries || stats.approxTokens >= maxApproxTokens
    },
  }
}

/** 粗估：中英混排按 ~3 字节/token / rough estimate: ~3 bytes per token */
export function estimateTokens(text: string): number {
  return Math.ceil(Buffer.byteLength(text) / 3)
}

/**
 * remount：anchor 宿主并产出新会话的基线快照文本（第一条注入消息）。
 * Remount: anchor the host and emit the fresh baseline snapshot for a new session.
 */
export function remount(host: MessageHost): { version: number; snapshotText: string } {
  host.anchor()
  const sync = host.renderSince(undefined)
  return { version: host.currentVersion, snapshotText: renderSync(sync) }
}

/** 一次注入的装配产物 / one assembled injection */
export interface AssembledSync {
  /** 本轮是否触发了预算 remount / whether this turn remounted on budget */
  readonly remounted: boolean
  /** 增量为空补丁（消费方可整轮跳过）/ the delta is an empty patch (the caller may skip the turn) */
  readonly empty: boolean
  /** 按策略规划的上下文块（含断点标记）/ policy-planned context blocks (breakpoints included) */
  readonly blocks: ContextBlock[]
  /** 去 provider 内部字段的 chat 消息 / plain chat messages */
  readonly chat: { role: ContextBlock['role']; content: string }[]
  /** 注入文本（renderSync / remount 快照的输出）/ the injected text (renderSync / remount snapshot output) */
  readonly text: string
}

export interface SyncAssemblerOptions {
  /** 消息宿主（游标与 logStats 的来源）/ the message host (cursor and logStats source) */
  readonly host: MessageHost
  /** 缓存策略（policyFor(provider) 的产物）/ the cache policy (from policyFor(provider)) */
  readonly policy: CachePolicy
  /**
   * 系统提示词；DSH 链路上系统提示归平台（persona 段），传 '' 即可——
   * 消费方只取 text 时块面不参与请求。
   * System prompt; on the DSH chain the platform owns it (persona sections),
   * so pass '' — the block face is unused when the caller only consumes text.
   */
  readonly systemPrompt?: string
  /** 预算阈值（缺省 tokenBudgetPolicy 的默认值）/ budget thresholds (tokenBudgetPolicy defaults) */
  readonly budget?: CompactionOptions
}

/**
 * 有状态的注入装配器：这就是策略层的接线原语——
 * - 预算：logStats 触顶 → remount（anchor + 全量快照基线，既有意图见上）；
 * - 游标：内部推进，增量补丁优先；
 * - 断点：按 provider 策略 planMessages 规划（消费方要么发整个块面，要么只取 text）。
 * The stateful injection assembler: the wiring primitive of the policy layer —
 * - budget: logStats over the ceiling → remount (anchor + snapshot baseline,
 *   the pre-existing intent above);
 * - cursor: advanced internally, delta patches first;
 * - breakpoints: planned per provider via planMessages (callers either send the
 *   whole block face or consume text only).
 */
export function createSyncAssembler(options: SyncAssemblerOptions): { assemble(): AssembledSync } {
  const budgetPolicy = tokenBudgetPolicy(options.budget)
  const systemPrompt = options.systemPrompt ?? ''
  let cursor: number | undefined
  return {
    assemble(): AssembledSync {
      let text: string
      let empty = false
      let didRemount = false
      if (budgetPolicy.shouldCompact(options.host.logStats())) {
        const fresh = remount(options.host)
        cursor = fresh.version
        text = fresh.snapshotText
        didRemount = true
      } else {
        const sync = options.host.renderSince(cursor)
        cursor = options.host.currentVersion
        text = renderSync(sync)
        empty = sync.kind === 'patch' && sync.ops.length === 0
      }
      const blocks = planMessages(options.policy, systemPrompt, [{ role: 'user', content: text }])
      return { remounted: didRemount, empty, blocks, chat: toChatMessages(blocks), text }
    },
  }
}
