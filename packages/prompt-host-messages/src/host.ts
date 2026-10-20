/**
 * MessageHost：append-only 消息日志宿主 + 字节稳定渲染
 * MessageHost: append-only message-log host + byte-stable rendering
 *
 * LLM 特有策略全在这层（内核不知道）：
 * - placement/update → 结构化 op 进缓冲；flush 合批并推进版本
 * - update 的物理不可实现（历史不可改）→ 策略化为“下一次补丁以新值重申”（splice/set 天然幂等）
 * - deletion → splice 无 entity / remove op；集合状态同步剔除
 * - renderSince(cursor)：增量优先；无基线/缺口过大/游标超前 → 全量快照
 */
import { canonicalJson } from '@veren/prompt-core'
import type { HostInstance, PromptHost } from '@veren/prompt-core'
import type { Op, SnapshotNode, Sync } from './types.ts'

interface Commit {
  version: number
  ops: Op[]
}

/** 渲染同步消息（信封固定，仅数据字面量变）/ render one sync message (fixed envelope) */
export function renderSync(sync: Sync): string {
  if (sync.kind === 'patch') {
    return `PATCH v${sync.fromVersion}->v${sync.toVersion} {"ops":[${sync.ops.map(canonicalJson).join(',')}]}`
  }
  return `SNAPSHOT v${sync.version} {"nodes":[${sync.nodes.map(canonicalJson).join(',')}]}`
}

export interface MessageHostOptions {
  /** 版本缺口超过该值回落全量 / snapshot fallback beyond this gap */
  maxPatchGap?: number
  /** 补丁链达该长度自动压实 / auto-anchor after this many commits */
  compactEvery?: number
}

export class MessageHost implements PromptHost {
  private version = 0
  private anchorVersion = 0
  private commits: Commit[] = []
  private staged: Op[] = []
  private readonly statics: string[] = []
  private readonly collections = new Map<string, Map<string, unknown>>()
  private readonly fields = new Map<string, unknown>()
  private readonly maxPatchGap: number
  private readonly compactEvery: number

  constructor(options: MessageHostOptions = {}) {
    this.maxPatchGap = options.maxPatchGap ?? 20
    this.compactEvery = options.compactEvery ?? 50
  }

  get currentVersion(): number {
    return this.version
  }

  /** placement：新块进入日志 / placement: block enters the log */
  append(instance: HostInstance): void {
    this.absorb(instance)
  }

  /** update：历史不可改 → 以新值重申（幂等）/ update: restate with the new value */
  revise(_prev: HostInstance, next: HostInstance): void {
    this.absorb(next)
  }

  /** deletion：从集合状态剔除并产出删除 op / evict from collection state */
  evict(instance: HostInstance): void {
    const op = this.toOp('deletion', instance)
    if (op !== null) this.staged.push(op)
  }

  /** flush：合批边界，推进版本 / batch boundary; bump version */
  flush(): void {
    if (this.staged.length === 0) return
    this.version += 1
    this.commits.push({ version: this.version, ops: this.staged })
    this.staged = []
    if (this.commits.length >= this.compactEvery) this.anchor()
  }

  /**
   * 同步读取：增量优先，无基线/缺口过大/游标超前回落全量快照。
   * Delta-first sync with snapshot fallback.
   */
  renderSince(cursor?: number): Sync {
    if (cursor === undefined || cursor < this.anchorVersion || cursor > this.version
      || this.version - cursor > this.maxPatchGap) {
      return { kind: 'snapshot', version: this.version, nodes: this.snapshotNodes() }
    }
    const ops = this.commits
      .filter((commit) => commit.version > cursor)
      .flatMap((commit) => commit.ops)
    return { kind: 'patch', fromVersion: cursor, toVersion: this.version, ops }
  }

  /** 日志统计（compact 策略的输入）/ log stats (input for the compaction policy) */
  logStats(): { entries: number; approxTokens: number; versionsSinceAnchor: number } {
    const ops = this.commits.flatMap((commit) => commit.ops)
    return {
      entries: ops.length + this.staged.length,
      approxTokens: Math.ceil(Buffer.byteLength(canonicalJson(ops)) / 3),
      versionsSinceAnchor: this.commits.length,
    }
  }

  /** 压实：清空补丁链 / drop the patch chain */
  anchor(): void {
    this.anchorVersion = this.version
    this.commits = []
  }

  /** 静态块登记或产出结构化 op；同步维护集合状态 / register static or stage an op */
  private absorb(instance: HostInstance): void {
    if (instance.kind === 'static') {
      const content = String(instance.props.content ?? '')
      if (!this.statics.includes(content)) this.statics.push(content)
      return
    }
    const op = this.toOp('upsert', instance)
    if (op !== null) this.staged.push(op)
  }

  /** instance → op，并镜像维护集合状态 / map instance to op and mirror collection state */
  private toOp(tag: 'upsert' | 'deletion', instance: HostInstance): Op | null {
    const path = String(instance.props.path ?? '')
    if (instance.kind === 'item') {
      const bucket = this.bucket(path)
      if (tag === 'deletion') {
        bucket.delete(String(instance.key))
        return { op: 'splice', path, id: String(instance.key) }
      }
      bucket.set(String(instance.key), instance.props.value)
      return { op: 'splice', path, id: String(instance.key), entity: instance.props.value }
    }
    if (instance.kind === 'data') {
      if (tag === 'deletion') {
        this.fields.delete(path)
        return { op: 'remove', path }
      }
      this.fields.set(path, instance.props.value)
      return { op: 'set', path, value: instance.props.value }
    }
    return null // 未知块类型：宿主忽略（策略位）
  }

  private bucket(path: string): Map<string, unknown> {
    let bucket = this.collections.get(path)
    if (bucket === undefined) {
      bucket = new Map()
      this.collections.set(path, bucket)
    }
    return bucket
  }

  /** 从镜像状态重建快照树 / rebuild snapshot nodes from mirrored state */
  private snapshotNodes(): SnapshotNode[] {
    const nodes: SnapshotNode[] = this.statics.map((content) => ({ kind: 'static', content }))
    for (const [path, value] of this.fields) {
      nodes.push({ kind: 'data', path, value })
    }
    for (const [path, bucket] of this.collections) {
      nodes.push({ kind: 'keyed', path, items: [...bucket.values()] })
    }
    return nodes
  }
}
