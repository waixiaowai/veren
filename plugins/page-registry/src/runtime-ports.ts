/**
 * 页面运行时的端口契约：宿主对接的全部假设收在纯参数端口上。
 * The page runtime's port contracts: every host assumption narrows to pure
 * parameter ports.
 *
 * 端口全部由装配层（app-host）经 bindPorts **纯参数**传入（G13 规则 2），本包
 * 不触碰任何 ctx、不探测兄弟服务；apps 是必填端口（没有它页面打不开），
 * tasks/deliveries/releaseLeases 是可选能力端口（缺席时按各自语义降级）。本包
 * 只依赖各服务包的类型出口，不依赖其运行时。
 * All ports arrive as pure parameters passed by the host assembly (app-host);
 * nothing here touches a Context or probes siblings. `apps` is required (pages
 * cannot open without it); tasks/deliveries/releaseLeases are optional
 * capability ports that degrade per their own semantics. This package depends
 * only on the type exports of the sibling service packages, never their runtime.
 *
 * @module @veren/page-registry/runtime-ports
 */
import type { Agent } from '@deepseek-ai/dsh-agent'
// 服务面类型只引真正的那一份：任务契约来自 declaration merging 出口，
// 本包不手写影子副本（同一事实只有一份类型声明）。
// Service-surface types are imported, never shadowed: the task contract comes
// from the owning package's public entry.
import type { TaskCenterContract } from '@veren/task-center'
import type { AppRegistryService } from '@veren/app-registry'

/**
 * 工具面条目（PAGE 块 tools 行的来源）：名字 + 用途描述，取自该 agent 作用域
 * 真实可见的工具。页面工具 = 挂载前后两次快照的差集——组件体直接登记，挂载方
 * 不经手定义，因此不存在"声明与事实两张皮"。
 * A tool-face entry (the source of the PAGE block's tools line): name + usage
 * description, read from what the agent's scope really sees. The page's tools
 * are the DELTA of two snapshots around the one render — the body registers
 * directly and the mounter never handles definitions, so declaration and fact
 * cannot drift apart.
 */
export interface PageToolEntry {
  readonly name: string
  readonly description: string
}

/**
 * 任务通知投递面（B 的 pendingDeliveries/markDelivered 投影）：只留投递必需的
 * 两个方法与 { deliveryId, text }，避免页面运行时耦合完整 TaskRecord。
 * The delivery face: a projection of task-center's pendingDeliveries/markDelivered
 * that keeps only { deliveryId, text }, so the page runtime never couples to TaskRecord.
 */
export interface DeliveryFace {
  /** 取全部可投递的收件箱通知 / every deliverable pending inbox notice */
  pending(): Promise<readonly { deliveryId: string; text: string }[]>
  /** 回报一次投递结果（成功不传 error）/ report one delivery attempt outcome */
  mark(deliveryId: string, error?: string): Promise<unknown>
}

/**
 * 会话端口：运行时对 DSH 会话机制的全部假设收在这一个面上。
 * The session port: every assumption about DSH sessions narrows to this face.
 */
export interface PageSessionPort {
  exists(sessionId: string): boolean
  mintId(): string
  /**
   * 建会话并**当场激活 agent**（H 修复：不激活的页面会话永远不可见）。页面
   * 作用域屏蔽（app_open/app_list/app_pages 的 deny）属于"这个会话是页面会话"
   * 的事实，在此一并应用——组件体渲染时屏蔽已生效。
   * Create the session and **activate its agent right away** (the H fix: an
   * agent-less page session is never visible). The page-scope masking (the
   * app_open/app_list/app_pages deny) is a fact of "this session is a page
   * session" and applies here — it is already in force when the body renders.
   */
  create(sessionId: string, title: string): Promise<void>
  /**
   * 该会话的活 agent：页面组件体在它身上执行恰好一次。undefined = agent 未激活
   * ——一次性渲染没有"等 agent"的回退，缺了就是装配错误，fail loud。
   * The session's live agent: the page body runs on it exactly once. undefined
   * = the agent is not active — the one-shot render has no "wait for the agent"
   * fallback; a miss is an assembly error and fails loud.
   */
  agentOf(sessionId: string): Agent | undefined
  /**
   * 该 agent 作用域当前可见的工具面（名字 + 用途描述）。挂载前后各取一次，
   * 差集就是页面工具——PAGE 块的 tools 行与 §3.9 完备性检查都以此为准。
   * The tool face currently visible in the agent's scope (names + usage
   * descriptions). Snapshot before and after the render; the delta IS the
   * page's tools — both the PAGE block's tools line and the §3.9 completeness
   * check read it.
   */
  toolFace(sessionId: string): readonly PageToolEntry[]
  /**
   * 退役该会话的 agent（废弃路径）：页面登记的一切（工具/skills/订阅/清理）
   * 随 fiber 逆序拆除，会话日志保留可读。
   * Retire the session's agent (the deprecation path): everything the page
   * registered (tools/skills/subscriptions/cleanups) unwinds with the fiber in
   * reverse order; the session log stays readable.
   */
  retire(sessionId: string): Promise<void>
  /**
   * 追加一条消息。`options.wake === false` 时不唤醒 agent（消息只落会话日志，
   * 等该会话下一次被唤醒时一并消费）；缺省唤醒（§3.9 唤醒策略）。
   * Append one message. `wake === false` appends without waking the agent (the
   * message lands in the session log and is consumed on the next wake);
   * default wakes (§3.9 wake policy).
   */
  appendUserMessage(sessionId: string, text: string, source: string, options?: { readonly wake?: boolean }): Promise<void>
  focus(sessionId: string): Promise<void>
  /** 创建失败兜底：销毁半成品会话（agent 一并销毁，页面登记随其消失）/ destroy a half-built session (the agent dies with it) */
  destroy(sessionId: string): Promise<void>
}

/** 运行时端口集：apps 必填，任务相关为可选能力端口（全部是纯参数）
 * / the runtime's ports: apps required, task faces optional capabilities */
export interface PageRuntimePorts {
  readonly sessions: PageSessionPort
  /** 应用注册表真实面（AppRecord）：应用不在场时 openUrl 给 app/not-found / the real app-registry face */
  readonly apps: Pick<AppRegistryService, 'get'>
  /**
   * 挂载期完备性告警（§3.9）：真实登记面收集后判"声明要写却挂不出工具"——
   * 缺席 → 静默跳过。
   * The mount-time completeness warning (§3.9): judges "declares writes but
   * mounts none" after the real registration face is collected. Absent →
   * skipped silently.
   */
  readonly warn?: (message: string) => void
  /** 任务中心真实契约的 take：缺席则任务场景给 page/host-unavailable / the real task contract */
  readonly tasks?: Pick<TaskCenterContract, 'take'>
  /** 任务通知投递面（§5.2 inbox 注入）；缺席则跳过投递 / delivery face; absent → skip pumping */
  readonly deliveries?: DeliveryFace
  /**
   * 废弃会话时释放它持有的任务租约（§3.5.3）；缺席则租约靠懒回收兜底。
   * Release the task leases a deprecated session holds (§3.5.3); absent, lazy
   * lease recycling in the task center is the fallback.
   */
  readonly releaseLeases?: (sessionId: string) => Promise<void>
  /** 任务租约时长（分钟），缺省 30 / lease minutes, default 30 */
  readonly leaseMinutes?: number
}

/** openUrl 的可选参数；`focus: false` 用于投递路径（§3.9）：建会话但不切界面 */
export interface OpenPageOptions {
  /** 任务场景：先 take 再追加 TASK 块（§5.3）/ take the task, then append TASK */
  readonly taskId?: string
  readonly actor?: string
  /** 投递路径置 false：建会话但不发 GUI focus（投递不是导航，§3.9） */
  readonly focus?: boolean
  /**
   * 调用方会话:与目标 URL 的 live 行同会话时,打开退化为幂等返回——否则
   * "一律新建"会废弃调用方自己的 live 行(页面会话经 app_open 打开自己的
   * 页面 = 自杀;真机反例:重挂机制依赖的 live 行被调用方的自救动作废弃)。
   * The caller's session: when it already owns the target url's live row, the
   * open degrades to an idempotent return — otherwise "always fresh" would
   * deprecate the caller's own live row (a page session opening its own page
   * via app_open = suicide; live counter-example: the live row the remount
   * depends on got deprecated by the caller's self-rescue).
   */
  readonly callerSessionId?: string
}

/** openUrl 的结果：打开一律新建，结果就是新会话 / openUrl result: the fresh session */
export interface OpenPageResult {
  readonly sessionId: string
  readonly url: string
  readonly title: string
}
