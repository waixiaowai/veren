/**
 * PageStore：版本化提交日志 + 同步协议 / versioned commit log + sync protocol
 *
 * React commit 的对应物：render/diff 是纯函数（便宜、可重算），
 * commit 是唯一副作用 —— 合批、版本号 +1、追加日志。
 * sync：增量优先（优化路径）；无基线 / 缺口过大 / 游标超前 → 全量快照（正确性路径）。
 */
import type { Lane, Op, PromptNode, Sync } from './types.ts'
import { diffNodes } from './diff.ts'

export interface StoreOptions {
  /** 版本缺口超过该值回落全量 / fall back to snapshot beyond this gap */
  maxPatchGap?: number
  /** 补丁链达该长度自动压实 / auto-anchor after this many commits */
  compactEvery?: number
}

interface Commit {
  version: number
  ops: Op[]
}

export class PageStore {
  private nodes: PromptNode[]
  private version = 0
  private anchorVersion = 0
  private commits: Commit[] = []
  private staged: Op[] = []
  private readonly maxPatchGap: number
  private readonly compactEvery: number

  constructor(nodes: PromptNode[] = [], options: StoreOptions = {}) {
    this.nodes = nodes
    this.maxPatchGap = options.maxPatchGap ?? 20
    this.compactEvery = options.compactEvery ?? 50
  }

  get currentVersion(): number {
    return this.version
  }

  /**
   * render + diff + commit 一体：传入新树，返回本轮产生的 ops（空数组 = 无变化不推进版本）。
   * One call: render+diff+commit. Returns the ops emitted (empty = no version bump).
   */
  update(next: PromptNode[]): Op[] {
    const ops: Op[] = []
    const len = Math.max(this.nodes.length, next.length)
    for (let i = 0; i < len; i++) ops.push(...diffNodes(this.nodes[i], next[i]))
    if (ops.length === 0) return ops
    this.nodes = next
    this.version += 1
    this.commits.push({ version: this.version, ops })
    if (this.commits.length >= this.compactEvery) this.anchor()
    return ops
  }

  /** 低优变更暂存（background lane），flush 时一次性合批 / stage background ops */
  stage(ops: Op[]): void {
    this.staged.push(...ops)
  }

  /** 冲洗暂存区：有暂存才推进版本（lane 思想）/ flush staged ops as one commit */
  flush(): Op[] {
    if (this.staged.length === 0) return []
    const ops = this.staged
    this.staged = []
    this.version += 1
    this.commits.push({ version: this.version, ops })
    if (this.commits.length >= this.compactEvery) this.anchor()
    return ops
  }

  /**
   * 同步：增量优先，兜底全量 / prefer delta, fall back to snapshot
   */
  sync(cursor?: number): Sync {
    if (cursor === undefined || cursor < this.anchorVersion || cursor > this.version
      || this.version - cursor > this.maxPatchGap) {
      return { kind: 'snapshot', version: this.version, nodes: this.nodes }
    }
    const ops = this.commits
      .filter((commit) => commit.version > cursor)
      .flatMap((commit) => commit.ops)
    return { kind: 'patch', fromVersion: cursor, toVersion: this.version, ops }
  }

  /** 压实：清空补丁链（当前树已在手，历史不重放）/ anchor: drop the patch chain */
  anchor(): void {
    this.anchorVersion = this.version
    this.commits = []
  }
}
