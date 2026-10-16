// session_dispatch 工具：把一段提示投进目标会话并立即返回，绝不等目标静止。
// 之前 session_prompt 的 wait=true 会阻塞调用方直到目标空闲（实测有过 16 分钟）；
// 这里把「派发」与「回报」拆开，等待交给 watcher.ts 的看守（纯事件驱动，无定时器）。
// The session_dispatch tool: enqueue one prompt in the target session and return
// at once, never waiting for it to settle. session_prompt's wait=true blocked the
// caller until the target went idle (16 minutes was observed); this splits
// "dispatch" from "report" and leaves waiting to the guard in watcher.ts, which
// is purely event-driven and schedules nothing.
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
// 类型-only imports：拉取 tools、agents 与 sessionController 的声明合并。
// Type-only imports: pull the tools, agents, and sessionController declaration merging.
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type { DispatchArgs, NewSessionArgs, SessionDispatchErrorCode, SessionDispatchResult } from './types.js'
import type { WatchRegistry } from './watcher.js'

/** 工具名。The tool name. */
export const SESSION_DISPATCH_TOOL = 'session_dispatch'

/** 带稳定 code 与机器可读字段的结构化错误（misconfiguration fails loud）。 */
/** A structured error with a stable code and machine-readable fields. */
export class SessionDispatchError extends Error {
  readonly code: SessionDispatchErrorCode
  readonly fields: Record<string, unknown>

  /**
   * @param code - 稳定错误码。The stable error code.
   * @param message - 可读原因。The human-readable reason.
   * @param fields - 机器可读字段。Machine-readable fields.
   */
  constructor(code: SessionDispatchErrorCode, message: string, fields: Record<string, unknown>) {
    super(message)
    this.name = 'SessionDispatchError'
    this.code = code
    this.fields = fields
  }
}

/**
 * 建一条本插件来源的用户消息（派发提示与完成回报共用）。
 * Build one plugin-sourced user message (shared by dispatch prompts and reports).
 * @param text - 正文。The body text.
 * @returns 已标识的用户消息。The identified user message.
 */
export function createPluginMessage(text: string): UserMessage {
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'session-dispatch' },
  })
}

/**
 * 解析出提示文本：去空白后必须非空。Resolve the prompt: non-empty after trimming.
 * @param prompt - 模型给出的原文。The model-supplied text.
 * @returns 去空白后的提示。The trimmed prompt.
 */
function requirePrompt(prompt: string): string {
  const trimmed = prompt.trim()
  if (trimmed === '') {
    throw new SessionDispatchError('SESSION_DISPATCH_PROMPT_EMPTY', 'prompt must be a non-empty string', { prompt })
  }
  return trimmed
}

/**
 * 新建目标会话；失败收敛成稳定的创建错误。
 * Create the target session; failures collapse into a stable create error.
 * @param ctx - 宿主上下文。The host context.
 * @param created - 新建参数。The creation arguments.
 * @returns 新会话 id。The new session id.
 */
async function createTarget(ctx: Context, created: NewSessionArgs): Promise<SessionId> {
  try {
    const value = await ctx.sessionController.create({
      ...created.cwd === undefined ? {} : { cwd: created.cwd },
      ...created.agentPreset === undefined ? {} : { agentPreset: created.agentPreset },
    })
    return value.sessionId
  } catch (error: unknown) {
    throw new SessionDispatchError('SESSION_DISPATCH_CREATE_FAILED', `creating a session failed: ${String(error)}`, {})
  }
}

/**
 * 解析或新建目标会话 id；sessionId 与 newSession 必须二选一。
 * Resolve or create the target session id; exactly one of sessionId and
 * newSession is required.
 * @param ctx - 宿主上下文。The host context.
 * @param args - 已校验参数。The validated arguments.
 * @returns 目标会话 id。The target session id.
 */
async function resolveTarget(ctx: Context, args: DispatchArgs): Promise<SessionId> {
  const sessionId = args.sessionId?.trim() ?? ''
  const created = args.newSession
  if (sessionId !== '' && created !== undefined) {
    throw new SessionDispatchError(
      'SESSION_DISPATCH_TARGET_CONFLICT',
      'provide either sessionId or newSession, not both',
      { sessionId, newSession: created },
    )
  }
  if (sessionId === '' && created === undefined) {
    throw new SessionDispatchError('SESSION_DISPATCH_TARGET_MISSING', 'provide sessionId or newSession', {})
  }
  return created === undefined ? sessionId as SessionId : await createTarget(ctx, created)
}

/**
 * 挂看守（可选）后投递提示；投递或挂起失败都必须不留幽灵看守。
 * Arm the watch when reporting, then deliver the prompt; a failed arm or
 * delivery must leave no ghost watch behind.
 * @param agent - 目标 Agent。The target Agent.
 * @param targetSessionId - 目标会话 id。The target session id.
 * @param callerSessionId - 调用方会话 id。The caller session id.
 * @param prompt - 已去空白的提示。The already-trimmed prompt.
 * @param reporting - 是否回报完成。Whether completion is reported.
 * @param registry - 看守注册表。The watch registry.
 * @returns 规范收据。The canonical receipt.
 */
function deliverTo(
  agent: Agent,
  targetSessionId: SessionId,
  callerSessionId: SessionId,
  prompt: string,
  reporting: boolean,
  registry: WatchRegistry,
): SessionDispatchResult {
  if (reporting && !registry.hasCapacity()) {
    throw new SessionDispatchError(
      'SESSION_DISPATCH_CAPACITY_REACHED',
      'the configured maxConcurrentWatches limit is reached; raise the limit or wait for pending watches to settle',
      { maxConcurrentWatches: true },
    )
  }
  const message = createPluginMessage(prompt)
  // 挂看守与投递在同一个调用里完成，顺序由注册表保证：先登记唤醒源，再投递，最后启动观察者。
  // Arming and delivery happen in one call and the registry fixes the order:
  // register the wake sources, deliver, then start the observer.
  const watchId = reporting
    ? registry.arm(agent, callerSessionId, () => { agent.followup(message) })
    : null
  if (!reporting) agent.followup(message)
  return { sessionId: targetSessionId, messageId: message.id, watchId, reporting }
}

/**
 * 注册 `session_dispatch`：派发立即返回 + 事件驱动完成回报。
 * Register `session_dispatch`: dispatch returns at once, completion reporting is
 * event-driven.
 * @param ctx - 宿主上下文。The host context.
 * @param registry - 看守注册表。The watch registry.
 * @returns 精确卸载函数。The exact disposer.
 */
export function registerSessionDispatch(ctx: Context, registry: WatchRegistry): () => void {
  return ctx.tools.register(defineTool({
    name: SESSION_DISPATCH_TOOL,
    description:
      'Hand a prompt to another session and return immediately; this call never waits for that session. '
      + 'The prompt is queued as its own follow-up turn in the target session and wakes it. '
      + 'With report true (the default) a watcher observes the target until it is genuinely quiescent - no active '
      + 'turn and no maintenance task - and then delivers the target\'s final assistant output back into THIS session '
      + 'as a follow-up message, which wakes this session again. Set report to false for fire-and-forget delivery. '
      + 'Session ids appear in the working-memory snapshot.',
    parameters: {
      sessionId: {
        type: 'string',
        description: 'Existing target session id. Provide either sessionId or newSession, not both.',
      },
      newSession: {
        type: 'object',
        additionalProperties: false,
        description: 'Create a fresh session instead of naming an existing one. Provide either sessionId or newSession, not both.',
        properties: {
          cwd: { type: 'string', description: 'Directory the new session owns. Defaults to the deployment default.' },
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
        description: 'true (default) sends the target\'s final output back into this session once the target settles; false dispatches only and never sends anything back.',
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
            description: 'Watch handle, or null when report is false.',
          },
          reporting: { type: 'boolean', required: true, description: 'Whether a completion report will be sent back to this session.' },
        },
      },
      render: (_args, value) => [{ type: 'text' as const, text: describeReceipt(value) }],
    },
    async execute(args, exec): Promise<SessionDispatchResult> {
      const caller = exec.agent
      if (caller === undefined) {
        throw new SessionDispatchError(
          'SESSION_DISPATCH_NO_CALLER',
          'this call has no calling agent, so a completion report could not be addressed',
          {},
        )
      }
      // 先校验参数，再解析目标：坏参数必须报参数错误，而不是目标不可解析。
      // Validate the argument before resolving the target: a bad argument must
      // report the argument error, never a target-resolution error.
      const prompt = requirePrompt(args.prompt)
      const reporting = args.report !== false
      const targetSessionId = await resolveTarget(ctx, args)
      // resolveAgent 会按需恢复目标会话；找不到是稳定的会话域错误。
      // resolveAgent resumes the target on demand; a miss is a stable Session-domain error.
      const found = await ctx.sessionController.resolveAgent(targetSessionId)
      if ('error' in found) {
        throw new SessionDispatchError(
          'SESSION_DISPATCH_TARGET_UNRESOLVED',
          `session "${targetSessionId}" could not be resolved: ${found.error.message}`,
          { sessionId: targetSessionId },
        )
      }
      return deliverTo(found.agent, targetSessionId, caller.id, prompt, reporting, registry)
    },
    presentCall: args => ({
      card: 'generic',
      title: 'Dispatch to session',
      kind: 'other',
      rawInput: args,
    }),
  }))
}

/**
 * 渲染派发收据；必须明确告诉模型「已经在处理目标会话了、不要轮询」。
 * Render the dispatch receipt; it must tell the model that the target is already
 * being handled and that polling is unnecessary.
 * @param value - 已校验的规范收据。The validated canonical receipt.
 * @returns 模型可见的文本。The model-facing text.
 */
function describeReceipt(value: SessionDispatchResult): string {
  const head = `Dispatched to session ${value.sessionId} as message ${value.messageId}.`
  return value.reporting
    ? `${head} Completion reporting is armed as ${String(value.watchId)}: when that session is genuinely quiescent, its final output arrives in this session as a follow-up message. Do not poll for it; end your turn or do other work.`
    : `${head} Completion reporting is off: nothing will be sent back to this session.`
}
