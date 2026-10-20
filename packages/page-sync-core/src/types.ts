/**
 * 类型定义（只放类型）/ Type definitions (types only)
 *
 * Virtual Prompt Tree：React VDOM 的 prompt 等价物。
 * render(模板, state) → 树 → diff(prev, next) → ops → 字节稳定渲染 → append 上下文。
 */

/** 实体铁律：id 稳定（React key 思想）/ Entity rule: stable id (React key) */
export interface Entity {
  id: string
}

/**
 * 虚拟 prompt 树节点。五种节点覆盖全部页面原型：
 * - static：永不参与 diff（memo：一次渲染终身复用）
 * - field：叶子数据，不等则一个 set op（React props update）
 * - keyed：keyed 集合，key-diff → splice op（React keyed children）
 * - log：append-only 日志，新条目直接追加，无 diff（聊天/事件流）
 * - group：分支节点，递归 diff，引用相等整棵 bail out（React memo）
 */
export type PromptNode =
  | { kind: 'static'; content: string }
  | { kind: 'field'; path: string; value: unknown }
  | { kind: 'keyed'; path: string; items: Entity[] }
  | { kind: 'log'; path: string; entries: unknown[] }
  | { kind: 'group'; path: string; children: PromptNode[] }

/**
 * 变更操作。三种语义覆盖全部原型：
 * - set：路径子树更新（字段/类型变更即整体替换，React "type 变更销毁重建"）
 * - remove：子树删除
 * - splice：keyed 集合变更（带 entity = upsert，不带 = remove）
 * - append：log 追加（天然增量，不 diff）
 */
export type Op =
  | { op: 'set'; path: string; value: unknown }
  | { op: 'remove'; path: string }
  | { op: 'splice'; path: string; id: string; entity?: Entity }
  | { op: 'append'; path: string; entries: unknown[] }

/** 增量补丁 / Delta patch */
export interface Patch {
  kind: 'patch'
  fromVersion: number
  toVersion: number
  ops: Op[]
}

/** 全量快照（正确性兜底）/ Full snapshot (correctness fallback) */
export interface Snapshot {
  kind: 'snapshot'
  version: number
  nodes: PromptNode[]
}

export type Sync = Patch | Snapshot

/** 调度优先级（React lane）/ Scheduling priority (React lanes) */
export type Lane = 'interactive' | 'background'
