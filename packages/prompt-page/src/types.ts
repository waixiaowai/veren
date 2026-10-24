/**
 * 类型定义（只放类型）/ Type definitions (types only)
 *
 * 页面运行时的形状：一页 = 一个会话 = 一次渲染。页面组件拿到真实会话 Agent，
 * 产物（Markdown）在挂载时一次成型进 PAGE 块；页面的全部逻辑——工具登记、
 * 首屏读取、后续变化——都活在组件体自己的生命周期里：异步读经
 * `agent.ctx.effect` 发起，读到的事实经 `agent.followup` 以新消息进上下文。
 * 宿主不经手任何取数。
 * The page runtime's shape: one page = one session = ONE render. The page
 * component receives the real session Agent; its output (Markdown) is shaped
 * once at mount into the PAGE block. ALL page logic — tool registration, the
 * first-screen read, later changes — lives in the body's own lifecycle: async
 * reads start via `agent.ctx.effect`, and the facts they land ride
 * `agent.followup` as new messages. The host touches no data fetching.
 */
import type { Agent } from '@deepseek-ai/dsh-agent'

/** URL 参数：路径参数 + query 合并（path 优先）/ path params + query (path wins) */
export type PageParams = Record<string, string>

/**
 * 页面的挂载绑定：在页面会话的 agent 上执行**唯一一次**组件渲染。
 * - `agent` 就是会话的真实 Agent：组件体里 `agent.ctx.tools.register` /
 *   `agent.ctx.effect` / `agent.ctx.on` 直接登记——体只跑一次，天然无重复；
 *   首屏异步读也由体经 `agent.ctx.effect` 自己发起，结果经 `agent.followup`
 *   以新消息进上下文——挂载不经手任何数据；
 * - 返回值是正文 Markdown（进 PAGE 块）。
 * The page's mount binding: runs the component's **only** render on the page
 * session's agent.
 * - `agent` IS the session's real Agent: the body registers via
 *   `agent.ctx.tools.register` / `agent.ctx.effect` / `agent.ctx.on` directly —
 *   the body runs once, so no duplicates are possible. The first-screen read is
 *   the body's own too, started via `agent.ctx.effect`; its result rides
 *   `agent.followup` as a new message — mounting touches no data;
 * - the return value is the body Markdown (into the PAGE block).
 */
export interface PageLiveBinding {
  /** 为一个页面会话执行唯一一次渲染 / run the one render for a page session */
  mount(params: PageParams, agent: Agent): string
}

/**
 * 页面定义（应用作用域）：
 * - **preset 字段已删除**：页面不再绑定预设，静态面归用户自选的会话配置（§2.2）
 * - 页面契约版本 `pageRevision` 已删除（G11）：打开一律新建会话（§9.1.1），
 *   新会话没有旧契约预期，无需版本判断
 * - **load 已删除**：首屏读取是组件体自己的生命周期（effect 发起、followup
 *   送达），宿主不再预载任何首屏数据
 * - **skills 已删除**：单会话 skill 与工具同机制——组件体直接
 *   `agent.ctx.skills.register`，随 agent fiber 生灭，宿主不经手挂载
 * - 应用作用域注册时 URL 必须是 `/apps/<appId>/...` 形态（见 contract.ts 的校验器）
 * - 工具不走声明清单：组件体经 `agent.ctx.tools.register` 直接登记，PAGE 块的
 *   tools 行由挂载方对比登记前后差集推导（单一事实源 = 真实登记面）
 * The page definition (app-scoped):
 * - the preset field is gone: pages bind no preset; the static face belongs to
 *   the user-chosen session config (§2.2)
 * - the pageRevision contract version is gone (G11): opening always creates a
 *   fresh session (§9.1.1) with no stale contract expectations
 * - load is gone: the first-screen read is the body's own lifecycle (started
 *   by an effect, delivered by a followup); the host preloads nothing
 * - skills are gone: a single-session skill rides the same mechanism as tools —
 *   the body registers it via `agent.ctx.skills.register`, it lives and dies
 *   with the agent fiber, and the host never mounts one
 * - app-scoped urls must be `/apps/<appId>/...` (the contract.ts validator)
 * - tools carry no declaration list: the body registers via
 *   `agent.ctx.tools.register` and the PAGE block's tools line is derived by
 *   the mounter as the before/after registration delta (the single source of
 *   fact is the real registration face)
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
   * （§3.10.1）中的**写意图轴**：详情页（带 `:param`）必须声明 true，且挂载时
   * 至少登记一个工具 + 非空说明（规则 3，挂载期拦）；无参非入口页声明 true 即
   * 自报"我是工具页（action）"，缺工具走 §3.9 警告（规则 3b）；**只读详情页
   * （viewer）不声明**——只读下钻如实注册是合法形态；首页与只读副页也不声明，
   * 且不因缺写工具报警（规则 2）。显式 `writes: false` 与缺省同义。
   * The write-intent declaration (§3.9/§3.10.1): **this page's duty needs write
   * capability** — a declaration, not a fact, and worth keeping precisely
   * because it is cross-checked against the fact of registered tools (the §3.9
   * coverage warning). It is the **write-intent axis** of the two-axis,
   * four-tier taxonomy (§3.10.1): a detail page (with a `:param`) must declare
   * true and register at least one tool with non-empty instructions at mount
   * (rule 3, refused at mount); a parameterless non-entry page declaring true
   * self-reports "I am an action page" and its missing tools ride the §3.9
   * warning (rule 3b); a **viewer page never declares it** — a read-only
   * drilldown registers honestly; home and read-only secondary pages do not
   * declare it either and are never flagged for lacking write tools (rule 2).
   * An explicit `writes: false` equals the default (both read as read-only).
   */
  readonly writes?: boolean
  /** 本页给模型的说明；随 PAGE 块附上，不是系统提示词 / page note, not a system prompt */
  readonly instructions?: string
  /** 实例标题函数；缺省用 description 兜底（§3.6.1）/ instance title, falls back to description */
  readonly instanceTitle?: (params: PageParams) => string
}
