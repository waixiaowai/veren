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
// 运行时导入：页面会话 agent 缺 skills 服务面时的真面兜底（见 agentOf 内注释）。
// runtime import: the real-face fallback when a page-session agent lacks the
// skills service (see the comment inside agentOf).
import { SkillRegistry } from '@deepseek-ai/dsh-skill'
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
  const agentOf = (sessionId: string): Agent | undefined => {
    const agent = ctx.agents.get(sid(sessionId))
    if (agent === undefined) return undefined
    // 页面会话的 agent 作用域由宿主会话机制创建，而 preset realm 把 skills
    // **隔离**了：属性访问 `agent.ctx.skills` 重定向进隔离子域（页面会话里是
    // 空的），`get('skills')` 却读主链——两条通道不同，单靠 get 判断会漏（真机
    // 实测：get 返回已提供、属性访问照样 fail loud）。这里以属性探测为准：抛错
    // 就把一个真正的 SkillRegistry 挂进隔离子域——单会话 runtime skill 本就该
    // 会话私有，随 agent fiber 生灭，绝不泄漏到别的会话；属性访问本已成功的
    // 部署（宿主组合提供了该面）什么都不做、绝不遮蔽。
    // The page-session agent scope is created by the host session machinery, and
    // the preset realm **isolates** skills: the property access
    // `agent.ctx.skills` redirects into the isolate child (empty for a page
    // session) while `get('skills')` reads the main chain — two different
    // channels, so a get-based check misses it (verified live: get reports the
    // face as provided while the property access still fails loud). Probe the
    // property instead: on throw, mount a real SkillRegistry into the isolate —
    // a single-session runtime skill is session-private by definition, lives and
    // dies with the agent fiber, and never leaks into other sessions. Where the
    // property already resolves (the host composition provides the face), do
    // nothing and never shadow it.
    try {
      void agent.ctx.skills
    } catch {
      new SkillRegistry(agent.ctx.isolate('skills'))
    }
    return agent
  }

  /**
   * 页面身份系统提示（组装期动态解析）：agent 创建时查页面实例行——新会话与重启后
   * 再激活的老会话走同一条 agent/created 接缝,同等获得身份;非页面会话不注册。
   * 真机反例:页面会话模型曾无视页面工具,去文件系统寻找业务数据(先扫了用户 home
   * 的错误 home!),一回合烧约 40 万 token——根因是页面身份只以一条消息存在,权重
   * 压不过宿主编码人设的 system prompt。这里把身份与自治协议提升到 system prompt
   * 层,按 agent 作用域注册(随 fiber 生灭,不泄漏到别的会话)。
   * The page-identity system prompt (resolved dynamically at assembly): on agent
   * creation we look up the page instance row — fresh sessions and old sessions
   * re-activated after a restart share the same agent/created seam, so both get
   * the identity; non-page sessions register nothing. Live counter-example: a
   * page-session model ignored its page tools and went filesystem-diving for
   * business data (scanning the wrong user home first!), burning ~400K tokens in
   * one turn — the page identity existed only as one message, outweighed by the
   * host's coding-persona system prompt. This lifts the identity and the
   * autonomy protocol into the system prompt, scoped to the agent (dies with the
   * fiber, never leaks into other sessions).
   */
  const attachPageIdentity = async (agent: Agent): Promise<void> => {
    const sessionId = agent.session?.id
    if (sessionId === undefined) return
    try {
      for (const app of ctx.apps.catalog()) {
        const rows = await ctx.pageRegistry.instances.listByApp(app.definition.id)
        // live 之外也认 reserved:新建路径的 agent/created 触发在两阶段创建的
        // reserve 与 commit 之间,此刻行还是 reserved——只认 live 会让新会话永远
        // 拿不到身份(真机 2.0.8:三个新建页面会话日志零身份块)。reserved 行若
        // 最终创建失败,agent 随 fiber 消亡,身份注册随之拆除,不会泄漏。
        // Match reserved rows as well as live ones: on the fresh-create path
        // agent/created fires between the two-phase reserve and commit, so the
        // row is still reserved there — a live-only match left fresh sessions
        // permanently unbadged (live 2.0.8: three fresh page sessions, zero
        // identity blocks in their logs). If the create ultimately fails, the
        // agent dies with its fiber and the registration unwinds — no leak.
        const row = rows.find((candidate) => candidate.sessionId === sessionId && (candidate.state === 'live' || candidate.state === 'reserved'))
        if (row === undefined) continue
        agent.ctx.systemPrompt.context({
          name: 'APP_HOST_PAGE_IDENTITY',
          // WORKING_DIRECTORY(100) 之后:页面会话的工作目录只是宿主开发工作区,与本页任务无关。
          // After WORKING_DIRECTORY(100): a page session's cwd is the host dev workspace, unrelated to the page task.
          order: 105,
          interpolate: false,
          text: [
            `页面会话身份:你当前在应用页面 ${row.url}(应用 ${app.definition.id})上工作。`,
            '- 本页挂载的工具是你操作业务数据的唯一正道:业务数据不在工作区文件里。禁止用文件系统、终端、命令行或阅读源码的方式寻找业务数据、存储位置或工具实现。',
            '- 工作目录只是宿主开发工作区,与本页任务无关。',
            '- 任务与业务 id 属于各自模块的命名空间(如任务工作台的 t-N 与任务中心的 task-*),不可混用。',
            '- 行动前先用页面工具读取事实;页面说明(PAGE 块)与本说明冲突时,以页面工具的返回为准。',
          ].join('\n'),
        })
        return
      }
    } catch (error: unknown) {
      // 身份注入失败不阻断 agent 创建:页面 PAGE 块仍在,只是少了 system 层加固。
      // A failed identity injection must not block agent creation: the PAGE block
      // still rides, only the system-level hardening is missing.
      ctx.logger.warn(`app-host: page identity for ${sessionId} failed: ${String(error)}`)
    }
  }
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

  // agent 创建即挂页面身份 + 重挂页面工具面:新建与重启后再激活的老会话都经
  // 这条接缝。serial 契约:同步监听器返回 undefined 即放行;身份挂载与重挂异步
  // 进行、绝不阻塞创建链。重挂专治真机反例:一次性渲染绑定原始 fiber,重启后
  // 重建的 agent 没有页面工具面,模型只能靠通用工具 improvising(40 万 token 的
  // 文件系统探查)。reserved 行在两阶段创建中会被 rerender 幂等跳过,新会话的
  // 正常渲染不会因此双重执行。
  // Attach the page identity AND remount the page tool face on agent creation:
  // fresh sessions and old sessions re-activated after a restart share this
  // seam. Serial contract: a sync listener returning undefined passes; the
  // attach and remount run asynchronously and never block the creation chain.
  // The remount answers the live counter-example: the one-shot render is bound
  // to the original fiber, so a recreated agent carried no page tool face and
  // the model improvised with generic tools (~400K tokens of filesystem
  // probing). Reserved rows are idempotently skipped by rerender (mid two-phase
  // create), so a fresh session's normal render never double-runs.
  //
  // global 是硬要求,不是风格选择:agent/created 经 dsh-scope 的 scopeTarget 载体
  // 派发,载体保留 agent(服务)自身的 isolate baseFilter——注册在装配 ctx(根域)
  // 上的普通监听器会被过滤器排除,事件一次都到不了这里。真机反例(2.0.8):五个
  // 新建页面会话 + 两次重启恢复,重挂与身份一次都没触发(会话日志零 APP_HOST_
  // PAGE_IDENTITY、恢复回合首调用 unknown tool),而单测里裸 ctx 派发次次通过。
  // { global: true } 让本监听器无视载体过滤接收每一次 agent 创建。
  // `global` is a hard requirement, not a style choice: agent/created dispatches
  // through a dsh-scope scopeTarget carrier that preserves the agent's (service)
  // isolate baseFilter — a plain listener registered on the assembly ctx (the
  // root realm) is filtered out and never sees the event. Live counter-example
  // (2.0.8): across five fresh page sessions and two post-restart resumes the
  // remount and identity never fired (zero APP_HOST_PAGE_IDENTITY in session
  // logs, unknown-tool on the first resumed call), while unit tests dispatching
  // on a bare ctx passed every time. { global: true } makes this listener
  // receive every agent creation regardless of the carrier's filter.
  ctx.on('agent/created', async ({ agent }) => {
    const sessionId = agent.session?.id
    if (sessionId !== undefined) {
      // agent/created 是 serial 事件(创建链 await 监听器):监听器必须**异步等待**
      // 重挂与身份完成再放行——重挂含存储读与组件体渲染,fire-and-forget 会与
      // 首回合的工具清单组装竞速(真机反例:2.0.6 上旧会话重挂没赶上首个 LLM
      // 调用,forum__list 报 unknown tool)。reserved 行会被 rerender 幂等跳过,
      // 新会话的正常渲染不会因此双重执行。
      // agent/created is a serial event (the creation chain awaits its
      // listeners): the listener must await the remount and identity before
      // passing — the remount does storage reads plus a body render, and a
      // fire-and-forget races the first turn's tool-list assembly (live
      // counter-example on 2.0.6: an old session's remount missed the first LLM
      // call and forum__list came back unknown tool). Reserved rows are
      // idempotently skipped by rerender, so a fresh session's normal render
      // never double-runs.
      try {
        await ctx.pageRegistry.rerender(sessionId, agent)
      } catch (error: unknown) {
        ctx.logger.warn(`app-host: page rerender for ${sessionId} failed: ${String(error)}`)
      }
      await attachPageIdentity(agent)
    }
    return undefined
  }, { global: true })

  /** 该 agent 作用域当前可见的工具面（名字 + 用途描述）/ the tool face currently visible in the agent's scope */
  const toolFaceOf = (agent: Agent): readonly PageToolEntry[] =>
    agent.ctx.tools.schemas(scopeOf(agent.ctx)).map((schema) => ({ name: schema.name, description: schema.description }))

  const followup = (agent: Agent, text: string, source: string): void => {
    agent.followup(createUserMessage({
      content: [{ type: 'text', text }],
      source: { kind: sourceKind(source) },
    }))
  }

  // agent 销毁：句柄登记清理（作用域注册已随 fiber 自动消失）。agent/disposed
  // 与 agent/created 走同一个 scopeTarget 载体派发——不加 global，根域监听器
  // 同样一个事件都收不到，句柄表会只增不减。
  // Agent disposal: drop the handle entry (scope registrations already died
  // with the fiber). agent/disposed dispatches through the same scopeTarget
  // carrier as agent/created — without global this root-realm listener sees
  // nothing either, and the handle table would only ever grow.
  ctx.on('agent/disposed', ({ agent }) => {
    const sessionId = agent?.session?.id
    if (sessionId !== undefined) handles.delete(sessionId)
  }, { global: true })

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
