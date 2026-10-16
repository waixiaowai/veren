// 会话派活工具：session_prompt——把一段提示文本投递进目标会话并唤醒它执行。
// 走宿主会话业务 API 的 resolveAgent 拿到活跃 Agent，再以宿主标准入队方式
// （agent.followup + kind:'user' 的 user 消息）提交，不在本插件里造第二条
// 消息通道。这是桥梁人设「把活派给自己创建的会话」的关键一步：此前只能创建
// 会话却不能替它说第一句话。
// Session dispatch tool: session_prompt — deliver one prompt into a target
// session and wake it. The host Session business API's resolveAgent yields the
// live Agent; the prompt is committed through the host's standard enqueue path
// (agent.followup with a kind:'user' message) — no second message channel is
// invented here. This is the missing step for the bridge persona: it could
// create sessions but could not speak their first sentence.
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
// 类型-only import：拉取 sessionController 的 Context 声明合并。
// Type-only import: pulls the sessionController Context declaration merging.
import type {} from '@deepseek-ai/dsh-api-session-controller'
import { SessionToolError } from './types.js'
import type { SessionPromptArgs, SessionPromptResult } from './types.js'

/** 工具描述共用提示：id 可在工作记忆快照里查到。Shared description hint. */
const HINT = 'Session ids appear in the working-memory snapshot.'

/**
 * 校验提示文本：去空白后必须非空。Prompt validation: non-empty after trimming.
 * @param prompt - 原始输入。The raw input.
 * @returns 去空白后的提示。The trimmed prompt.
 */
function requirePrompt(prompt: string): string {
  const trimmed = prompt.trim()
  if (trimmed === '') {
    throw new SessionToolError('SESSION_PROMPT_EMPTY', 'prompt must be a non-empty string', { prompt })
  }
  return trimmed
}

/**
 * 注册 `session_prompt`：向目标会话投递一段提示并唤醒它执行。
 * Register `session_prompt`: deliver one prompt into the target session and
 * wake it.
 * @param ctx - 携带 sessionController 的宿主上下文。The context carrying sessionController.
 */
export function registerSessionPrompt(ctx: Context): () => void {
  return ctx.tools.register(
    defineTool({
      name: 'session_prompt',
      description:
        'Deliver one prompt into an existing session and wake it to run. Use this to hand a task ' +
        'to a session you created — including its first message — instead of asking the user to ' +
        'type it. Write the prompt as a brief: the need in the user\'s terms, what "done" looks ' +
        'like, and room for the worker to judge the details — no technical prescriptions. ' +
        'With wait=true the call returns after the session goes idle; otherwise it returns as ' +
        'soon as the prompt is accepted. ' + HINT,
      parameters: {
        sessionId: { type: 'string', required: true, description: 'The session id to deliver the prompt to.' },
        prompt: { type: 'string', required: true, description: 'The prompt text, sent verbatim as one text block.' },
        wait: { type: 'boolean', description: 'Wait for the session to go idle before returning (default false).' },
      },
      output: {
        // 无损 JSON 输出：结果小而稳定，模型直接读原始值。
        // Lossless JSON output: results are small and stable; the model reads
        // the raw value directly.
        schema: { type: 'json' },
        render: (_args, value) => [{ type: 'text' as const, text: JSON.stringify(value) }],
      },
      async execute(args: SessionPromptArgs): Promise<SessionPromptResult> {
        const prompt = requirePrompt(args.prompt)
        // resolveAgent 会按需恢复（resume）目标会话；找不到是稳定的会话域错误。
        // resolveAgent resumes the target session on demand; a missing session
        // surfaces as a stable Session-domain error.
        const found = await ctx.sessionController.resolveAgent(SessionId(args.sessionId))
        if ('error' in found) {
          throw new SessionToolError(
            'SESSION_PROMPT_NOT_FOUND',
            `session "${args.sessionId}" could not be resolved: ${found.error.message}`,
            { sessionId: args.sessionId },
          )
        }
        // 宿主标准入队路径：busy 时排队为下一轮，idle 时立即唤醒。
        // The host's standard enqueue path: queued as the next turn when busy,
        // wakes immediately when idle.
        found.agent.followup(createUserMessage({
          content: [{ type: 'text', text: prompt }],
          source: { kind: 'user' },
        }))
        if (args.wait === true) await found.agent.whenIdle()
        return { sessionId: args.sessionId, accepted: true, waited: args.wait === true }
      },
      presentCall: (args) => ({
        card: 'generic',
        title: 'Prompt session',
        kind: 'other',
        rawInput: args,
      }),
    }),
  )
}
