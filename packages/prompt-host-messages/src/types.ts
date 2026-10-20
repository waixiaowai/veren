/**
 * 消息协议类型（宿主层私有：内核不知道这些存在）/ message protocol types (host-owned)
 */
import type { Entity } from '@veren/prompt-core'

export type { Entity }

/** 四种消息操作 / four message ops */
export type Op =
  | { op: 'set'; path: string; value: unknown }
  | { op: 'remove'; path: string }
  | { op: 'splice'; path: string; id: string; entity?: unknown }
  | { op: 'append'; path: string; entries: unknown[] }

/** 增量补丁 / delta patch */
export interface Patch {
  kind: 'patch'
  fromVersion: number
  toVersion: number
  ops: Op[]
}

/** 全量快照节点（静态块 / keyed 集合 / data 字段）/ snapshot node */
export type SnapshotNode =
  | { kind: 'static'; content: string }
  | { kind: 'keyed'; path: string; items: unknown[] }
  | { kind: 'data'; path: string; value: unknown }

/** 全量快照 / full snapshot */
export interface Snapshot {
  kind: 'snapshot'
  version: number
  nodes: SnapshotNode[]
}

export type Sync = Patch | Snapshot
