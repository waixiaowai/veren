// 派发目标解析：把「sessionId 与 newSession 二选一」的参数形状收敛成目标会话 id，
// 新建路径经共享的工作区解析器与宿主 Session 业务 API，失败收敛成稳定错误码。
// Dispatch-target resolution: collapse the "exactly one of sessionId and
// newSession" argument shape into a target session id; the create path goes
// through the shared workspace resolver and the host Session business API, and
// failures collapse into stable error codes.
import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionId as SessionIdType } from '@deepseek-ai/dsh-session'
// 类型-only import：拉取 sessionController 的 Context 声明合并。
// Type-only import: pull the sessionController Context declaration merging.
import type {} from '@deepseek-ai/dsh-api-session-controller'
import { resolveWorkspaceId } from './tools-management.js'
import { SessionToolError } from './types.js'
import type { NewSessionArgs, SessionDispatchArgs } from './types.js'

/**
 * 解析或新建目标会话 id；sessionId 与 newSession 必须二选一。
 * Resolve or create the target session id; exactly one of sessionId and
 * newSession is required.
 * @param ctx - 宿主上下文。The host context.
 * @param args - 工具参数。The tool arguments.
 * @param callerSessionId - 调用方会话 id，用于继承工作区。The caller session id, used to inherit the workspace.
 * @returns 目标会话 id。The target session id.
 */
export async function resolveTarget(
  ctx: Context,
  args: SessionDispatchArgs,
  callerSessionId: SessionIdType,
): Promise<SessionIdType> {
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
  callerSessionId: SessionIdType,
): Promise<SessionIdType> {
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
