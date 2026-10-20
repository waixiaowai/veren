/**
 * diff：结构感知的树比对 / structural tree diff
 *
 * React fiber 规则的移植：同类型节点比数据（props update），
 * 数组子节点按 key 对位（keyed children），类型变更即整体替换（销毁重建）。
 * 引用相等 → 整棵 bail out（React memo），零 op。
 */
import type { Entity, Op, PromptNode } from './types.ts'
import { canonicalJson, nodeToValue } from './render.ts'

/** keyed 集合 diff：稳定 id 查表，O(n)（列表页特例）/ keyed list diff */
export function diffKeyed(path: string, prev: Entity[], next: Entity[]): Op[] {
  const prevMap = new Map(prev.map((item) => [item.id, item]))
  const nextIds = new Set(next.map((item) => item.id))
  const ops: Op[] = []
  for (const item of next) {
    const old = prevMap.get(item.id)
    if (!old || canonicalJson(old) !== canonicalJson(item)) {
      ops.push({ op: 'splice', path, id: item.id, entity: item })
    }
  }
  for (const [id] of prevMap) {
    if (!nextIds.has(id)) ops.push({ op: 'splice', path, id })
  }
  return ops
}

/** log 前缀是否一致（append-only 假设）/ whether the log prefix is intact */
function samePrefix(prev: unknown[], next: unknown[]): boolean {
  for (let i = 0; i < prev.length; i++) {
    if (canonicalJson(prev[i]) !== canonicalJson(next[i])) return false
  }
  return true
}

/** 单节点 diff / diff one node */
export function diffNodes(prev: PromptNode | undefined, next: PromptNode): Op[] {
  if (next.kind === 'static') return []            // memo：静态节点永不进补丁
  if (prev === next) return []                      // bail out：引用相等整棵跳过
  if (prev === undefined || prev.kind !== next.kind) {
    return [{ op: 'set', path: next.path, value: nodeToValue(next) }] // 类型变更：销毁重建
  }
  if (prev.kind === 'field' && next.kind === 'field') {
    return canonicalJson(prev.value) !== canonicalJson(next.value)
      ? [{ op: 'set', path: next.path, value: next.value }]
      : []
  }
  if (prev.kind === 'keyed' && next.kind === 'keyed') {
    return diffKeyed(next.path, prev.items, next.items)
  }
  if (prev.kind === 'log' && next.kind === 'log') {
    if (next.entries.length >= prev.entries.length && samePrefix(prev.entries, next.entries)) {
      return next.entries.length === prev.entries.length
        ? []
        : [{ op: 'append', path: next.path, entries: next.entries.slice(prev.entries.length) }]
    }
    return [{ op: 'set', path: next.path, value: next.entries }] // 前缀断裂：整体替换
  }
  return diffGroup(prev as GroupNode, next as GroupNode)
}

type GroupNode = Extract<PromptNode, { kind: 'group' }>

/** static 节点没有 path / static nodes carry no path */
function pathOf(node: PromptNode): string {
  return node.kind === 'static' ? '' : node.path
}

/** group 递归 diff：按 path 对位子节点 / recurse group children by path */
function diffGroup(prev: GroupNode, next: GroupNode): Op[] {
  const prevMap = new Map(prev.children.map((child) => [pathOf(child), child]))
  const nextPaths = new Set(next.children.map((child) => pathOf(child)))
  const ops: Op[] = []
  for (const child of next.children) ops.push(...diffNodes(prevMap.get(pathOf(child)), child))
  for (const [path] of prevMap) {
    if (!nextPaths.has(path)) ops.push({ op: 'remove', path })
  }
  return ops
}
