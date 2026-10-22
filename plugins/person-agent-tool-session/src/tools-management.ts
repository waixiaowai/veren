// 会话管理工具构建器：session_create / session_rename，走宿主的
// Session 业务 API（ctx.sessionController），不重复造创建逻辑。
// 分叉已由 session-fork-enhanced 插件的 session_fork_with_options 接管，
// 本包不提供任何 fork 工具，避免两份重复实现。
// Session management tool builders: session_create / session_rename over the
// host Session business API (ctx.sessionController). Forking is owned by the
// session-fork-enhanced plugin (session_fork_with_options), so this package
// provides no fork tool and keeps a single implementation.
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
// 类型-only import：拉取 sessionController 与 workspaceRegistry 的声明合并。
// Type-only imports: pull the sessionController and workspaceRegistry merging.
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import {
  SessionToolError,
  optionalModelSelection,
  requireTitle,
} from './types.js'
import type { SessionCreateArgs, SessionCreateResult, SessionRenameArgs } from './types.js'

/** 工具描述共用提示：session id 从 workspace_session_list 查；workspace id 从页面正文的 Workspace List 取。
 * / shared description hint: session ids come from workspace_session_list; workspace ids from the page's Workspace List. */
const HINT = 'Session ids come from the workspace_session_list tool; workspace ids come from the page\'s Workspace List.'

/**
 * 解析新会话的工作区：显式 id 优先；缺省继承调用方会话所在的工作区。
 * Resolve the new session's workspace: an explicit id wins; otherwise inherit
 * the workspace of the calling session.
 *
 * 调用方没有工作区时显性失败，绝不退回部署默认目录造成未分组会话。
 * A caller without a workspace fails loud instead of falling back to the
 * deployment default directory and creating an ungrouped session.
 * @param ctx - 携带 workspaceRegistry 的宿主上下文。The context carrying workspaceRegistry.
 * @param requested - 模型显式给出的 workspace id。The explicit workspace id, when supplied.
 * @param callerSessionId - 调用方会话 id；未知时为 undefined。The calling session id, or undefined.
 * @returns 新会话要挂靠的工作区 id。The workspace id the new session joins.
 */
export function resolveWorkspaceId(
  ctx: Context,
  requested: string | undefined,
  callerSessionId: SessionId | undefined,
): WorkspaceId {
  if (requested !== undefined) return requested as WorkspaceId
  const owning = callerSessionId === undefined
    ? undefined
    : ctx.workspaceRegistry.list().find(workspace => workspace.sessionIds.includes(callerSessionId))
  if (owning === undefined) {
    throw new SessionToolError(
      'SESSION_CREATE_WORKSPACE_UNKNOWN',
      'the calling session has no workspace; pass workspaceId explicitly',
      { callerSessionId },
    )
  }
  return owning.id
}

/**
 * 读取已删除的 cwd 参数（顶层或 newSession 内层）。
 * Read the removed cwd argument (top level or inside newSession).
 * @param args - 原始工具参数。The raw tool arguments.
 * @returns cwd 值；未提供时为 undefined。The cwd value, or undefined.
 */
function removedCwd(args: unknown): unknown {
  if (typeof args !== 'object' || args === null) return undefined
  const record = args as Record<string, unknown>
  if (record.cwd !== undefined) return record.cwd
  const nested = record.newSession
  return typeof nested === 'object' && nested !== null
    ? (nested as Record<string, unknown>).cwd
    : undefined
}

/**
 * 在 schema 校验之前拒绝已删除的 cwd，并明确指向 workspaceId。
 * Reject the removed cwd before schema validation and point at workspaceId.
 *
 * defineTool 的校验在进入用户 execute 之前运行，所以这层包装是唯一能给出
 * 面向 workspaceId 的自定义错误的挂点。
 * defineTool validates before the user execute runs, so this wrapper is the only
 * place that can return a custom error pointing at workspaceId.
 * @param definition - 已定义的创建工具。The defined creation tool.
 * @param toolName - 模型看到的工具名。The model-facing tool name.
 * @returns 带 cwd 守卫的工具定义。The definition guarded against cwd.
 */
export function guardRemovedCwd(definition: ToolDefinition, toolName: string): ToolDefinition {
  return {
    ...definition,
    async execute(args, exec) {
      const cwd = removedCwd(args)
      if (cwd !== undefined) {
        throw new SessionToolError(
          'SESSION_CREATE_CWD_REMOVED',
          `cwd is no longer accepted by ${toolName}; pass workspaceId instead`,
          { cwd, tool: toolName },
        )
      }
      return await definition.execute(args, exec)
    },
  }
}

/** 宿主 create 的返回形状（本文件内复用，避免再声明一遍）。 */
/** The host create value shape (reused in this file instead of redeclaring). */
type SessionCreateValue = Awaited<ReturnType<Context['sessionController']['create']>>

/**
 * 构建 `session_create` 工具定义（不注册）：应用目录复用同一份实现。
 * Build the `session_create` tool definition (unregistered): the app catalog
 * reuses this very implementation.
 * @param ctx - 携带 sessionController 的宿主上下文。The context carrying sessionController.
 */
export function buildSessionCreateDefinition(ctx: Context): ToolDefinition {
  return defineTool({
    name: 'session_create',
    description:
      'Create a new ordinary session in this deployment, optionally with a preset, an initial ' +
      'provider/model, and a title. The session always joins a workspace: pass workspaceId, or omit it ' +
      'to inherit the calling session\'s workspace. cwd is not accepted. The new session starts empty ' +
      'and is not switched to; report its id to the user. ' + HINT,
    parameters: {
      title: { type: 'string', description: 'Display title for the new session; auto-titling applies when omitted.' },
      presetId: { type: 'string', description: 'Agent preset id; the deployment default when omitted.' },
      provider: { type: 'string', description: 'Provider id; required together with model.' },
      model: { type: 'string', description: 'Model id; required together with provider.' },
      workspaceId: {
        type: 'string',
        description: 'Workspace the new session joins, by id from the page\'s Workspace List. Omit it to inherit the calling session\'s workspace; creation fails with SESSION_CREATE_WORKSPACE_UNKNOWN when the caller has none. cwd is not accepted: pass workspaceId instead.',
      },
    },
    output: {
      // 无损 JSON 输出：结果小而稳定，模型直接读原始值。
      // Lossless JSON output: results are small and stable; the model reads
      // the raw value directly.
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text' as const, text: JSON.stringify(value) }],
    },
    async execute(args, exec): Promise<SessionCreateResult> {
      const request = buildCreateRequest(ctx, args, exec.agent?.id)
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
  })
}

/**
 * 把创建参数翻译成宿主请求（工作区由共享解析器决定）。
 * Translate create arguments into the host request (the shared resolver owns
 * the workspace decision).
 * @param ctx - 携带 workspaceRegistry 的宿主上下文。The context carrying workspaceRegistry.
 * @param args - 模型给出的创建参数。The model-supplied create arguments.
 * @param callerSessionId - 调用方会话 id。The calling session id.
 * @returns 宿主 create 请求。The host create request.
 */
function buildCreateRequest(
  ctx: Context,
  args: SessionCreateArgs,
  callerSessionId: SessionId | undefined,
): Parameters<Context['sessionController']['create']>[0] {
  optionalModelSelection(args)
  return {
    workspaceId: resolveWorkspaceId(ctx, args.workspaceId, callerSessionId),
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
 * 构建 `session_rename` 工具定义（不注册）：应用目录复用同一份实现。
 * Build the `session_rename` tool definition (unregistered): the app catalog
 * reuses this very implementation.
 * @param ctx - 携带 sessionController 的宿主上下文。The context carrying sessionController.
 */
export function buildSessionRenameDefinition(ctx: Context): ToolDefinition {
  return defineTool({
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
    })
}


