/**
 * 调度器：两阶段提交 + lane + 外部 store 绑定 / two-phase schedule + lanes + store binding
 *
 * render 阶段（reconcile）纯函数、可丢弃；commit 阶段原子地交给宿主并 flush。
 * background lane 的 effect 先入 pending 缓冲，随下一次 sync commit 一并落盘。
 */
import type { Effect, ExternalStore, Fiber, Lane, PromptElement, PromptHost } from './types.ts'
import { reconcileChildren } from './reconciler.ts'

export interface PromptRoot {
  readonly host: PromptHost
  current: Fiber | null
  pending: Effect[]
}

/** 创建根 / create a root bound to a host */
export function createRoot(host: PromptHost): PromptRoot {
  return { host, current: null, pending: [] }
}

/** 渲染一帧：elements 是页面组件树的顶层 / render one frame from top-level elements */
export function scheduleRender(root: PromptRoot, elements: PromptElement[], lane: Lane = 'sync'): void {
  const rootFiber: Fiber = { type: '⌂root', tag: 'component', props: {}, child: null, sibling: null, parent: null }
  const effects: Effect[] = []
  rootFiber.child = reconcileChildren(rootFiber, root.current?.child ?? null, elements, lane, effects)
  root.current = rootFiber

  if (lane === 'background') {
    root.pending.push(...effects)
    return
  }
  const batch = [...root.pending, ...effects]
  root.pending = []
  commitEffects(root.host, batch)
}

/** 手动冲洗 background 缓冲 / flush buffered background effects */
export function flushBackground(root: PromptRoot): void {
  if (root.pending.length === 0) return
  const batch = root.pending
  root.pending = []
  commitEffects(root.host, batch)
}

/** commit 阶段：唯一副作用出口，收尾调 host.flush / commit: the only side-effect exit */
export function commitEffects(host: PromptHost, batch: Effect[]): void {
  for (const effect of batch) {
    if (effect.tag === 'placement') host.append(effect.instance)
    else if (effect.tag === 'update') host.revise !== undefined ? host.revise(effect.prevInstance!, effect.instance) : host.append(effect.instance)
    else host.evict?.(effect.instance)
  }
  host.flush?.()
}

/**
 * 绑定外部权威 store（useSyncExternalStore 对应物）：状态变化 → 重渲染 → 提交。
 * Bind an external authoritative store: state change → re-render → commit.
 */
export function bindStore<S>(
  root: PromptRoot,
  store: ExternalStore<S>,
  mapState: (state: S) => PromptElement[],
  toLane?: (state: S) => Lane,
): () => void {
  const render = (): void => {
    const state = store.getState()
    scheduleRender(root, mapState(state), toLane?.(state) ?? 'sync')
  }
  return store.subscribe(render)
}
