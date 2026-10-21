/**
 * 类型定义（只放类型）/ Type definitions (types only)
 *
 * 页面运行时的形状：一页 = 一个会话；页面经应用作用域注册表以唯一 URL 注册。
 * 页面不再绑定预设；应用/实例/工具契约见 contract.ts 与两个插件的 types.ts。
 */
import type { PromptElement } from '@veren/prompt-core'
import type { AssembledSync, MessageHost } from '@veren/prompt-host-messages'

/** URL 参数：路径参数 + query 合并（path 优先）/ path params + query (path wins) */
export type PageParams = Record<string, string>

/**
 * 页面的实时数据绑定（§3.10.3 的最小闭环面）：注册页面时由应用一并声明权威
 * store，这里把它封成"按参数挂载一个视图会话"的闭包——挂载点（页面运行时）
 * 不接触 store 类型，状态类型在注册处（S 在场的地方）就被消费掉。
 * The page's live data binding (the minimal §3.10.3 loop): the app declares the
 * authoritative store at page registration; it is sealed here as a
 * mount-per-params closure so the mounting site (the page runtime) never sees
 * the store type — the state type is consumed where S is still in scope.
 */
export interface PageLiveBinding {
  /** 为一个页面会话挂载实时视图（已订阅 store）/ mount one live view (store-subscribed) */
  mount(params: PageParams): PageSession<never>
}

/**
 * @deprecated 页面不再绑定预设（页面 = 用户自选会话上的动态层）。
 * 本类型仅为 page-sync-bench 等迁移期消费方的 `buildPagePreset` 保留；
 * 新代码禁止使用（应用说明走 `ApplicationDefinition.instructions`，
 * 页面说明走 `PageDefinition.instructions`，都不是系统提示词）。
 * Legacy preset spec kept only for migration-era `buildPagePreset` callers.
 */
export interface PagePresetSpec {
  /** 系统提示词（→ persona.prefix）/ system prompt (→ persona.prefix) */
  readonly systemPrompt: string
  /** 客户端选择器排序 / roster order */
  readonly order?: number
}

/**
 * 页面侧的 JSON 值面（§3.10.2 的 `data` / `map` 序列化契约）：PAGE 块里出现的一切
 * 结构化数据都必须能落进这个闭集。只有 fresh 字面量与 type 别名能直接赋值；
 * 接口类型请在装配处展开成字面量行（保持 JSON 可序列化，不为绕类型造 as）。
 * The page-side JSON value face (the serialization contract of §3.10.2's
 * `data` / `map`): every structured value a PAGE block carries must fit this
 * closed set. Only fresh literals and type aliases assign directly; interface
 * instances are projected into literal rows at the assembly site (JSON-
 * serializable, no `as` escapes).
 */
export type PageJsonValue = null | boolean | number | string | PageJsonValue[] | { [key: string]: PageJsonValue | undefined }

/**
 * 能力地图条目（§3.10.1）：一级页 PAGE 块 `map` 行的元素——"可去哪、什么时候去"。
 * A capability-map entry (§3.10.1): one row of the home PAGE block's `map` —
 * "where to go next, and when".
 */
export interface PageMapEntry {
  /** 可去页面的 URL 模板（含 `:param`）/ the target page's url pattern (with `:param`s) */
  readonly url: string
  /** 什么时候该去：一句话，模型据此决定下一步 / when to open it: one phrase the model decides on */
  readonly use: string
  /** 模板参数说明：键 = `:param` 名 / the template's parameter notes, keyed by `:param` name */
  readonly params?: Readonly<Record<string, string>>
}

/**
 * 首屏载入环境（§3.10.3/§3.10.8）：宿主在建会话跑 `load` 时提供的页面会话事实。
 * 按预设隔离数据的应用（记事本、论坛）以 `preset` 解析归属——与页面工具取调用者
 * 的口径同源（会话头 agentPreset）。缺省 = 宿主未暴露该事实，load 应显式表达
 * "归属未知"，不编造数据。
 * **"身份类信息不进 URL"原则（§3.10.8）**：URL 是可分享、可复现的定位符，只回答
 * "哪一页、哪条记录"；调用者是谁走本环境进入取数路径，永远不出现在 URL 模式里。
 * 因此同一 URL 在不同 preset 下拿到不同数据是有意的取数语义，不是泄漏。
 * The first-screen load environment (§3.10.3/§3.10.8): facts about the page
 * session the host hands `load` at session creation. Preset-scoped apps (the
 * notebook, the forum) resolve their owner from `preset` — the same face the
 * page tools read the caller from (the session header's agentPreset). Absent =
 * the host did not expose it; `load` must then say "owner unknown" explicitly,
 * never fake data.
 * The "identity never enters the URL" principle (§3.10.8): the url is a
 * shareable, reproducible locator answering "which page, which record"; caller
 * identity travels through this environment and never appears in a url pattern.
 * The same url yielding different data under different presets is therefore
 * intentional semantics, not a leak.
 */
export interface PageLoadEnv {
  /** 页面会话的预设 id / the page session's preset id */
  readonly preset?: string
}

/**
 * 事件处理器的 IO 面：改上下文（append）/ 导航（navigate）。
 * 事件系统本身用宿主自带的 cordis 事件（ctx.emit / ctx.on，declaration merging），
 * 本包不另造总线；这里只定义页面声明处理器时拿到的 IO 形状。
 */
export interface PageIO {
  /** 改上下文：追加一条消息（host 结构化 append）/ append one note to the context */
  append(text: string): void
  /** 打开另一个页面（新会话 + 指针）/ open another page session */
  navigate(url: string): void
}

/** 事件处理器形状 / event handler shape */
export type PageEventHandler = (payload: unknown, io: PageIO) => void

/** 页面的事件监听声明形状 / event-listener map shape（键名 = cordis 事件名）*/
export type PageEventMap = Readonly<Record<string, PageEventHandler>>

/**
 * 页面定义（应用作用域）：
 * - **preset 字段已删除**：页面不再绑定预设，静态面归用户自选的会话配置（§2.2）
 * - 新增 tools/instructions/instanceTitle（§3.1）；
 *   `tools` 写应用工具目录里的本地名，最终名在挂载时拼前缀（§3.4.3）
 * - 页面契约版本 `pageRevision` 已删除（G11）：打开一律新建会话（§9.1.1），
 *   新会话没有旧契约预期，无需版本判断
 * - 应用作用域注册时 URL 必须是 `/apps/<appId>/...` 形态（见 contract.ts 的校验器）
 */
export interface PageDefinition<S> {
  /** 页面唯一名（应用内唯一；全局页面键为 `appId/name`）/ unique page name */
  readonly name: string
  /** 唯一 URL 模式：/apps/<appId>/xx/:param（仅路径段，查询串属于实际 URL）/ unique url pattern */
  readonly url: string
  /** 面向目录/入口的描述 / catalog-facing description */
  readonly description: string
  /** 本页挂载的工具（应用工具目录的本地名）/ local tool names from the app tool catalog */
  readonly tools?: readonly string[]
  /**
   * 写意图声明（§3.9/§3.10.1）：**本页职责需要写能力**——它是声明，不是事实，
   * 价值正在于和"挂没挂工具"这个事实互相核对（§3.9 完备性警告）。两轴四档
   * （§3.10.1）中的**写意图轴**：详情页（带 `:param`）必须声明 true，且至少挂
   * 一个工具 + 非空说明（规则 3，注册期拦）；无参非入口页声明 true 即自报
   * "我是工具页（action）"，缺工具走 §3.9 警告（规则 3b）；**只读详情页
   * （viewer）不声明**——只读下钻如实注册是合法形态，逼它谎称要写比没有校验
   * 更糟；首页与只读副页也不声明，且不因缺写工具报警（规则 2）。
   * 显式 `writes: false` 与缺省同义（都按只读读档）。
   * The write-intent declaration (§3.9/§3.10.1): **this page's duty needs write
   * capability** — a declaration, not a fact, and worth keeping precisely
   * because it is cross-checked against the fact of mounted tools (the §3.9
   * coverage warning). It is the **write-intent axis** of the two-axis, four-tier
   * taxonomy (§3.10.1): a detail page (with a `:param`) must declare true and
   * mount at least one tool with non-empty instructions (rule 3, refused at
   * registration); a parameterless non-entry page declaring true self-reports
   * "I am an action page" and its missing tools ride the §3.9 warning (rule 3b);
   * a **viewer page never declares it** — a read-only drilldown registers
   * honestly, and forcing it to claim writes is worse than no validation; home
   * and read-only secondary pages do not declare it either and are never flagged
   * for lacking write tools (rule 2). An explicit `writes: false` equals the
   * default (both read as read-only).
   */
  readonly writes?: boolean
  /** 本页给模型的说明；随 PAGE 块附上，不是系统提示词 / page note, not a system prompt */
  readonly instructions?: string
  /**
   * 能力地图（§3.10.1）：本应用可去的页面、各自的 URL 模板与"什么时候去"。
   * 首页（entry）**仅当本应用还有记录页（详情/只读详情 viewer）时**必须非空
   * （§3.10.5 规则 1 收窄后）；工具页/只读副页可省。
   * The capability map (§3.10.1): where this app can go, each target's url
   * pattern and when to open it. Required on the home page (the entry) **only
   * while the app also has record pages (detail / viewer)** (narrowed rule 1);
   * optional on action / read-only pages.
   */
  readonly map?: readonly PageMapEntry[]
  /**
   * 首屏数据（§3.10.3）：建会话时跑一次，结果写进 PAGE 块的 `data` 行——
   * PAGE 块 data 的唯一合法来源。参数来自 URL 解析；env 带页面会话事实。
   * 抛错按失败态处理（data 写 page/load-failed），不允许静默空白。
   * The first-screen data (§3.10.3): runs once at session creation and lands
   * in the PAGE block's `data` line — the only legal source of that field.
   * Params come from the url; env carries page-session facts. A throw becomes
   * the error state (data renders page/load-failed) — never a silent blank.
   */
  readonly load?: (params: PageParams, env: PageLoadEnv) => Promise<PageJsonValue>
  /** 实例标题函数；缺省用 description 兜底（§3.6.1）/ instance title, falls back to description */
  readonly instanceTitle?: (params: PageParams) => string
  /** 事件监听：键名 = cordis 事件名（ctx.emit 触发）/ listeners keyed by cordis event name */
  readonly events?: PageEventMap
  /** 组件树：params = 路径参数+query，state = 权威 store 状态 / component tree */
  readonly tree: (params: PageParams, state: S) => import('@veren/prompt-core').ElementInput
  /** 生命周期：挂载后调用（预留：首帧上下文装载）/ called after mount */
  readonly onLoad?: (params: PageParams) => void
  /** 生命周期：由消费方征询以决定是否归档会话 / consulted to decide session archive */
  readonly onComplete?: (params: PageParams) => boolean
}

/** 一个已挂载的页面会话 / one mounted page-session */
export interface PageSession<S> {
  readonly page: PageDefinition<S>
  readonly params: PageParams
  readonly host: MessageHost
  /** 打开指针注入文本（新会话第一条 user 消息）/ pointer message injected at open */
  readonly pointerMessage: string
  get version(): number
  /** 渲染 cursor 之后的同步文本 / sync text after the given cursor */
  syncText(cursor?: number): string
  /**
   * 策略层装配（仅在 mountPage 给了 assembly 时存在）：预算 remount + 按
   * provider 规划缓存断点，见 prompt-host-messages 的 createSyncAssembler。
   * Policy-layer assembly (present only when mountPage got an assembly):
   * budget remount + provider-planned cache breakpoints; see
   * createSyncAssembler in prompt-host-messages.
   */
  readonly assemble?: () => AssembledSync
  /** 解除 store 订阅（会话结束）/ detach from the store */
  unsubscribe(): void
}
