/**
 * 渲染层：canonical JSON + 节点构造器 + 字节稳定消息模板
 * Render layer: canonical JSON + node constructors + byte-stable message templates
 *
 * React "组件结构稳定、只 props 变" → 这里"消息模板字节稳定、只数据字面量变"。
 * canonical：对象键按字典序排列（与构造顺序无关），数组保持顺序。
 */
import type { Entity, PromptNode, Sync } from './types.ts'

/** 递归稳定序列化 / recursive stable stringify */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
}

// ---- 节点构造器 / node constructors ----

export const staticNode = (content: string): PromptNode => ({ kind: 'static', content })
export const fieldNode = (path: string, value: unknown): PromptNode => ({ kind: 'field', path, value })
export const keyedNode = (path: string, items: Entity[]): PromptNode => ({ kind: 'keyed', path, items })
export const logNode = (path: string, entries: unknown[]): PromptNode => ({ kind: 'log', path, entries })
export const groupNode = (path: string, children: PromptNode[]): PromptNode => ({ kind: 'group', path, children })

/** 把节点降为可嵌入 set op 的纯数据 / flatten a node to plain data for set ops */
export function nodeToValue(node: PromptNode): unknown {
  switch (node.kind) {
    case 'static': return node.content
    case 'field': return node.value
    case 'keyed': return node.items
    case 'log': return node.entries
    case 'group': return Object.fromEntries(node.children.map((child) => [child.kind === 'static' ? '' : child.path, nodeToValue(child)]))
  }
}

// ---- 字节稳定的消息模板 / byte-stable message templates ----

/**
 * 渲染同步消息（信封固定，仅数据字面量变）：
 *   PATCH vA->vB {"ops":[...]}
 *   SNAPSHOT vN {"nodes":[...]}
 */
export function renderSync(sync: Sync): string {
  if (sync.kind === 'patch') {
    return `PATCH v${sync.fromVersion}->v${sync.toVersion} {"ops":[${sync.ops.map(canonicalJson).join(',')}]}`
  }
  return `SNAPSHOT v${sync.version} {"nodes":[${sync.nodes.map(canonicalJson).join(',')}]}`
}

/** 渲染全量快照 / render a full snapshot */
export function renderSnapshot(snapshot: Extract<Sync, { kind: 'snapshot' }>): string {
  return renderSync(snapshot)
}
