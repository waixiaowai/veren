/**
 * Reconciler：fiber diff（React 规则的移植）/ fiber diffing (React rules)
 *
 * - 同位同型 → 比较内容（update）；异型 → 卸载重建（placement + deletion）
 * - 带 key 的元素按 key 跨位对位（keyed children diff）
 * - memo 组件 props 相等 → 整棵子树 bail out，零 effect
 * - render 阶段纯函数：只产出 effect list，不触碰宿主
 */
import { canonicalJson } from './element.ts'
import type { Component, Effect, Fiber, HostInstance, Lane, PromptElement } from './types.ts'

function sameType(fiber: Fiber, element: PromptElement): boolean {
  return fiber.type === element.type
}

/** 顶层 children 对账 / reconcile one children list */
export function reconcileChildren(
  parent: Fiber,
  altChild: Fiber | null,
  elements: PromptElement[],
  lane: Lane,
  effects: Effect[],
): Fiber | null {
  const altByKey = new Map<string, Fiber>()
  const altList: Fiber[] = []
  for (let fiber = altChild; fiber !== null; fiber = fiber.sibling) {
    if (fiber.key === undefined) altList.push(fiber)
    else altByKey.set(fiber.key, fiber)
  }
  const claimed = new Set<Fiber>()
  let altIndex = 0
  let prev: Fiber | null = null
  let first: Fiber | null = null

  for (const element of elements) {
    let alt = element.key !== undefined ? altByKey.get(element.key) : altList[altIndex]
    if (alt !== undefined && !sameType(alt, element)) alt = undefined
    if (element.key === undefined) altIndex++
    if (alt !== undefined) claimed.add(alt)

    const fiber = beginWork(element, alt, lane, effects)
    fiber.parent = parent
    if (prev === null) first = fiber
    else prev.sibling = fiber
    prev = fiber
  }

  for (let fiber = altChild; fiber !== null; fiber = fiber.sibling) {
    if (!claimed.has(fiber)) collectDeletion(fiber, lane, effects)
  }
  return first
}

/** 单元素入口：组件递归展开 / host 产出实例与 effect / begin one element */
function beginWork(element: PromptElement, alt: Fiber | undefined, lane: Lane, effects: Effect[]): Fiber {
  if (typeof element.type === 'function') {
    const component = element.type as Component
    if (alt !== undefined && alt.type === component && component.__memoCompare?.(alt.props, element.props)) {
      return cloneSubtree(alt, null) // memo bailout：整棵复用，零 effect
    }
    const fiber: Fiber = { type: element.type, key: element.key, props: element.props, tag: 'component', child: null, sibling: null, parent: null }
    fiber.child = reconcileChildren(fiber, alt?.child ?? null, component(element.props), lane, effects)
    return fiber
  }

  const instance: HostInstance = { kind: element.type as string, key: element.key, props: element.props }
  const fiber: Fiber = { type: element.type, key: element.key, props: element.props, tag: 'host', child: null, sibling: null, parent: null, instance }
  if (alt === undefined || alt.instance === undefined) {
    effects.push({ tag: 'placement', instance, lane })
  } else if (canonicalJson(alt.props) !== canonicalJson(element.props)) {
    effects.push({ tag: 'update', instance, prevInstance: alt.instance, lane })
  }
  return fiber
}

/** memo bailout：按旧子树原样克隆（实例与结构不动）/ clone the alternate subtree verbatim */
function cloneSubtree(fiber: Fiber, parent: Fiber | null): Fiber {
  const copy: Fiber = { ...fiber, parent, child: null, sibling: null }
  if (fiber.child !== null) copy.child = cloneChildren(fiber.child, copy)
  return copy
}

function cloneChildren(first: Fiber, parent: Fiber | null): Fiber | null {
  let head: Fiber | null = null
  let prev: Fiber | null = null
  for (let fiber: Fiber | null = first; fiber !== null; fiber = fiber.sibling) {
    const copy = cloneSubtree(fiber, parent)
    if (prev === null) head = copy
    else prev.sibling = copy
    prev = copy
  }
  return head
}

/** 删除：收集子树内全部宿主实例 / collect every host instance in the subtree */
function collectDeletion(fiber: Fiber, lane: Lane, effects: Effect[]): void {
  if (fiber.tag === 'host' && fiber.instance !== undefined) {
    effects.push({ tag: 'deletion', instance: fiber.instance, lane })
  }
  for (let child = fiber.child; child !== null; child = child.sibling) {
    collectDeletion(child, lane, effects)
  }
}
