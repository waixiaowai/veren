/**
 * 内置块组件：页面 TSX 的宿主块词汇 / built-in block components: the host-block vocabulary
 *
 * 对应 MessageHost 的三种块：static（memo 永不 diff）/ item（keyed 集合行）/ data（字段）。
 * 页面 TSX 只用这些组件描述树，diff 由内核完成。
 */
import { createElement } from '@veren/prompt-core'
import type { PromptElement } from '@veren/prompt-core'

/** 静态块：一次渲染终身复用（永不进补丁）/ static block: never diffed */
export function Static(props: { content: string }): PromptElement[] {
  return [createElement('static', { content: props.content })]
}

/** 字段块：值变化 → 一个 set op / data block: value change → one set op */
export function Data(props: { path: string; value: unknown }): PromptElement[] {
  return [createElement('data', { path: props.path, value: props.value })]
}

/** keyed 集合块：按 id 对位，变化 → splice op / keyed collection: keyed by id */
export function Keyed<T extends { id: string }>(props: { path: string; items: readonly T[] }): PromptElement[] {
  return props.items.map((item) => createElement('item', { key: item.id, path: props.path, value: item }))
}
