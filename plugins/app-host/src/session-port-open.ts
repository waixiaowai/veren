/**
 * 页面会话的创建路径（`PageSessionPort.create` 的实体）：选默认模型 → 定工作区
 * → 建会话并当场激活 agent → 应用页面作用域屏蔽 → 登记工作区归属 → 落权威标题。
 * The page session's create path (the body of `PageSessionPort.create`): pick
 * the default model → resolve the workspace → create the session and activate
 * its agent right away → apply the page-scope masking → record the workspace
 * membership → land the authoritative title.
 * @module @veren/app-host/session-port-open
 */
import type { Context } from '@deepseek-ai/cordis'
// 类型-only import：拉取 ctx.agentDefaultModel 的 declaration merging（部署默认模型选型）
// type-only import: pulls the ctx.agentDefaultModel declaration merge (the deployment default model)
import type {} from '@deepseek-ai/dsh-agent-default-model'
// 类型-only import：拉取 ctx.tools（restrict 的实际服务面来源）；不能靠间接 merge。
// type-only import: declares ctx.tools — the actual service face behind restrict. Never transitive.
import type {} from '@deepseek-ai/dsh-tools'
// 类型-only import：拉取 session/title 事件的 SessionEventMap merge（权威标题落盘用）
// type-only import: pulls the session/title event's SessionEventMap merge (authoritative title persistence)
import type {} from '@deepseek-ai/dsh-session-title'
// 类型-only import：拉取 ctx.agents / ctx.sessions 的 declaration merging。
// type-only import: pulls the ctx.agents / ctx.sessions declaration merges.
import type {} from '@deepseek-ai/dsh-agent'
import type { AgentHandles } from './session-port-handles.ts'
import { sid } from './session-id.ts'
import { pageSessionWorkspace } from './session-workspace.ts'

/**
 * H 的根因修复：页面会话必须当场激活 agent（不再是"等用户进入"）。GUI 侧栏按
 * blank（没有第一条 turn）隐藏非当前会话——不激活 agent，页面会话永远 blank，
 * 也就永远不可见、进不去，agent 永远不会被激活（死锁）。agents.create 会连同
 * 创建会话并发布 agent/created；组件体的唯一一次渲染随之落到这个活 agent 上，
 * 第一条 turn 随之提交。
 * The root-cause fix: a page session activates its agent right away (no more
 * "wait until the user enters"). The GUI sidebar hides non-current blank
 * sessions — without an agent the page session stays blank forever, so it can
 * never be seen or entered and its agent can never activate (a deadlock).
 * agents.create publishes the session and agent/created; the body's one render
 * then lands on this live agent, and the first turn commits.
 *
 * 各步依据（inline 注释的完整版）：
 * - 模型：agentOptions.model 来自部署默认模型（agentDefaultModel）——agent-loop
 *   用 agent.options.model 注册 {{model}} 提示变量，不给模型则 deployment
 *   persona 段的插值首回合即失败（真机实测）；与 webhook 会话创建
 *   （experimental/webhook/src/session.ts）同一选型路径。
 * - 工作区：cwd 决定候选匹配、attachSession 记候选表，两者缺一都落「未分组」；
 *   注册表为空退回进程 cwd，仍可开会话。
 * - 屏蔽：页面会话已在页面之内，app_open/app_list/app_pages 对本 agent 隐藏——
 *   模型照 PAGE 块再调 app_open 打开同一 URL 会自激成"开页 → 新 agent → 再开页"
 *   的递归（真机实测的会话雪崩）；屏蔽随 agent fiber 生灭，无需单独释放。
 * - 标题：instanceTitle 是页面实例的权威标题（§3.6.1），立即落成 user source
 *   的 session/title（空 messageSeqs 恰好是 user 标题的合法形状）——侧栏按它
 *   显示，且不会被标题 LLM 事后改写。
 * Rationale per step (full versions of the inline comments):
 * - model: from the deployment default (agentDefaultModel) — the agent loop
 *   registers {{model}} from agent.options.model; without it the deployment
 *   persona's interpolation fails on the first turn (live-tested); same path as
 *   the webhook session creation.
 * - workspace: the cwd drives candidate matching and attachSession writes the
 *   candidate account; either missing lands in "ungrouped"; an empty registry
 *   falls back to the process cwd so the open still works.
 * - masking: the session is already inside the page, so app_open / app_list /
 *   app_pages are hidden — following the PAGE block by re-opening the same url
 *   would self-ignite the "open page → new agent → open page" recursion (the
 *   live session avalanche); the masking dies with the agent fiber.
 * - title: instanceTitle is the authoritative title (§3.6.1), landed now as a
 *   user-source session/title (empty messageSeqs is the legal user-title shape)
 *   — the sidebar shows it and the title LLM never rewrites it.
 * @param ctx - 宿主上下文（读 sessions / agents / agentDefaultModel）。
 * @param handles - 句柄表（新句柄登记，废弃/回滚路径据此整体拆除）。
 * @param sessionId - 页面实例的会话 id / the page instance's session id
 * @param title - 实例权威标题（§3.6.1）/ the instance's authoritative title
 */
export async function openPageSession(ctx: Context, handles: AgentHandles, sessionId: string, title: string): Promise<void> {
  const selected = ctx.agentDefaultModel.currentSelection()
  const workspace = await pageSessionWorkspace(ctx)
  const handle = await ctx.agents.create({
    sessionId: sid(sessionId),
    agentOptions: { provider: selected.provider, model: selected.model },
    meta: { cwd: workspace?.path ?? process.cwd(), agentPreset: 'standard' },
  })
  handles.hold(sessionId, handle)
  // 页面作用域屏蔽（见 JSDoc）：随 agent fiber 生灭 / page-scope masking (see JSDoc): dies with the fiber
  handle.agent.ctx.tools.restrict({ deny: ['app_open', 'app_list', 'app_pages'] })
  if (workspace !== undefined) {
    // 归属失败不阻断开页（会话已建好），但必须留痕 / a failed attach logs but never aborts the open
    await workspace.attachSession(sid(sessionId)).catch((error: unknown) => {
      ctx.logger.warn(`app-host: page session ${sessionId} could not join workspace "${workspace.id}": ${String(error)}`)
    })
  }
  ctx.sessions.get(sid(sessionId))?.append('session/title', { title, messageSeqs: [], source: { kind: 'user' } })
}
