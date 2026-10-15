// 会话管理工具：session_create / session_rename / session_fork，走宿主的
// Session 业务 API（ctx.sessionController），不重复造创建/分叉逻辑。
// Session management tools: session_create / session_rename / session_fork
// over the host Session business API (ctx.sessionController).
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
// 类型-only import：拉取 sessionController 与 workspaceRegistry 的声明合并。
// Type-only imports: pull the sessionController and workspaceRegistry merging.
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-workspace'
import {
  SessionToolError,
  optionalModelSelection,
  requireTitle,
} from './types.js'
import type { SessionCreateArgs, SessionCreateResult, SessionForkArgs, SessionRenameArgs } from './types.js'

/** 工具描述共用提示：id 可在工作记忆快照里查到。Shared description hint. */
const HINT = 'Session ids appear in the working-memory snapshot.'

/** 宿主 create 的返回形状（本文件内复用，避免再声明一遍）。 */
/** The host create value shape (reused in this file instead of redeclaring). */
type SessionCreateValue = Awaited<ReturnType<Context['sessionController']['create']>>

/**
 * 注册 `session_create`：按预设/模型/标题创建一个普通会话。
 * Register `session_create`: create an ordinary session with preset/model/title.
 * @param ctx - 携带 sessionController 的宿主上下文。The context carrying sessionController.
 */
export function registerSessionCreate(ctx: Context): () => void {
  return ctx.tools.register(
    defineTool({
      name: 'session_create',
      description:
        'Create a new ordinary session in this deployment, optionally with a preset, an initial ' +
        'provider/model, a title, and a workspace or working directory. The new session starts ' +
        'empty and is not switched to; report its id to the user. ' + HINT,
      parameters: {
        title: { type: 'string', description: 'Display title for the new session; auto-titling applies when omitted.' },
        presetId: { type: 'string', description: 'Agent preset id; the deployment default when omitted.' },
        provider: { type: 'string', description: 'Provider id; required together with model.' },
        model: { type: 'string', description: 'Model id; required together with provider.' },
        workspaceId: { type: 'string', description: 'Workspace to attach; mutually exclusive with cwd.' },
        cwd: { type: 'string', description: 'Working directory for the new session; mutually exclusive with workspaceId.' },
      },
      output: {
        // 无损 JSON 输出：结果小而稳定，模型直接读原始值。
        // Lossless JSON output: results are small and stable; the model reads
        // the raw value directly.
        schema: { type: 'json' },
        render: (_args, value) => [{ type: 'text' as const, text: JSON.stringify(value) }],
      },
      async execute(args): Promise<SessionCreateResult> {
        const request = buildCreateRequest(args)
        const created = await ctx.sessionController.create(request)
        // 创建成功后再按需补装模型选择与标题；失败时新会话保留，错误显性返回。
        // Model selection and title are installed after a successful create; on
        // failure the new session is kept and the error surfaces as-is.
        return await decorateCreatedSession(ctx, args, created)
      },
      presentCall: (args) => ({
        card: 'generic',
        title: 'Create session',
        kind: 'other',
        rawInput: args,
      }),
    }),
  )
}

/**
 * 把创建参数翻译成宿主请求（位置互斥在这里显性失败）。
 * Translate create arguments into the host request (location conflicts fail loud here).
 */
function buildCreateRequest(args: SessionCreateArgs): Parameters<Context['sessionController']['create']>[0] {
  if (args.workspaceId !== undefined && args.cwd !== undefined) {
    throw new SessionToolError(
      'SESSION_CREATE_LOCATION_CONFLICT',
      'workspaceId and cwd are mutually exclusive',
      { workspaceId: args.workspaceId, cwd: args.cwd },
    )
  }
  optionalModelSelection(args)
  return {
    ...(args.workspaceId === undefined ? {} : { workspaceId: args.workspaceId as never }),
    ...(args.cwd === undefined ? {} : { cwd: args.cwd }),
    ...(args.presetId === undefined ? {} : { agentPreset: args.presetId }),
  }
}

/**
 * 创建后按需安装模型选择与标题，返回完整结果。
 * Install the model selection and title after creation; return the full result.
 *
 * 返回值用条件展开拼出「无 optional 属性」的完整字面量：JsonValue 不收 undefined，
 * 显式缺键比隐式 undefined 更贴宿主契约。
 * The return value is assembled by conditional spreads into a complete literal
 * without optional properties: JsonValue rejects undefined, so an absent key
 * matches the host contract better than an implicit undefined.
 */
async function decorateCreatedSession(
  ctx: Context,
  args: SessionCreateArgs,
  created: SessionCreateValue,
): Promise<SessionCreateResult> {
  const selection = optionalModelSelection(args)
  const installed = selection === undefined
    ? undefined
    : await ctx.sessionController.selectModel({ ...selection, sessionId: created.sessionId })
  const renamed = args.title === undefined
    ? undefined
    : await ctx.sessionController.rename({ sessionId: created.sessionId, title: requireTitle(args.title) })
  return {
    sessionId: created.sessionId,
    ...(created.agentPreset === undefined ? {} : { agentPreset: created.agentPreset }),
    ...(installed === undefined
      ? {}
      // 只投影 provider/model：宿主的 ModelSelection 带 optional reasoningEffort，
      // 而 JsonValue 不收 undefined。
      // Project provider/model only: the host ModelSelection carries an
      // optional reasoningEffort, which JsonValue rejects.
      : { selected: { provider: installed.selected.provider, model: installed.selected.model } }),
    ...(renamed === undefined ? {} : { title: renamed.title }),
  }
}

/**
 * 注册 `session_rename`：改一个会话的标题。
 * Register `session_rename`: retitle one session.
 * @param ctx - 携带 sessionController 的宿主上下文。The context carrying sessionController.
 */
export function registerSessionRename(ctx: Context): () => void {
  return ctx.tools.register(
    defineTool({
      name: 'session_rename',
      description: `Rename one existing session by id. ${HINT}`,
      parameters: {
        sessionId: { type: 'string', required: true, description: 'The session id to rename.' },
        title: { type: 'string', required: true, description: 'The new title (non-empty after trimming).' },
      },
      output: {
        schema: { type: 'json' },
        render: (_args, value) => [{ type: 'text' as const, text: JSON.stringify(value) }],
      },
      async execute(args: SessionRenameArgs) {
        const renamed = await ctx.sessionController.rename({
          sessionId: SessionId(args.sessionId),
          title: requireTitle(args.title),
        })
        return { sessionId: args.sessionId, title: renamed.title, seq: renamed.seq }
      },
      presentCall: (args) => ({
        card: 'generic',
        title: 'Rename session',
        kind: 'other',
        rawInput: args,
      }),
    }),
  )
}

/**
 * 注册 `session_fork`：把一个会话的已完成前缀分叉成新会话。
 * Register `session_fork`: fork one session's completed prefix into a new session.
 * @param ctx - 携带 sessionController 的宿主上下文。The context carrying sessionController.
 */
export function registerSessionFork(ctx: Context): () => void {
  return ctx.tools.register(
    defineTool({
      name: 'session_fork',
      description:
        'Fork one existing session: copy an exact completed-turn prefix into a new session and ' +
        'return the new id. Omitting atSeq forks the latest completed turn. ' + HINT,
      parameters: {
        sessionId: { type: 'string', required: true, description: 'The source session id.' },
        atSeq: { type: 'integer', description: 'Exact inclusive source event seq; omit for the latest completed turn.' },
      },
      output: {
        schema: { type: 'json' },
        render: (_args, value) => [{ type: 'text' as const, text: JSON.stringify(value) }],
      },
      async execute(args: SessionForkArgs) {
        const forked = await ctx.sessionController.fork({
          sessionId: SessionId(args.sessionId),
          ...(args.atSeq === undefined ? {} : { atSeq: args.atSeq }),
        })
        return { sessionId: forked.sessionId, sourceSessionId: args.sessionId }
      },
      presentCall: (args) => ({
        card: 'generic',
        title: 'Fork session',
        kind: 'other',
        rawInput: args,
      }),
    }),
  )
}
