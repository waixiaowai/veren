/**
 * 真实会话端口：把 page-registry 对 DSH 会话机制的假设接到真实宿主面上
 * （`ctx.sessions` / `ctx.agents`）。本文件是会话端口域的门面：对外符号在这里
 * re-export，端口本体由职责域文件组装——
 * - focus 接缝：{@link ./focus-port.ts}（FocusPort / eventFocus / loggingFocus）；
 * - 消息源 kind：{@link ./message-source.ts}（白名单 + MessageSourceMap merge）；
 * - 页面身份 + 重挂：{@link ./page-identity.ts}（system prompt 层身份）；
 * - 工作区落点：{@link ./session-workspace.ts}；
 * - 句柄表：{@link ./session-port-handles.ts}；
 * - 创建路径：{@link ./session-port-open.ts}。
 * The real session port: binds page-registry's session assumptions to the real
 * host services (`ctx.sessions` / `ctx.agents`). This file is the session-port
 * domain's facade: public symbols re-export here while the port itself is
 * assembled from responsibility files (see the links above).
 *
 * 端口语义（保持不变）：一次性渲染（组件体在 create 激活的 agent 身上执行恰好
 * 一次，工具由组件体直登、随 agent fiber 生灭）；create 当场应用页面作用域屏蔽
 * （app_open/app_list/app_pages 的 deny）；retire/destroy = 整体 dispose 句柄；
 * 消息经 `agent.followup` + `ctx.sessions.flush` 确认。
 * Port semantics (unchanged): one-shot render; page-scope masking at create;
 * retire/destroy dispose the handle whole; messages ride `agent.followup` +
 * `ctx.sessions.flush`.
 * @module @veren/app-host/session-port
 */
import { scopeOf } from '@deepseek-ai/dsh-scope'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
// 运行时导入：页面会话 agent 缺 skills 服务面时的真面兜底（见 resolvePageAgent 注释）。
// runtime import: the real-face fallback when a page-session agent lacks the skills service.
import { SkillRegistry } from '@deepseek-ai/dsh-skill'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
// 类型-only import：拉取 ctx.tools（toolFace 的 schemas 读它）；不靠间接 merge。
// type-only import: declares ctx.tools — the schemas face behind toolFace. Never transitive.
import type {} from '@deepseek-ai/dsh-tools'
import type { PageSessionPort, PageToolEntry } from '@veren/page-registry'
import { eventFocus } from './focus-port.ts'
import type { FocusPort } from './focus-port.ts'
import { sourceKind } from './message-source.ts'
import { remountPageAgent } from './page-identity.ts'
import { sid } from './session-id.ts'
import { createAgentHandles } from './session-port-handles.ts'
import type { AgentHandles } from './session-port-handles.ts'
import { openPageSession } from './session-port-open.ts'

// ---- 门面再出口：index.ts 与既有内部导入方从这里取公开符号 ----
// ---- Facade re-exports: index.ts and existing internal importers take the public symbols here ----
export { eventFocus, loggingFocus } from './focus-port.ts'
export type { FocusPort, FocusEventPayload } from './focus-port.ts'
export { PAGE_MESSAGE_SOURCE, TASK_MESSAGE_SOURCE, NOTICE_MESSAGE_SOURCE, PAGE_SEND_MESSAGE_SOURCE } from './message-source.ts'

/**
 * 该会话的活 agent；页面会话 agent 作用域由宿主会话机制创建，而 preset realm
 * 把 skills **隔离**了：属性访问 `agent.ctx.skills` 重定向进隔离子域（页面会话
 * 里是空的），`get('skills')` 却读主链——两条通道不同，单靠 get 判断会漏（真机
 * 实测：get 返回已提供、属性访问照样 fail loud）。这里以属性探测为准：抛错
 * 就把一个真正的 SkillRegistry 挂进隔离子域——单会话 runtime skill 本就该
 * 会话私有，随 agent fiber 生灭，绝不泄漏到别的会话；属性访问本已成功的
 * 部署（宿主组合提供了该面）什么都不做、绝不遮蔽。
 * Resolve the session's live agent. The page-session agent scope is created by
 * the host session machinery, and the preset realm **isolates** skills: the
 * property access `agent.ctx.skills` redirects into the isolate child (empty
 * for a page session) while `get('skills')` reads the main chain — two
 * different channels, so a get-based check misses it (verified live). Probe the
 * property instead: on throw, mount a real SkillRegistry into the isolate —
 * session-private by definition, lives and dies with the agent fiber, never
 * leaks. Where the property already resolves, do nothing and never shadow it.
 */
function resolvePageAgent(ctx: Context, sessionId: string): Agent | undefined {
  const agent = ctx.agents.get(sid(sessionId))
  if (agent === undefined) return undefined
  try {
    void agent.ctx.skills
  } catch {
    new SkillRegistry(agent.ctx.isolate('skills'))
  }
  return agent
}

/** 该 agent 作用域当前可见的工具面（名字 + 用途描述）/ the tool face currently visible in the agent's scope */
function toolFaceOf(agent: Agent): readonly PageToolEntry[] {
  return agent.ctx.tools.schemas(scopeOf(agent.ctx)).map((schema) => ({ name: schema.name, description: schema.description }))
}

/** 经 followup 投递一条消息（source 收窄成白名单 kind）/ push one message via followup (source narrowed to a whitelisted kind) */
function followupAgent(agent: Agent, text: string, source: string): void {
  agent.followup(createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: sourceKind(source) },
  }))
}

/**
 * appendUserMessage 的实体。wake=false（§3.9 唤醒策略的可选面）：只把消息落
 * 会话日志，不 followup、不产生模型回合；目标 agent 下一次被唤醒时一并消费。
 * 唤醒路径：页面会话在 create 时即激活 agent，没有"等 agent"的分支——缺席是
 * 装配错误，fail loud；followup 后 `sessions.flush` 确认落盘（forum 的投递纪律）。
 * The body of appendUserMessage. wake=false (§3.9): land the message in the log
 * only — no followup, no model round. The wake path: a page session activates
 * its agent at create, so a miss is an assembly error and fails loud; after the
 * followup, `sessions.flush` confirms the landing (the forum delivery
 * discipline).
 */
async function deliverUserMessage(
  ctx: Context,
  sessionId: string,
  text: string,
  source: string,
  options?: { readonly wake?: boolean },
): Promise<void> {
  if (options?.wake === false) {
    ctx.sessions.get(sid(sessionId))?.append('user/message', createUserMessage({
      content: [{ type: 'text', text }],
      source: { kind: sourceKind(source) },
    }), { surfaceOp: 'append' })
    return
  }
  const agent = resolvePageAgent(ctx, sessionId)
  if (agent === undefined) {
    throw new Error(`app-host: appendUserMessage(${sessionId}) found no active agent`)
  }
  followupAgent(agent, text, source)
  const flushed = await ctx.sessions.flush(agent.session)
  if (flushed === false) {
    ctx.logger.warn(`app-host: session ${sessionId} did not flush the "${source}" block`)
  }
}

/**
 * agent/created 的监听体：重挂 + 身份必须**异步等待**完成再放行——重挂含存储
 * 读与组件体渲染，fire-and-forget 会与首回合的工具清单组装竞速（真机反例
 * 2.0.6：旧会话重挂没赶上首个 LLM 调用，forum__list 报 unknown tool）。
 * serial 契约：监听器返回 undefined 即放行。
 * The agent/created listener body: the remount + identity must be **awaited**
 * before passing — the remount does storage reads plus a body render, and a
 * fire-and-forget races the first turn's tool-list assembly (live
 * counter-example 2.0.6). Serial contract: returning undefined passes.
 */
async function onAgentCreated(ctx: Context, agent: Agent): Promise<undefined> {
  const sessionId = agent.session?.id
  if (sessionId !== undefined) await remountPageAgent(ctx, agent)
  return undefined
}

/**
 * 生命周期监听（创建 + 销毁）的注册。
 * `global` 是硬要求,不是风格选择:agent/created 与 agent/disposed 经 dsh-scope
 * 的 scopeTarget 载体派发,载体保留 agent(服务)自身的 isolate baseFilter——注册
 * 在装配 ctx(根域)上的普通监听器会被过滤器排除,事件一次都到不了这里。真机
 * 反例(2.0.8):五个新建页面会话 + 两次重启恢复,重挂与身份一次都没触发,而单测
 * 里裸 ctx 派发次次通过。{ global: true } 让监听器无视载体过滤接收每一次派发;
 * 不加 global 的 disposed 监听器同样收不到,句柄表会只增不减。
 * Register the lifecycle listeners (created + disposed). `global` is a hard
 * requirement: both events dispatch through a dsh-scope scopeTarget carrier
 * that preserves the agent's (service) isolate baseFilter — a plain root-realm
 * listener is filtered out and never sees the event (live counter-example
 * 2.0.8: zero remount/identity firings across five fresh sessions and two
 * resumes, while unit tests dispatching on a bare ctx passed every time).
 * Without global the disposed listener would miss everything too and the
 * handle table would only ever grow.
 */
function watchAgentLifecycle(ctx: Context, handles: AgentHandles): void {
  ctx.on('agent/created', async ({ agent }) => onAgentCreated(ctx, agent), { global: true })
  // agent 销毁：句柄登记清理（作用域注册已随 fiber 自动消失）。
  // Agent disposal: drop the handle entry (scope registrations already died with the fiber).
  ctx.on('agent/disposed', ({ agent }) => {
    const sessionId = agent?.session?.id
    if (sessionId !== undefined) handles.drop(sessionId)
  }, { global: true })
}

/**
 * 构造真实会话端口。`sessions` / `agents` 是声明过 inject 的宿主服务（本插件
 * 的属主面，经 declaration merging 的真实类型访问）：不做任何运行期结构探测，
 * 也不带"缺席即降级"分支——服务缺席是装配错误，由 inject 等待/fail loud 兜住。
 * Build the real session port. `sessions` / `agents` arrive through declared
 * inject + the declaration-merged real types: no runtime structural probing,
 * no "degrade when absent" branches — a missing service is an assembly error,
 * caught by the inject wait / fail-loud.
 * @param ctx - 宿主上下文（读 `sessions` / `agents` 服务）
 * @param focus - focus 接缝（GUI 实现归 H）
 */
export function createRealSessionPort(ctx: Context, focus: FocusPort = eventFocus(ctx)): PageSessionPort {
  const handles = createAgentHandles(ctx)
  watchAgentLifecycle(ctx, handles)
  return {
    exists: (sessionId) => ctx.sessions.get(sid(sessionId)) !== undefined,
    // 页面组件体的唯一载体：该会话的活 agent；登记随 agent fiber 生灭。
    // The sole carrier of the page body: the session's live agent; registrations live and die with the fiber.
    agentOf: (sessionId) => resolvePageAgent(ctx, sessionId),
    toolFace: (sessionId) => {
      const agent = resolvePageAgent(ctx, sessionId)
      return agent === undefined ? [] : toolFaceOf(agent)
    },
    mintId: () => crypto.randomUUID(),
    // 建会话即激活 agent（实体在 session-port-open.ts）/ create = activate right away (body in session-port-open.ts)
    create: (sessionId, title) => openPageSession(ctx, handles, sessionId, title),
    // 废弃路径（§3.5.3）：整只拆除，日志保留可读 / deprecation: tear down whole, log stays readable
    retire: (sessionId) => handles.dispose(sessionId),
    appendUserMessage: (sessionId, text, source, options) => deliverUserMessage(ctx, sessionId, text, source, options),
    focus: (sessionId) => focus.focus(sessionId),
    // 半成品兜底（创建失败回滚）：失败会话不留活 agent / half-built rollback: no live agent left behind
    destroy: (sessionId) => handles.dispose(sessionId),
  }
}
