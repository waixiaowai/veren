/**
 * 上下文预算 GC / context budget GC
 *
 * 历史只追加 → “压实”的物理形态 = 开新页面会话（remount）：
 * anchor 宿主清空补丁链，用全量快照作为新会话的基线（代价一次缓存 miss，换回干净前缀）。
 */
import { renderSync } from './host.ts'
import type { MessageHost } from './host.ts'

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
