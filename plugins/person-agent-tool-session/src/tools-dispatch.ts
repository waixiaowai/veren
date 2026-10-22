// 会话派发工具：把提示投进目标会话后立即返回；目标静止后由 watch.ts 的看守
// 把收尾输出作为结算通知投回调用方。它取代了会阻塞的 session_prompt。
// Session dispatch tool: deliver a prompt into a target and return at once; the
// guard in watch.ts reports the closing output once the target is quiescent. It
// replaces the blocking session_prompt.
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { Context } from '@deepseek-ai/cordis'
import { emitAgentEvent } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
// 类型-only import：拉取 agents 与 sessionController 的 Context 声明合并。
// Type-only imports: pull the agents and sessionController Context declaration merging.
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import { createDispatchPrompt } from './notice.js'
import { guardRemovedCwd, resolveWorkspaceId } from './tools-management.js'
import { SessionToolError } from './types.js'
import type { NewSessionArgs, SessionDispatchArgs, SessionDispatchResult } from './types.js'
import type { SettlementWatch } from './watch.js'

/** 工具描述共用提示：session id 从 workspace_session_list 查；workspace id 从页面正文的 Workspace List 取。
 * / shared description hint: session ids come from workspace_session_list; workspace ids from the page's Workspace List. */
const HINT = 'Session ids come from the workspace_session_list tool; workspace ids come from the page\'s Workspace List.'

/**
 * 返回指导：只有目标确实能回话时才追加。
 * Return guidance: appended only when the target can actually reply.
 *
 * 为什么必须双重把关：`send_message` 只允许**相邻血统**（发信人是目标的直属可续子级，
 * 或收信人是发信人的直属父级），而普通的派发目标是一个没有父级血统的普通会话——
 * 对它说"用 send_message 回报"就是让它去调用一个必然被拒的工具。因此这里确认两件事：
 * 该工具在目标作用域里可见，且目标的 `parentSession` 正是调用方（只有这种血统才能
 * 让 `SubagentManager.sendMessage` 认账）。
 * Why the double gate: `send_message` permits only **adjacent lineage** (the sender
 * is the target's direct continuable child, or the recipient is the sender's
 * direct parent), while an ordinary dispatch target is a root session with no
 * parent lineage - telling it to "report back with send_message" would send it to
 * a tool that must refuse. So this confirms two things: the tool is visible in the
 * target's scope, and the target's `parentSession` is exactly the caller (the only
 * lineage `SubagentManager.sendMessage` honours).
 *
 * 文本与官方 `withContinuableReturnGuidance` 一致。
 * The text matches the official `withContinuableReturnGuidance`.
 * @param ctx - 宿主上下文。The host context.
 * @param callerSessionId - 调用方会话 id。The caller session id.
 * @param target - 目标 Agent。The target Agent.
 * @returns 指导块，不适用时 undefined。The guidance block, or undefined when it does not apply.
 */
function returnGuidance(ctx: Context, callerSessionId: SessionId, target: Agent): ContentBlock | undefined {
  if (ctx.tools.get('send_message', target) === undefined) return undefined
  if (target.session.header.parentSession !== callerSessionId) return undefined
  const encoded = JSON.stringify(callerSessionId)
  return {
    type: 'text',
    text: `Your parent agent id is ${encoded}. Before you finish, send your result to that agent with `
      + `send_message({ agent_id: ${encoded}, message: "<self-contained result>" }). The parent shares `
      + 'your workspace but does not automatically receive your transcript, tool output, or reasoning. Send '
      + 'earlier messages as well when a finding changes what the parent should do next; sending a message '
      + 'does not end your turn.',
  }
}

/**
 * 校验提示文本：去空白后必须非空。Prompt validation: non-empty after trimming.
 * @param prompt - 原始输入。The raw input.
 * @returns 去空白后的提示。The trimmed prompt.
 */
export function requirePrompt(prompt: string): string {
  const trimmed = prompt.trim()
  if (trimmed === '') {
    throw new SessionToolError('SESSION_DISPATCH_PROMPT_EMPTY', 'prompt must be a non-empty string', { prompt })
  }
  return trimmed
}

/**
 * 解析或新建目标会话 id；sessionId 与 newSession 必须二选一。
 * Resolve or create the target session id; exactly one of sessionId and
 * newSession is required.
 * @param ctx - 宿主上下文。The host context.
 * @param args - 工具参数。The tool arguments.
 * @param callerSessionId - 调用方会话 id，用于继承工作区。The caller session id, used to inherit the workspace.
 * @returns 目标会话 id。The target session id.
 */
async function resolveTarget(
  ctx: Context,
  args: SessionDispatchArgs,
  callerSessionId: SessionId,
): Promise<SessionId> {
  const sessionId = args.sessionId?.trim() ?? ''
  const created = args.newSession
  if (sessionId !== '' && created !== undefined) {
    throw new SessionToolError(
      'SESSION_DISPATCH_TARGET_CONFLICT',
      'provide either sessionId or newSession, not both',
      { sessionId, newSession: created },
    )
  }
  if (sessionId === '' && created === undefined) {
    throw new SessionToolError('SESSION_DISPATCH_TARGET_MISSING', 'provide sessionId or newSession', {})
  }
  if (created === undefined) return SessionId(sessionId)
  return await createTarget(ctx, created, callerSessionId)
}

/**
 * 新建目标会话；工作区由共享解析器决定，失败收敛成稳定的创建错误。
 * Create the target session; the shared resolver owns the workspace and failures
 * collapse into a stable create error.
 *
 * workspaceId 直接指定工作区；省略时继承调用方会话的工作区。session_create
 * 与本工具共用该解析器，行为不会分叉。
 * workspaceId names the workspace directly; omitted it inherits the calling
 * session's workspace. session_create shares this resolver, so the creation
 * paths cannot diverge.
 * @param ctx - 宿主上下文。The host context.
 * @param created - 新建参数。The creation arguments.
 * @param callerSessionId - 调用方会话 id。The calling session id.
 * @returns 新会话 id。The new session id.
 */
async function createTarget(
  ctx: Context,
  created: NewSessionArgs,
  callerSessionId: SessionId,
): Promise<SessionId> {
  const workspaceId = resolveWorkspaceId(ctx, created.workspaceId, callerSessionId)
  try {
    const value = await ctx.sessionController.create({
      workspaceId,
      ...created.agentPreset === undefined ? {} : { agentPreset: created.agentPreset },
    })
    return value.sessionId
  } catch (error: unknown) {
    throw new SessionToolError('SESSION_DISPATCH_CREATE_FAILED', `creating a session failed: ${String(error)}`, {})
  }
}

/**
 * 构建 `session_dispatch` 工具定义（不注册）：派发立即返回 + 事件驱动结算通知。
 * 看守由调用方持有（页面会话作用域随视图创建/销毁），本构建器只把它接进定义。
 * Build the `session_dispatch` tool definition (unregistered): the dispatch
 * returns immediately and settlement reporting is event-driven. The caller owns
 * the watch (a page-session scope creates and disposes it with its view); this
 * builder only wires it into the definition.
 * @param ctx - 宿主上下文。The host context.
 * @param watch - 结算看守注册表。The settlement-watch registry.
 */
export function buildSessionDispatchDefinition(ctx: Context, watch: SettlementWatch): ToolDefinition {
  const definition = defineTool({
    name: 'session_dispatch',
    description:
      'Hand a prompt to another session and return immediately; this call never waits for that session. '
      + 'The prompt is queued as its own follow-up turn in the target session and wakes it. '
      + 'With report true (the default) a watcher observes the target until it is genuinely quiescent - no active '
      + 'turn and no maintenance task - and then delivers the target\'s closing output back into THIS session as a '
      + 'follow-up message, which wakes this session again. Every notice names the dispatch it answers. '
      + 'Only one dispatch per session may be outstanding: the report is the whole session\'s closing output once it '
      + 'settles, so a second prompt sent before the first report arrives would make both reports describe the same '
      + 'last output and would lose the earlier result. Such a dispatch is refused with SESSION_DISPATCH_WATCH_BUSY; '
      + 'wait for the notice that names the pending dispatch and then dispatch again. '
      + 'Set report to false for fire-and-forget delivery to a session with no outstanding report. '
      + 'This is how the bridge persona hands a created session its task. ' + HINT,
    parameters: {
      sessionId: {
        type: 'string',
        description: 'Existing target session id. Provide either sessionId or newSession, not both.',
      },
      newSession: {
        type: 'object',
        additionalProperties: false,
        description: 'Create a fresh session in a workspace instead of naming an existing one. Pass workspaceId, or omit it to inherit this session\'s workspace; cwd is not accepted. Provide either sessionId or newSession, not both.',
        properties: {
          workspaceId: {
            type: 'string',
            description: 'Workspace the new session joins, by id from the page\'s Workspace List. Omit it to inherit this session\'s workspace; creation fails with SESSION_CREATE_WORKSPACE_UNKNOWN when this session has none. cwd is not accepted: pass workspaceId instead.',
          },
          agentPreset: { type: 'string', description: 'Agent preset the new session runs. Defaults to the configured default.' },
        },
      },
      prompt: {
        type: 'string',
        required: true,
        description: 'Text delivered to the target session as its own follow-up turn. Required and non-empty.',
      },
      report: {
        type: 'boolean',
        description: 'true (default) sends the target\'s closing output back into this session once the target settles; false dispatches only and never sends anything back. Either way the dispatch is refused while this session has an outstanding report for the target.',
      },
    },
    output: {
      // 无损 JSON 输出：收据小而稳定，模型直接读原始值。
      // Lossless JSON output: the receipt is small and stable; the model reads the raw value.
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          sessionId: { type: 'string', required: true, description: 'Session that received the prompt.' },
          messageId: { type: 'string', required: true, description: 'Identity of the enqueued user message.' },
          watchId: {
            oneOf: [{ type: 'string' }, { type: 'null' }],
            required: true,
            description: 'Settlement-watch handle, or null when report is false.',
          },
          reporting: { type: 'boolean', required: true, description: 'Whether a settlement notice will be sent back to this session.' },
        },
      },
      render: (_args, value) => [{ type: 'text' as const, text: describeReceipt(value) }],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec): Promise<SessionDispatchResult> {
      const caller = exec.agent
      if (caller === undefined) {
        throw new SessionToolError(
          'SESSION_DISPATCH_NO_CALLER',
          'this call has no calling agent, so a settlement notice could not be addressed',
          {},
        )
      }
      // 先校验参数，再解析目标：坏参数必须报参数错误，而不是目标不可解析。
      // Validate the argument before resolving the target: a bad argument must
      // report the argument error, never a target-resolution error.
      const prompt = requirePrompt(args.prompt)
      const reporting = args.report !== false
      const targetSessionId = await resolveTarget(ctx, args, caller.id)
      // resolveAgent 会按需恢复目标会话；找不到是稳定的会话域错误。
      // resolveAgent resumes the target on demand; a miss is a stable Session-domain error.
      const found = await ctx.sessionController.resolveAgent(targetSessionId)
      if ('error' in found) {
        throw new SessionToolError(
          'SESSION_DISPATCH_TARGET_NOT_FOUND',
          `session "${targetSessionId}" could not be resolved: ${found.error.message}`,
          { sessionId: targetSessionId },
        )
      }
      if (reporting && !watch.hasCapacity()) {
        throw new SessionToolError(
          'SESSION_DISPATCH_CAPACITY_REACHED',
          'the configured maxConcurrentWatches limit is reached; raise the limit or wait for pending watches to settle',
          { maxConcurrentWatches: true },
        )
      }
      const message = createDispatchPrompt(caller.id, prompt, returnGuidance(ctx, caller.id, found.agent))
      const deliver = (): void => { found.agent.followup(message) }
      // 挂看守与投递由注册表定序：先查账、再登记唤醒源、然后投递、最后启动观察者。
      // 报告型派发把这几步并进 arm() 的同一个同步块——查账与登记之间没有 await，所以同一步
      // 里并发发出的两条派发不可能都通过检查，第二条会被 arm() 以 WATCH_BUSY 拒绝。
      // Arming and delivery are ordered by the registry: check, register the wake
      // sources, deliver, then start the observer. A reporting dispatch folds those
      // steps into one synchronous block inside arm() - no await separates the check
      // from the registration - so two dispatches issued concurrently in one step
      // cannot both pass and the second is refused with WATCH_BUSY.
      let watchId: string | null = null
      if (reporting) {
        watchId = watch.arm({
          agent: found.agent,
          callerSessionId: caller.id,
          messageId: message.id,
          prompt,
          deliver,
        })
      } else {
        // 非报告型派发没有可登记的看守，只能靠这次同步查账挡住"提示被接进受看守会话、
        // 换掉那条待结清报告将要描述的收尾输出"。
        // A non-reporting dispatch has no watch to register, so this synchronous
        // check is the only thing stopping its prompt from being accepted into a
        // watched session and replacing what the pending report will describe as
        // the closing output.
        watch.deliverGuarded(targetSessionId, deliver)
      }
      // 派发已被接受：广播开始事件，让宿主与界面无需读会话日志就能看到"已派出"。
      // The dispatch was accepted: broadcast the start event, so a host or UI sees
      // "dispatched" without reading Session logs.
      emitAgentEvent(ctx, caller, 'session-dispatch/start', {
        watchId,
        targetSessionId,
        callerSessionId: caller.id,
      })
      return { sessionId: targetSessionId, messageId: message.id, watchId, reporting }
    },
    presentCall: args => ({
      card: 'generic',
      title: 'Dispatch to session',
      kind: 'other',
      rawInput: args,
    }),
  })
  return guardRemovedCwd(definition, 'session_dispatch')
}

/**
 * 渲染派发收据；必须明确告诉模型「已经在处理目标会话了、不要轮询」。
 * Render the dispatch receipt; it must state that the target is already being
 * handled and that polling is unnecessary.
 * @param value - 已校验的规范收据。The validated canonical receipt.
 * @returns 模型可见的文本。The model-facing text.
 */
function describeReceipt(value: SessionDispatchResult): string {
  const head = `Dispatched to session ${value.sessionId} as message ${value.messageId}.`
  return value.reporting
    ? `${head} Settlement reporting is armed as ${String(value.watchId)}: when that session is genuinely quiescent, its closing output arrives in this session as a follow-up message that names ${String(value.watchId)}. Do not poll for it; end your turn or do other work. Dispatching to that session again before that notice arrives is refused.`
    : `${head} Settlement reporting is off: nothing will be sent back to this session.`
}
