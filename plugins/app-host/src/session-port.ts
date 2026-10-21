/**
 * 真实会话端口：把 page-registry 对 DSH 会话机制的假设接到真实宿主面上。
 * The real session port: binds page-registry's session assumptions to the
 * real host services (`ctx.sessions` / `ctx.agents`).
 *
 * 与第 1 阶段的探测式端口（宿主全局工具表 + `ctx.get` 结构探测 + 缺席降级，
 * 已随 G13 拆除）不同：
 * - `sessions` / `agents` 走**声明过的 inject + declaration merging 真实面**，
 *   无 `ctx.get` 探测、无 `?.` 降级分支（G13 规则 1）；
 * - 页面工具优先挂**该会话 agent 作用域**（`agent.ctx.tools.register`）——只有
 *   这个 agent 可见，agent 销毁随其 fiber 自动释放，跨会话互不可见；
 * - agent 尚未激活时工具进入等待队列，`agent/created` 到达即挂上（新建的
 *   页面会话在用户真正进入时才有 agent）；
 * - 消息经 `agent.followup` + `ctx.sessions.flush` 确认（forum 的投递纪律）；
 * - focus 是显式接缝（{@link FocusPort}）：真实实现 {@link eventFocus} 发
 *   `app-host/focus` 事件，Web 伴生插件接收后执行真正的界面切换；
 * - 页面会话创建即激活 agent（H 根因修复）：GUI 侧栏按 blank 隐藏非当前会话，
 *   agent 不激活会话就永远 blank/不可见/进不去；激活后第一条 turn 使会话
 *   非 blank，instanceTitle 以 user source 的 session/title 落盘供侧栏显示。
 *
 * 测试注入每会话独立的真实 cordis 子上下文（与 AgentRegistry 的
 * `resolve: sessionId => this.get(sessionId)?.ctx` 同机制），生产路径解析
 * `ctx.agents.get(sessionId)?.ctx`。
 * @module @veren/app-host/session-port
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Context } from '@deepseek-ai/cordis'
// 类型-only import：拉取 dsh-agent / dsh-session 的 declaration merging（ctx.agents / ctx.sessions）
// 以及 Agent / SessionId 的权威类型——不再手写最小探测面（G13：显式 inject，无结构探测）。
// type-only imports: pull the dsh-agent/dsh-session declaration merges (ctx.agents /
// ctx.sessions) and the authoritative Agent/SessionId types — no hand-written probe faces.
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
// 类型-only import：拉取 session/title 事件的 SessionEventMap merge（权威标题落盘用）
import type {} from '@deepseek-ai/dsh-session-title'
// 类型-only import：拉取 agentDefaultModel 的 declaration merging（ctx.agentDefaultModel）
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type { MountedTool, PageSessionPort } from '@veren/page-registry'
import type { PageDataSyncFace } from './page-sync.ts'

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
 * 构造真实会话端口。`sessions` / `agents` 是声明过 inject 的宿主服务（本插件
 * 的属主面，经 declaration merging 的真实类型访问）：不做任何运行期结构探测，
 * 也不带"缺席即降级"分支——服务缺席是装配错误，由 inject 等待/fail loud 兜住。
 * @param ctx - 宿主上下文（读 `sessions` / `agents` 服务）
 * @param focus - focus 接缝（GUI 实现归 H）
 * @param sync - PAGE-DATA 注入面（缺省 = 不注入，页面保持静态）——G13：兄弟能力
 *   走参数，端口不自己摸装配层
 * @param sync - the PAGE-DATA injection face (absent → static pages); G13:
 *   sibling capabilities travel as parameters, the port never reaches for the assembly
 */
export function createRealSessionPort(ctx: Context, focus: FocusPort = eventFocus(ctx), sync?: PageDataSyncFace): PageSessionPort {
  const agentOf = (sessionId: string): Agent | undefined => ctx.agents.get(sid(sessionId))
  // 会话 → 该会话当前挂载的注销器（agent 作用域注销器，重挂/清理用）
  const mounted = new Map<string, Array<() => void>>()
  // 会话 → 本端口经 agents.create 拿到的句柄：只有持有者能整体拆除该 agent
  // / session → the handle from agents.create; only the holder can tear the agent down
  const handles = new Map<string, AgentHandle>()
  // 会话 → 等待 agent 激活的开场内容（PAGE/TASK/通知块）与工具；
  // agent/created 到达即按序落地——页面会话的内容随它的第一个 agent 开始存在
  const queued = new Map<string, { tools: readonly MountedTool[]; blocks: Array<{ source: string; text: string }> }>()

  const releaseMounted = (sessionId: string): void => {
    const disposers = mounted.get(sessionId)
    mounted.delete(sessionId)
    // 逆序释放；单个失败只影响该会话，不中断其余（§5.6 语义）
    for (const dispose of (disposers ?? []).reverse()) {
      try {
        dispose()
      } catch (error: unknown) {
        ctx.logger.warn(`app-host: releaseTools(${sessionId}) entry failed: ${String(error)}`)
      }
    }
  }

  const followup = (agent: Agent, text: string, source: string): void => {
    agent.followup(createUserMessage({
      content: [{ type: 'text', text }],
      source: { kind: sourceKind(source) },
    }))
  }

  /** 把一组工具与排队块挂进某个 agent 作用域（每次挂载即一次整组登记） */
  const mountOnAgent = (sessionId: string, agent: Agent, pending: { tools: readonly MountedTool[]; blocks: Array<{ source: string; text: string }> }): void => {
    releaseMounted(sessionId)
    const disposers: Array<() => void> = []
    for (const tool of pending.tools) disposers.push(agent.ctx.tools.register(tool))
    // 页面引导工具在页面会话作用域内屏蔽：页面会话已在页面之内，模型照 PAGE 块
    // 再调 app_open 打开同一 URL 会自激成"开页 → 新 agent → 再开页"的递归
    // （真机实测的会话雪崩）；这也是「页面工具只对该 agent 可见」作用域互斥的
    // 同一原则在引导工具方向的对称面。restrict 返回的注销器随挂载整组撤销。
    // Bootstrap tools are masked inside a page-session scope: the session is
    // already inside the page, and a model that follows the PAGE block by
    // calling app_open on the same url self-ignites the
    // "open page → new agent → open page" recursion (the live session
    // avalanche); this is the bootstrap-side twin of the "page tools are only
    // visible to their own agent" scope rule. The restriction disposer joins
    // the mounted set and is undone with it.
    disposers.push(agent.ctx.tools.restrict({ deny: ['app_open', 'app_list', 'app_pages'] }))
    // PAGE-DATA 注入器（§3.10.3）：挂在同一 agent 作用域——dsh-scope 过滤保证
    // 只有本会话的 pre-step 会送达它；注销器随挂载整组撤销。
    // The PAGE-DATA injector (§3.10.3): registered on the same agent scope —
    // dsh-scope filtering delivers only this session's pre-steps to it; the
    // disposer joins the mounted set.
    if (sync !== undefined) disposers.push(sync.attach(sessionId, agent))
    mounted.set(sessionId, disposers)
    for (const block of pending.blocks) followup(agent, block.text, block.source)
  }

  // agent 激活：等待队列里的页面工具此刻才真正挂上（只对该 agent 可见），
  // 排队的 PAGE/TASK/通知块按序 followup 进会话。
  // 事件与载荷走 dsh-agent 的 declaration merging 真实类型，无断言。
  ctx.on('agent/created', ({ agent }): undefined => {
    const sessionId = agent?.session?.id
    if (sessionId === undefined) return undefined
    const pending = queued.get(sessionId)
    if (pending === undefined) return undefined
    queued.delete(sessionId)
    mountOnAgent(sessionId, agent, pending)
    return undefined
  })
  // agent 销毁：作用域注册随 fiber 自动消失，这里只清登记；实时视图一并解绑
  // （外部拆除的 agent 不该留下孤儿视图订阅）。
  ctx.on('agent/disposed', ({ agent }) => {
    const sessionId = agent?.session?.id
    if (sessionId !== undefined) {
      mounted.delete(sessionId)
      handles.delete(sessionId)
      sync?.drop(sessionId)
    }
  })

  return {
    exists: (sessionId) => ctx.sessions.get(sid(sessionId)) !== undefined,
    mintId: () => crypto.randomUUID(),
    async create(sessionId, title) {
      // H 的根因修复：页面会话必须当场激活 agent（不再是"等用户进入"）。GUI
      // 侧栏按 blank（没有第一条 turn）隐藏非当前会话——不激活 agent，页面会话
      // 永远 blank，也就永远不可见、进不去，agent 永远不会被激活（死锁）。
      // agents.create 会连同创建会话并发布 agent/created；工具/开场块随后经
      // mountTools/appendUserMessage 落到这个活 agent 上，第一条 turn 随之提交。
      // The root-cause fix: a page session activates its agent right away (no
      // more "wait until the user enters"). The GUI sidebar hides non-current
      // blank sessions — without an agent the page session stays blank forever,
      // so it can never be seen or entered and its agent can never activate
      // (a deadlock). agents.create publishes the session and agent/created;
      // tools and opening blocks then land on the live agent via
      // mountTools/appendUserMessage and the first turn commits.
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
      const handle = await ctx.agents.create({
        sessionId: sid(sessionId),
        agentOptions: { provider: selected.provider, model: selected.model },
        meta: { cwd: process.cwd(), agentPreset: 'standard' },
      })
      handles.set(sessionId, handle)
      // instanceTitle 是页面实例的权威标题（§3.6.1）：立即落成 user source 的
      // session/title（空 messageSeqs 恰好是 user 标题的合法形状）——侧栏按它
      // 显示「发布任务」「主题 #12」，且不会被标题 LLM 事后改写。
      // instanceTitle is the page instance's authoritative title (§3.6.1): land
      // it now as a user-source session/title (empty messageSeqs is exactly the
      // legal user-title shape) — the sidebar shows it and the title LLM never
      // rewrites it.
      ctx.sessions.get(sid(sessionId))?.append('session/title', { title, messageSeqs: [], source: { kind: 'user' } })
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
        }))
        return
      }
      const agent = agentOf(sessionId)
      if (agent !== undefined) {
        followup(agent, text, source)
        const flushed = await ctx.sessions.flush(agent.session)
        if (flushed === false) {
          ctx.logger.warn(`app-host: session ${sessionId} did not flush the "${source}" block`)
        }
        return
      }
      // agent 未激活：入队，随 agent/created 与工具一起落地（页面会话的内容
      // 随它的第一个 agent 开始存在）
      const pending = queued.get(sessionId) ?? { tools: [], blocks: [] }
      pending.blocks.push({ source, text })
      queued.set(sessionId, pending)
    },
    async mountTools(sessionId, tools) {
      const agent = agentOf(sessionId)
      if (agent !== undefined) {
        // 活 agent：直接挂 agent 作用域——只有该 agent 可见，销毁随 fiber 释放
        mountOnAgent(sessionId, agent, { tools, blocks: [] })
        return
      }
      // agent 未激活（打开时用户尚未进入会话）：入队，agent/created 到达即挂上
      const pending = queued.get(sessionId) ?? { tools: [], blocks: [] }
      queued.set(sessionId, { tools, blocks: pending.blocks })
    },
    async releaseTools(sessionId) {
      const pending = queued.get(sessionId)
      queued.set(sessionId, { tools: [], blocks: pending?.blocks ?? [] })
      releaseMounted(sessionId)
    },
    focus: (sessionId) => focus.focus(sessionId),
    // 页面会话的预设 id（§3.10.3 PageLoadEnv.preset）：与会话头同源——页面工具
    // 解析调用者（如 notebook callerOf）读的就是 header.agentPreset，两条路径
    // 口径一致，load 看到的归属与工具调用看到的归属不会分叉。
    // The page session's preset id (§3.10.3's PageLoadEnv.preset): sourced from
    // the session header — the same field page tools read their caller from
    // (e.g. notebook's callerOf), so what load sees as the owner never drifts
    // from what a tool call sees.
    presetOf: (sessionId) => ctx.sessions.get(sid(sessionId))?.header.agentPreset,
    async destroy(sessionId) {
      queued.delete(sessionId)
      releaseMounted(sessionId)
      // 半成品会话不该留下视图订阅（bind 可能已在 commit 前发生；幂等）
      // / a half-built session must not leave a view subscription behind (bind
      // may have happened before commit; idempotent)
      sync?.drop(sessionId)
      // 半成品兜底路径（页面创建失败回滚）：整只拆除本端口创建的 agent——
      // 句柄持有者才有资格 dispose，失败的会话不该留下活 agent。
      // Half-built rollback path (page-create failure): tear down the agent this
      // port created — only the handle holder may dispose; a failed session
      // must not leave a live agent behind.
      const handle = handles.get(sessionId)
      if (handle === undefined) return
      handles.delete(sessionId)
      try {
        await handle.dispose()
      } catch (error: unknown) {
        ctx.logger.warn(`app-host: dispose(${sessionId}) failed: ${String(error)}`)
      }
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
    /**
     * A PAGE-DATA view sync appended at pre-step (§3.10.2). The agent loop
     * commits decision messages itself, so the block lands as a user message.
     * @persistenceSource user
     */
    'page/data': { kind: 'page/data' }
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
