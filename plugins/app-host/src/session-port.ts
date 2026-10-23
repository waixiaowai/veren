/**
 * 真实会话端口：把 page-registry 对 DSH 会话机制的假设接到真实宿主面上。
 * The real session port: binds page-registry's session assumptions to the
 * real host services (`ctx.sessions` / `ctx.agents`).
 *
 * 与第 1 阶段的探测式端口（宿主全局工具表 + `ctx.get` 结构探测 + 缺席降级，
 * 已随 G13 拆除）不同：
 * - `sessions` / `agents` 走**声明过的 inject + declaration merging 真实面**，
 *   无 `ctx.get` 探测、无 `?.` 降级分支（G13 规则 1）；
 * - **一次性渲染**：页面组件体在 create 激活的 agent 身上执行恰好一次，工具由
 *   组件体直接 `agent.ctx.tools.register` 登记（随 agent fiber 生灭）——本端口
 *   不经手任何工具定义，只提供 toolFace 快照（挂载前后差集即页面工具）；
 * - create 当场应用页面作用域屏蔽（app_open/app_list/app_pages 的 deny）：
 *   页面会话已在页面之内，引导工具不该再暴露（"打开页 → 新 agent → 再开页"
 *   会话雪崩的对称面）；
 * - retire（废弃路径）= 整体 dispose 该端口经 agents.create 拿到的句柄——
 *   页面登记的一切随 fiber 逆序拆除，会话日志保留可读；
 * - 消息经 `agent.followup` + `ctx.sessions.flush` 确认（forum 的投递纪律）；
 * - focus 是显式接缝（{@link FocusPort}）：真实实现 {@link eventFocus} 发
 *   `app-host/focus` 事件，Web 伴生插件接收后执行真正的界面切换；
 * - 页面会话创建即激活 agent（H 根因修复）：GUI 侧栏按 blank 隐藏非当前会话，
 *   agent 不激活会话就永远 blank/不可见/进不去；激活后第一条 turn 使会话
 *   非 blank，instanceTitle 以 user source 的 session/title 落盘供侧栏显示。
 * The one-shot render: the page component body runs exactly once on the agent
 * activated by create; tools are registered by the body via
 * `agent.ctx.tools.register` directly (they live and die with the agent
 * fiber) — this port never touches tool definitions, it only offers the
 * toolFace snapshots whose before/after delta IS the page's tools.
 * @module @veren/app-host/session-port
 */
import { scopeOf } from '@deepseek-ai/dsh-scope'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Context } from '@deepseek-ai/cordis'
// 类型-only import：拉取 dsh-agent / dsh-session 的 declaration merging（ctx.agents / ctx.sessions）
// 以及 Agent / AgentHandle 的权威类型——不再手写最小探测面（G13：显式 inject，无结构探测）。
// type-only imports: pull the dsh-agent/dsh-session declaration merges (ctx.agents /
// ctx.sessions) and the authoritative Agent/AgentHandle types — no hand-written probe faces.
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
// 类型-only import：拉取 session/title 事件的 SessionEventMap merge（权威标题落盘用）
// type-only import: pulls the session/title event's SessionEventMap merge (authoritative title persistence)
import type {} from '@deepseek-ai/dsh-session-title'
// 类型-only import：拉取 ctx.agentDefaultModel 的 declaration merging（部署默认模型选型）
// type-only import: pulls the ctx.agentDefaultModel declaration merge (the deployment default model)
import type {} from '@deepseek-ai/dsh-agent-default-model'
// 类型-only import：拉取 ctx.tools（agent 作用域工具面 / restrict 的实际服务面来源）。
// 不能靠 dsh-agent 间接带上：间接 merge 一旦上游调整就静默失效。
// type-only import: declares ctx.tools — the actual service surface behind
// `agent.ctx.tools.register` / `.restrict`. Never rely on a transitive merge.
import type {} from '@deepseek-ai/dsh-tools'
// 类型-only import：拉取 workspaceRegistry 的 declaration merging（页面会话的
// 工作区归属按会话头 cwd 解析，见 pageSessionWorkspace）。
// type-only import: declares ctx.workspaceRegistry (page-session workspace
// membership is resolved from the header cwd, see pageSessionWorkspace).
import type {} from '@deepseek-ai/dsh-workspace'
import type { Workspace } from '@deepseek-ai/dsh-workspace'
// 类型-only import：拉取 ctx.skills 的 declaration merging（页面级 skills 挂到
// 会话 agent 作用域的真实服务面）。不能靠间接 merge 带上。
// type-only import: declares ctx.skills — the real service face mounting
// page-scope skills onto the session's agent scope. Never rely on a transitive
// merge.
import type {} from '@deepseek-ai/dsh-skill'
import type { PageSkill } from '@veren/prompt-page'
import type { PageSessionPort, PageToolEntry } from '@veren/page-registry'

/** focus 接缝：把界面切到某会话 / the focus seam: bring a session to the GUI front */
export interface FocusPort {
  focus(sessionId: string): Promise<void>
}

/** focus 事件载荷：GUI 侧伴生插件监听后调 uiWorkspace.openSession / focus payload for the GUI companion plugin */
export interface FocusEventPayload {
  readonly sessionId: string
}

/**
 * 真实 focus 实现：发一条宿主 emit 事件，Web 端伴生插件经 Remote 载体收到后
 * 执行真正的界面切换（uiWorkspace.openSession）。宿主侧没有 DOM，切界面只能
 * 由客户端完成——这条事件就是 H 的 focus 通道。
 * The real focus implementation: emit one host event; the Web-side companion
 * plugin receives it through the Remote carrier and performs the actual switch
 * (uiWorkspace.openSession). The host has no DOM — only the client can switch,
 * so this event is the focus channel.
 */
export function eventFocus(ctx: Context): FocusPort {
  return {
    focus: async (sessionId) => { ctx.emit('app-host/focus', { sessionId } satisfies FocusEventPayload) },
  }
}

/** 日志 focus 实现（测试替身用；生产默认走 {@link eventFocus}） */
export function loggingFocus(logger: { info(message: string): void }): FocusPort {
  return {
    focus: async (sessionId) => { logger.info(`app-host: focus session ${sessionId} (GUI focus lands with the toolbar app dropdown)`) },
  }
}

/** 消息源 kind 常量（MessageSourceMap 的扩充点在文件尾 declaration merging） */export const PAGE_MESSAGE_SOURCE = 'app/page' as const
export const TASK_MESSAGE_SOURCE = 'app/task' as const
export const NOTICE_MESSAGE_SOURCE = 'task-center/notice' as const
export const PAGE_SEND_MESSAGE_SOURCE = 'page/send' as const

/** 消息源 → MessageSourceMap kind 的白名单（declaration merging 见文件尾） */
type PageSourceKind = typeof PAGE_MESSAGE_SOURCE | typeof TASK_MESSAGE_SOURCE | typeof NOTICE_MESSAGE_SOURCE | typeof PAGE_SEND_MESSAGE_SOURCE

/** 会话 id 的 brand 收窄：端口面收 plain string，跨边界在此一次性收窄
 * / the one brand narrowing where plain port strings cross the SessionId boundary */
const sid = (sessionId: string): SessionId => sessionId as SessionId

function sourceKind(source: string): PageSourceKind {
  switch (source) {
    case TASK_MESSAGE_SOURCE: return TASK_MESSAGE_SOURCE
    case NOTICE_MESSAGE_SOURCE: return NOTICE_MESSAGE_SOURCE
    case PAGE_SEND_MESSAGE_SOURCE: return PAGE_SEND_MESSAGE_SOURCE
    default: return PAGE_MESSAGE_SOURCE
  }
}

/**
 * 页面会话的预设 id（§3.10.3 PageLoadEnv.preset 的来源）：与会话头同源——页面
 * 工具解析调用者（如 notebook callerOf）读的就是 header.agentPreset，两条路径
 * 口径一致，load 看到的归属与工具调用看到的归属不会分叉。
 * 它挂在 PageRuntimePorts 上（不是会话面）：这是宿主对"这条会话属于谁"的回答。
 * The page session's preset id (the source of PageLoadEnv.preset, §3.10.3):
 * sourced from the session header — the same field page tools read their caller
 * from (e.g. notebook's callerOf), so what load sees as the owner never drifts
 * from what a tool call sees. It belongs to PageRuntimePorts rather than the
 * session face: it is the host's answer to "whose session is this".
 */
export function createPresetOf(ctx: Context): (sessionId: string) => string | undefined {
  return (sessionId) => ctx.sessions.get(sid(sessionId))?.header.agentPreset
}

/**
 * 页面会话的工作区落点：部署默认工作区。会话头 `cwd` 决定候选归属，而工作区
 * 记录里的 `sessionIds` 是"候选列表按 cwd 索引过滤"的视图——因此两者都要：
 * 建会话时写该工作区的路径作为 cwd，建完再 `attachSession` 把 id 记进候选表
 * （与会话控制器创建 GUI 会话的同一路径）。注册表为空时返回 undefined（没有
 * 工作区可归属，退回进程 cwd）。
 * The page session's workspace home: the deployment default workspace. The
 * header `cwd` decides candidate membership, and a workspace's `sessionIds` is a
 * filtered view of its candidate list — so both steps are needed: create the
 * session with that workspace's path as cwd, then `attachSession` the id into
 * the account (the same path the session controller uses for GUI sessions). An
 * empty registry yields undefined (nothing to join; fall back to the process cwd).
 * @param ctx - 宿主上下文（`workspaceRegistry` 是声明过的 inject）。
 * @returns 页面会话要加入的工作区，或 undefined。
 */
async function pageSessionWorkspace(ctx: Context): Promise<Workspace | undefined> {
  const workspaces = ctx.workspaceRegistry.list()
  if (workspaces.length === 0) return undefined
  // initializeDefault 在已初始化时是幂等读取（resolver 不会被调用）；持久记录
  // 缺失时它返回 undefined，退回最早创建的工作区（默认工作区先于任何用户工作区）。
  // initializeDefault is an idempotent read once initialized (the resolver is
  // never called); when the durable record is missing it returns undefined and
  // the oldest workspace (the default is always created first) is the fallback.
  const preferred = await ctx.workspaceRegistry.initializeDefault(async () => {
    throw new Error('app-host: the default workspace already exists; the resolver must not run')
  }).catch(() => undefined)
  return preferred ?? workspaces[workspaces.length - 1]
}

/**
 * 构造真实会话端口。`sessions` / `agents` 是声明过 inject 的宿主服务（本插件
 * 的属主面，经 declaration merging 的真实类型访问）：不做任何运行期结构探测，
 * 也不带"缺席即降级"分支——服务缺席是装配错误，由 inject 等待/fail loud 兜住。
 * @param ctx - 宿主上下文（读 `sessions` / `agents` 服务）
 * @param focus - focus 接缝（GUI 实现归 H）
 */
export function createRealSessionPort(ctx: Context, focus: FocusPort = eventFocus(ctx)): PageSessionPort {
  const agentOf = (sessionId: string): Agent | undefined => ctx.agents.get(sid(sessionId))
  // 会话 → 本端口经 agents.create 拿到的句柄：只有持有者能整体拆除该 agent
  // / session → the handle from agents.create; only the holder can tear the agent down
  const handles = new Map<string, AgentHandle>()

  /** 整体拆除该会话的 agent（retire/destroy 共用；幂等） / tear the session's agent down whole (shared by retire/destroy; idempotent) */
  const disposeAgent = async (sessionId: string): Promise<void> => {
    const handle = handles.get(sessionId)
    if (handle === undefined) return
    handles.delete(sessionId)
    try {
      await handle.dispose()
    } catch (error: unknown) {
      ctx.logger.warn(`app-host: dispose(${sessionId}) failed: ${String(error)}`)
    }
  }

  /** 该 agent 作用域当前可见的工具面（名字 + 用途描述）/ the tool face currently visible in the agent's scope */
  const toolFaceOf = (agent: Agent): readonly PageToolEntry[] =>
    agent.ctx.tools.schemas(scopeOf(agent.ctx)).map((schema) => ({ name: schema.name, description: schema.description }))

  const followup = (agent: Agent, text: string, source: string): void => {
    agent.followup(createUserMessage({
      content: [{ type: 'text', text }],
      source: { kind: sourceKind(source) },
    }))
  }

  // agent 销毁：句柄登记清理（作用域注册已随 fiber 自动消失）。
  ctx.on('agent/disposed', ({ agent }) => {
    const sessionId = agent?.session?.id
    if (sessionId !== undefined) handles.delete(sessionId)
  })

  return {
    exists: (sessionId) => ctx.sessions.get(sid(sessionId)) !== undefined,
    // 页面组件体的唯一载体：该会话的活 agent。工具/skills/订阅/清理由组件体
    // 直接经 agent.ctx 登记——随 agent fiber 生灭，端口不经手任何定义。
    // The sole carrier of the page body: the session's live agent. Tools,
    // skills, subscriptions and cleanups are registered by the body via
    // agent.ctx directly — they live and die with the agent fiber; this port
    // never handles definitions.
    agentOf: (sessionId) => agentOf(sessionId),
    toolFace: (sessionId) => {
      const agent = agentOf(sessionId)
      return agent === undefined ? [] : toolFaceOf(agent)
    },
    mintId: () => crypto.randomUUID(),
    async create(sessionId, title) {
      // H 的根因修复：页面会话必须当场激活 agent（不再是"等用户进入"）。GUI
      // 侧栏按 blank（没有第一条 turn）隐藏非当前会话——不激活 agent，页面会话
      // 永远 blank，也就永远不可见、进不去，agent 永远不会被激活（死锁）。
      // agents.create 会连同创建会话并发布 agent/created；组件体的唯一一次
      // 渲染随之落到这个活 agent 上，第一条 turn 随之提交。
      // The root-cause fix: a page session activates its agent right away (no
      // more "wait until the user enters"). The GUI sidebar hides non-current
      // blank sessions — without an agent the page session stays blank forever,
      // so it can never be seen or entered and its agent can never activate
      // (a deadlock). agents.create publishes the session and agent/created;
      // the body's one render then lands on this live agent, and the first
      // turn commits.
      // agentOptions.model 来自部署默认模型（agentDefaultModel）：agent-loop 用
      // agent.options.model 注册 {{model}} 提示变量——不给模型，deployment
      // persona 段的 {{model}} 插值在首回合就失败（真机实测）。这是 webhook
      // 会话创建（experimental/webhook/src/session.ts）的同一选型路径。
      // agentOptions.model comes from the deployment default model
      // (agentDefaultModel): the agent loop registers the {{model}} prompt
      // variable from agent.options.model — without a model, the deployment
      // persona section's {{model}} interpolation fails on the first turn
      // (live-tested). This is the same selection path as the webhook session
      // creation (experimental/webhook/src/session.ts).
      const selected = ctx.agentDefaultModel.currentSelection()
      // 工作区归属：cwd 决定候选匹配，attachSession 把 id 记进候选表（两者缺一
      // 都落「未分组」）。注册表为空时退回进程 cwd，仍可开会话。
      // Workspace membership: the cwd drives candidate matching and attachSession
      // writes the id into the account (either missing lands in "ungrouped"). An
      // empty registry falls back to the process cwd so the open still works.
      const workspace = await pageSessionWorkspace(ctx)
      const handle = await ctx.agents.create({
        sessionId: sid(sessionId),
        agentOptions: { provider: selected.provider, model: selected.model },
        meta: { cwd: workspace?.path ?? process.cwd(), agentPreset: 'standard' },
      })
      handles.set(sessionId, handle)
      // 页面作用域屏蔽（页面会话已在页面之内）：app_open/app_list/app_pages 对
      // 本 agent 隐藏，模型照 PAGE 块再调 app_open 打开同一 URL 会自激成
      // "开页 → 新 agent → 再开页"的递归（真机实测的会话雪崩）。屏蔽随 agent
      // fiber 生灭，无需单独释放。
      // Page-scope masking (the session is already inside the page):
      // app_open/app_list/app_pages are hidden from this agent — a model that
      // follows the PAGE block by calling app_open on the same url self-ignites
      // the "open page → new agent → open page" recursion (the live session
      // avalanche). The masking lives and dies with the agent fiber; no
      // separate release is needed.
      handle.agent.ctx.tools.restrict({ deny: ['app_open', 'app_list', 'app_pages'] })
      if (workspace !== undefined) {
        // 归属失败不阻断开页（会话已建好），但必须留痕：这是装配/路径契约的缺陷。
        // A failed attach does not abort the open (the session exists) but it is
        // logged: it means the path contract or the assembly is broken.
        await workspace.attachSession(sid(sessionId)).catch((error: unknown) => {
          ctx.logger.warn(`app-host: page session ${sessionId} could not join workspace "${workspace.id}": ${String(error)}`)
        })
      }
      // instanceTitle 是页面实例的权威标题（§3.6.1）：立即落成 user source 的
      // session/title（空 messageSeqs 恰好是 user 标题的合法形状）——侧栏按它
      // 显示「发布任务」「主题 #12」，且不会被标题 LLM 事后改写。
      // instanceTitle is the page instance's authoritative title (§3.6.1): land
      // it now as a user-source session/title (empty messageSeqs is exactly the
      // legal user-title shape) — the sidebar shows it and the title LLM never
      // rewrites it.
      ctx.sessions.get(sid(sessionId))?.append('session/title', { title, messageSeqs: [], source: { kind: 'user' } })
    },
    async mountSkills(sessionId, skills) {
      const agent = agentOf(sessionId)
      if (agent === undefined) {
        throw new Error(`app-host: mountSkills(${sessionId}) found no active agent; page sessions always have one after create`)
      }
      for (const skill of skills) {
        // source 固定 'runtime'（registry 的运行时技能层），作用域取自
        // agent.ctx——只有本会话可见，随 agent fiber 释放。
        // source is fixed to 'runtime' (the registry's runtime layer) and the
        // scope is agent.ctx — visible to this session alone, released with the
        // agent fiber.
        agent.ctx.skills.register({ ...skill, source: 'runtime' })
      }
    },
    async retire(sessionId) {
      // 废弃路径（§3.5.3）：整只拆除 agent——页面登记的工具/skills/订阅/清理随
      // fiber 逆序拆除，会话日志保留可读。
      // The deprecation path (§3.5.3): tear the agent down whole — everything
      // the page registered unwinds with the fiber; the session log stays
      // readable.
      await disposeAgent(sessionId)
    },
    async appendUserMessage(sessionId, text, source, options) {
      // wake=false（§3.9 唤醒策略的可选面）：只把消息落会话日志，不 followup、
      // 不产生模型回合；目标 agent 下一次被唤醒时一并消费。
      // wake=false (the optional wake policy, §3.9): land the message in the
      // session log only — no followup, no model round; consumed whenever the
      // target agent next wakes.
      if (options?.wake === false) {
        ctx.sessions.get(sid(sessionId))?.append('user/message', createUserMessage({
          content: [{ type: 'text', text }],
          source: { kind: sourceKind(source) },
        }), { surfaceOp: 'append' })
        return
      }
      const agent = agentOf(sessionId)
      // 页面会话在 create 时即激活 agent，这里没有"等 agent"的分支——缺席是
      // 装配错误，fail loud。
      // A page session activates its agent at create; there is no "wait for the
      // agent" branch here — a miss is an assembly error and fails loud.
      if (agent === undefined) {
        throw new Error(`app-host: appendUserMessage(${sessionId}) found no active agent`)
      }
      followup(agent, text, source)
      const flushed = await ctx.sessions.flush(agent.session)
      if (flushed === false) {
        ctx.logger.warn(`app-host: session ${sessionId} did not flush the "${source}" block`)
      }
    },
    focus: (sessionId) => focus.focus(sessionId),
    async destroy(sessionId) {
      // 半成品兜底路径（页面创建失败回滚）：整只拆除本端口创建的 agent——
      // 句柄持有者才有资格 dispose，失败的会话不该留下活 agent。
      // Half-built rollback path (page-create failure): tear down the agent this
      // port created — only the handle holder may dispose; a failed session
      // must not leave a live agent behind.
      await disposeAgent(sessionId)
    },
  }
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** A page-session PAGE block (or TASK / task-center notice) appended by app-host. @persistenceSource user */
    'app/page': { kind: 'app/page' }
    /** A TASK block appended after a task take. @persistenceSource user */
    'app/task': { kind: 'app/task' }
    /** A task-center inbox notice pumped into a page session. @persistenceSource user */
    'task-center/notice': { kind: 'task-center/notice' }
    /** A page_send delivery message (wake or wake=false log-only). @persistenceSource user */
    'page/send': { kind: 'page/send' }
  }
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * 把某条会话切到 GUI 前台的请求（focus 端口的真实实现发出；Web 伴生插件
     * 经 Remote 载体接收后调 uiWorkspace.openSession）。纯通知，无拦截面。
     * 载荷类型必须与客户端伴生插件（@veren/app-host-ui）的再声明逐字相同——
     * interface merging 要求两次声明同一类型。
     * @mode emit
     * Request to bring one session to the GUI front (emitted by the real focus
     * port; the Web companion plugin calls uiWorkspace.openSession on receipt
     * through the Remote carrier). Pure notification, no interception. The
     * payload type must stay verbatim-identical to the companion plugin's
     * redeclaration (@veren/app-host-ui) — interface merging demands the same
     * type twice.
     */
    'app-host/focus': (payload: { readonly sessionId: string }) => void
  }
}
