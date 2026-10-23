/**
 * 类型定义（只放类型）/ Type definitions (types only)
 *
 * 页面运行时的形状：一页 = 一个会话；页面经应用作用域注册表以唯一 URL 注册。
 * 页面不再绑定预设；应用/实例/工具契约见 contract.ts 与两个插件的 types.ts。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { PromptElement } from '@veren/prompt-core'

/** URL 参数：路径参数 + query 合并（path 优先）/ path params + query (path wins) */
export type PageParams = Record<string, string>

/**
 * 页面级 skill 的声明面（随页面挂进该会话 agent 作用域的运行时技能）：字段与
 * 宿主 `ctx.skills.register` 的运行时技能对齐（name/description/content 必填，
 * whenToUse 可选）——宿主侧注册时补 source/provider，本面不重复声明。
 * The page-scope skill declaration face (a runtime skill mounted into the
 * session's agent scope with the page): fields align with the host
 * `ctx.skills.register` runtime-skill face (name/description/content required,
 * whenToUse optional) — the host side adds source/provider at registration;
 * this face does not redeclare them.
 */
export interface PageSkill {
  /** Kebab-case 技能名 / kebab-case skill name */
  readonly name: string
  /** 路由描述 / the routing description */
  readonly description: string
  /** 何时使用的补充指引 / extra when-to-use guidance */
  readonly whenToUse?: string
  /** Markdown 指令正文 / the Markdown instruction body */
  readonly content: string
}

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
  /**
   * 为一个页面会话挂载实时视图（已订阅 store）。`scope` 是该会话的 agent 作用域
   * （`agent.ctx`）：组件的 effect/on 经它注册——事件按 agent 过滤、清理随作用域
   * 销毁；缺省（agent 尚未创建，如暂存预览）回退到创建者 ctx。
   * Mount one live view for a page session (store-subscribed). `scope` is the
   * session's agent scope (`agent.ctx`): the component's effect/on register
   * through it, so events are agent-filtered and cleanup is scope-owned; absent
   * (the agent does not exist yet, e.g. a staged preview) it falls back to the
   * creator ctx.
   */
  mount(params: PageParams, scope?: Context): PageSession<never>
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
   * 页面级 skills（§页面作用域）：随本页挂进会话 agent 作用域的运行时技能，
   * 与页面工具同一组逆序清理；普通会话与其他页面不可见。
   * Page-scope skills: runtime skills mounted into this session's agent scope
   * with the page, torn down with the same disposer group as the page tools;
   * invisible to ordinary sessions and to other pages.
   */
  readonly skills?: readonly PageSkill[]
  /**
   * 首屏数据（§3.10.3，组件页语义）：建会话时跑一次，结果经 useSnapshot() 进
   * 组件——组件把它渲染为正文（失败态也是数据，如实渲染，不允许静默空白）。
   * 参数来自 URL 解析；env 带页面会话事实。
   * The first-screen data (§3.10.3, component-page semantics): runs once at
   * session creation and reaches the component via useSnapshot() — the
   * component renders it into the body (failure states are data too, rendered
   * honestly, never a silent blank). Params come from the url; env carries
   * page-session facts.
   */
  readonly load?: (params: PageParams, env: PageLoadEnv) => Promise<PageJsonValue>
  /** 实例标题函数；缺省用 description 兜底（§3.6.1）/ instance title, falls back to description */
  readonly instanceTitle?: (params: PageParams) => string
}

/**
 * 会话宿主的结构面（C5）：Markdown 文档宿主（component.tsx 的 MarkdownDocHost）
 * 结构性满足——页面只有组件页一种形态。增量/全量同步走 takeMarkdownPatch
 * （消费方自持游标）；本面不承诺 renderSince 之类的通用同步形状。
 * The session host's structural face (C5): the Markdown doc host
 * (MarkdownDocHost in component.tsx) satisfies it structurally — the component
 * page is the only page shape. Deltas ride takeMarkdownPatch (consumers own the
 * cursor); this face promises no generic renderSince-like sync shape.
 */
export interface PageHostFace {
  /** 当前版本号（交付门控来源）/ the current version (the delivery gating source) */
  readonly currentVersion: number
}

/** 一个已挂载的页面会话 / one mounted page-session */
export interface PageSession<S> {
  readonly page: PageDefinition<S>
  readonly params: PageParams
  readonly host: PageHostFace
  /** 打开指针注入文本（新会话第一条 user 消息）/ pointer message injected at open */
  readonly pointerMessage: string
  get version(): number
  /** 渲染 cursor 之后的同步文本 / sync text after the given cursor */
  syncText(cursor?: number): string
  /** 解除 store 订阅（会话结束；组件页 = teardown：effect 清理逆序 + 订阅退订）
   * / detach from the store (session end; for component pages this is teardown: cleanups in reverse + subscriptions) */
  unsubscribe(): void
}
