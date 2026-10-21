/**
 * Element 层：createElement / memo / canonical 相等性
 * Element layer: createElement / memo / canonical equality
 *
 * canonical：对象键字典序序列化 —— 相等性判定与构造顺序无关（模板稳定的根基）。
 */
import type { Component, HostKind, Key, PromptElement } from './types.ts'

/** 递归稳定序列化 / recursive stable stringify（键字典序，数组保序）*/
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
}

/**
 * 创建元素。key 从 props 中提取（React 惯例）；对象冻结（不可变纪律）。
 * Create an element; `key` is lifted out of props; frozen for immutability discipline.
 */
export function createElement<P extends Record<string, unknown>>(
  type: Component<P> | HostKind,
  props?: P & { key?: Key },
): PromptElement {
  const { key, ...rest } = props ?? {}
  return Object.freeze({
    type,
    ...(key === undefined ? {} : { key }),
    props: Object.freeze(rest) as Record<string, unknown>,
  }) as unknown as PromptElement
}

/**
 * memo：props 相等（默认 canonical）→ 整棵子树 bail out，零 effect。
 * memo: equal props (canonical by default) → whole subtree bailout, zero effects.
 */
export function memo<P extends Record<string, unknown>>(
  component: Component<P>,
  areEqual?: (a: P, b: P) => boolean,
): Component<P> {
  const wrapped = ((props: P, ctx?: unknown) => component(props, ctx)) as Component<P>
  wrapped.__memoCompare = areEqual === undefined
    ? (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b)
    : (a: unknown, b: unknown) => areEqual(a as P, b as P)
  return wrapped
}
