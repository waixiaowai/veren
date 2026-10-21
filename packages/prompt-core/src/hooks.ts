/**
 * hooks：函数组件的持久槽位（React 规则的最小移植）。
 * Hooks: persistent slots for function components (a minimal port of the React rules).
 *
 * - 槽位按调用序索引、跨渲染持久（数组原地复用）；重渲出现新槽位 = 调用序被
 *   打破，fail loud（C6 的运行期守卫）；
 * - `useState` 的 dispatch 经创建时捕获的 root.refresh 通道触发重渲（mount 侧
 *   负责把 refresh 接到"重跑树"上）；
 * - `useSlot` 是原始持久槽位：prompt-page 的 `ctx.effect`/`ctx.on` render 期
 *   记账面（RFC §5.3）在它之上实现——一次运行、随会话清理；
 * - 渲染可嵌套（组件的 children 在父 beginWork 栈内渲染），作用域走栈保存恢复。
 * - Slots are call-order indexed and persistent (the array is reused in place);
 *   a new slot appearing on a re-render means broken call order — fail loud
 *   (C6's runtime guard).
 * - `useState`'s dispatch schedules a re-render via the root.refresh channel
 *   captured at creation (the mount side wires refresh to "re-run the tree").
 * - `useSlot` is the raw persistent slot: prompt-page's render-time
 *   `ctx.effect`/`ctx.on` recording face (RFC §5.3) builds on it — run once,
 *   cleaned up with the session.
 * - Renders nest (a component's children render inside the parent's beginWork
 *   stack), so scopes are saved/restored on a stack.
 * @module @veren/prompt-core/hooks
 */
import type { HookCell, PromptRoot } from './types.ts'

/** hook 作用域：root（dispatch 通道）+ 本组件的槽位数组 + 调用序游标
 * / one hook scope: the root (dispatch channel) + this component's cell array + the call-order cursor */
interface HookScope {
  root: PromptRoot | null
  cells: HookCell[]
  index: number
}

/** 作用域栈（渲染可嵌套，保存恢复）/ the scope stack (renders nest; save & restore) */
const stack: HookScope[] = []

/**
 * 在给定槽位数组上渲染 fn：槽位跨渲染持久（数组原地复用）。两种所有者：
 * - reconciler 传组件 fiber 的槽位（嵌套组件）；
 * - 页面适配器传自有数组（页级组件在 reconcile 之外渲染，RFC §3.5）。
 * Render fn over the given persistent cells (the array is reused in place). Two
 * owners: the reconciler passes a component fiber's cells (nested components);
 * the page adapter passes its own array (the page-level component renders
 * outside reconcile, RFC §3.5).
 */
export function runWithHookScope<T>(root: PromptRoot | null, cells: HookCell[], fn: () => T): T {
  stack.push({ root, cells, index: 0 })
  try {
    return fn()
  } finally {
    ;(cells as HookCellArray).mounted = true
    stack.pop()
  }
}

/** 当前作用域；无 = 在渲染外调用 hooks（调用序违规的运行期信号，fail loud）
 * / the current scope; null = hooks called outside a render (a rules-of-hooks violation signal, fail loud) */
function currentScope(): HookScope {
  const scope = stack[stack.length - 1]
  if (scope === undefined) {
    throw new Error(
      '[prompt-core] hooks called outside a component render; hook calls must be unconditional and ordered (rules of hooks)',
    )
  }
  return scope
}

/** 取下一个槽位：复用既有的；重渲出现新槽位或种类变化 = 调用序被打破，fail loud
 * / take the next cell: reuse an existing one; a new cell or a kind change on a re-render means broken call order — fail loud */
function nextCell(kind: HookCell['kind'], create: (root: PromptRoot | null) => HookCell): HookCell {
  const scope = currentScope()
  const index = scope.index++
  const existing = scope.cells[index]
  if (existing !== undefined) {
    if (existing.kind !== kind) {
      throw new Error(
        `[prompt-core] hook order changed: slot ${index} was "${existing.kind}", now "${kind}" (rules of hooks)`,
      )
    }
    return existing
  }
  if ((scope.cells as HookCellArray).mounted) {
    throw new Error(
      `[prompt-core] a new hook slot appeared on a re-render (slot ${index}); hook calls must be unconditional and ordered (rules of hooks)`,
    )
  }
  const cell = create(scope.root)
  scope.cells[index] = cell
  return cell
}

/** 首帧渲染完成标记（此后新增槽位即违规）/ set after the first render completes (any later new slot is a violation) */
interface HookCellArray extends Array<HookCell> {
  mounted?: boolean
}

/**
 * useState：组件本地状态。定位 = 取数缓存与视图状态（RFC §5.2）——不承载事实。
 * dispatch 走创建时捕获的 root.refresh 通道触发重渲；值不变（Object.is）零开销。
 * useState: component-local state. Positioned as fetch cache / view state (RFC
 * §5.2) — never a source of fact. dispatch schedules via the root.refresh
 * channel captured at creation; an unchanged value (Object.is) is a no-op.
 */
export function useState<T>(initial: T | (() => T)): [T, (next: T | ((prev: T) => T)) => void] {
  const cell = nextCell('state', (root) => ({
    kind: 'state',
    value: typeof initial === 'function' ? (initial as () => T)() : initial,
    root,
  }))
  const set = (next: T | ((prev: T) => T)): void => {
    const value = typeof next === 'function' ? (next as (prev: T) => T)(cell.value as T) : next
    if (Object.is(value, cell.value)) return
    cell.value = value
    ;(cell.root as { refresh?: () => void } | null)?.refresh?.()
  }
  return [cell.value as T, set]
}

/**
 * useMemo：纯派生；deps 以稳定序列化比较（undefined 归一为 null，保持指纹稳定）。
 * useMemo: pure derivation; deps compared by a stable serialization (undefined normalized to null for stable fingerprints).
 */
export function useMemo<T>(compute: () => T, deps: readonly unknown[]): T {
  const key = depsKey(deps)
  const cell = nextCell('memo', () => ({ kind: 'memo', value: { value: compute(), deps: key } }))
  const stored = cell.value as { value: T; deps: string }
  if (stored.deps !== key) {
    stored.value = compute()
    stored.deps = key
  }
  return stored.value
}

/** deps 指纹：逐位稳定序列化（undefined → null）/ the deps fingerprint: a per-slot stable serialization (undefined → null) */
function depsKey(deps: readonly unknown[]): string {
  return JSON.stringify(deps.map((dep) => (dep === undefined ? null : dep))) ?? '[]'
}

/**
 * useSlot：原始持久槽位。prompt-page 的 effect/on 记账面在它之上实现"一次运行、
 * 随会话清理"（RFC §5.3）；框架外代码一般不需要它。
 * useSlot: the raw persistent slot. prompt-page's effect/on recording face builds
 * "run once, cleaned up with the session" on it (RFC §5.3); code outside the
 * framework rarely needs it.
 */
export function useSlot<T>(init: () => T): { current: T } {
  const cell = nextCell('slot', () => ({ kind: 'slot', value: { current: init() } }))
  return cell.value as { current: T }
}

/**
 * context：渲染期"最近 Provider"的值引用。实现是值栈（render 阶段同步，无需
 * React 级并发安全）；provideContext 压栈、useContext 读栈顶。
 * context: a "nearest provider" value reference for render. Implemented as a
 * value stack (the render phase is synchronous — none of React's concurrent
 * machinery); provideContext pushes, useContext reads the top.
 */
export interface ContextRef<T> {
  readonly id: symbol
  readonly defaultValue: T
  /** 栈顶值（provideContext 期间非空）/ the stack top (non-null while provided) */
  current?: T
}

/** 创建 context 引用（默认值兜底）/ create a context reference (default value as the fallback) */
export function createContext<T>(defaultValue: T): ContextRef<T> {
  return { id: Symbol('prompt-core.context'), defaultValue }
}

/** 在 value 作用域内运行 fn（压栈-恢复）/ run fn within the value scope (push & restore) */
export function provideContext<T>(ref: ContextRef<T>, value: T, fn: () => T): T {
  const prev = ref.current
  ref.current = value
  try {
    return fn()
  } finally {
    ref.current = prev
  }
}

/** 读最近 Provider 的值；无 Provider 时用默认值 / read the nearest provider's value; the default when unprovided */
export function useContext<T>(ref: ContextRef<T>): T {
  return ref.current ?? ref.defaultValue
}
