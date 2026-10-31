/**
 * 页面会话的工作区落点：会话头 `cwd` 与工作区候选表 `sessionIds` 两步缺一不可，
 * 这里封装这个两步归属路径。
 * The page session's workspace home: both the header `cwd` and the candidate
 * table `sessionIds` are required; this file wraps that two-step membership
 * path.
 * @module @veren/app-host/session-workspace
 */
import type { Context } from '@deepseek-ai/cordis'
// 类型-only import：拉取 workspaceRegistry 的 declaration merging + Workspace 权威类型。
// type-only import: pulls the workspaceRegistry declaration merge and the Workspace type.
import type {} from '@deepseek-ai/dsh-workspace'
import type { Workspace } from '@deepseek-ai/dsh-workspace'

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
export async function pageSessionWorkspace(ctx: Context): Promise<Workspace | undefined> {
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
