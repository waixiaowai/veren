/**
 * 类型定义（只放类型）/ Type definitions (types only)
 *
 * React 的对应物：Element（描述）/ Component（函数组件）/ Fiber（工作单元）/
 * Effect（副作用）/ Lane（优先级）/ PromptHost（宿主契约）。
 * 内核不知道任何消息格式 —— SNAPSHOT/PATCH 属于宿主层。
 */

export type Key = string

/** 实体铁律：id 稳定（React key 思想）/ Entity rule: stable id (React key) */
export interface Entity {
  id: string
}

/** 调度优先级 / scheduling lane */
export type Lane = 'sync' | 'transition' | 'background'

/** 宿主块类型名（如 'static' | 'item' | 'data'）/ host block kind */
export type HostKind = string

/** 组件：props → 元素（单个 Fragment 元素或数组均可，reconciler 归一化）/ component: props -> element(s) */
export interface Component<P = Record<string, unknown>> {
  (props: P): PromptElement[] | PromptElement
  /** memo 比较器（挂在本体上，reconciler 读取）/ memo comparator attached to the fn */
  __memoCompare?: (a: unknown, b: unknown) => boolean
}

/** 元素：轻量描述，与实例分离（React Element 对应物）/ lightweight description */
export interface PromptElement {
  readonly type: Component | HostKind
  readonly key?: Key
  readonly props: Record<string, unknown>
}

/** 宿主实例：已提交的块（React DOM node 对应物）/ committed block instance */
export interface HostInstance {
  readonly kind: HostKind
  readonly key?: Key
  readonly props: Record<string, unknown>
}

/** Fiber：工作单元 + 已提交树节点 / work unit + committed tree node */
export interface Fiber {
  type: Component | HostKind
  key?: Key
  props: Record<string, unknown>
  tag: 'component' | 'host'
  child: Fiber | null
  sibling: Fiber | null
  parent: Fiber | null
  /** 宿主实例（仅 host fiber）/ host instance (host fibers only) */
  instance?: HostInstance
}

/** 页面树/组件可返回的元素形态 / element or element array */
export type ElementInput = PromptElement | readonly PromptElement[]

export type EffectTag = 'placement' | 'update' | 'deletion'

/** 副作用：commit 阶段交给宿主 / side effect handed to the host at commit */
export interface Effect {
  readonly tag: EffectTag
  readonly instance: HostInstance
  readonly prevInstance?: HostInstance
  readonly lane: Lane
}

/**
 * 宿主契约。LLM 上下文是 append-only 日志：
 * - append：placement（新块追加）
 * - revise/evict 是宿主策略（物理上无法修改历史 → 由宿主决定矫正/排除语义）
 * - flush：合批边界（一次 commit 的收尾）
 */
export interface PromptHost {
  append(instance: HostInstance): void
  revise?(prev: HostInstance, next: HostInstance): void
  evict?(instance: HostInstance): void
  flush?(): void
}

/** 可订阅外部状态源（bindStore 的输入）/ subscribable external store */
export interface ExternalStore<S> {
  subscribe(listener: () => void): () => void
  getState(): S
}
