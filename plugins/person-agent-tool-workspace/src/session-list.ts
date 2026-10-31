// 工具实现：workspace_session_list——按条件检索一个工作区账目下的会话。
// Tool implementation: workspace_session_list - conditional session search over
// one workspace's accounted sessions.
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { Context } from '@deepseek-ai/cordis'
// 类型-only import：拉取 workspaceRegistry 的 Context 声明合并与 WorkspaceId 品牌。
// Type-only imports: pull the workspaceRegistry Context declaration merging and
// the WorkspaceId brand.
import type {} from '@deepseek-ai/dsh-workspace'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import type { SessionListArgs, SessionListEntry } from './types.js'
import { WorkspaceToolError } from './types.js'
import { resolveSessionFacts } from './session-facts.js'

/** 归档过滤的默认值：默认只看未归档会话。Default of the archive filter: unarchived only. */
const DEFAULT_ARCHIVED: 'exclude' = 'exclude'

/** `buildWorkspaceSessionListDefinition` 的部署开关。Deployment knobs of `buildWorkspaceSessionListDefinition`. */
export interface SessionListOptions {
  /** 单次调用返回的会话数上限。Maximum sessions returned by one call. */
  maxListSessions: number
}

/**
 * 注册表条目类型：直接投影宿主 workspaceRegistry 服务面，不手写影子副本。
 * The registry entry type: projected from the host workspaceRegistry service
 * face instead of a hand-written shadow copy.
 */
type WorkspaceRecord = NonNullable<ReturnType<Context['workspaceRegistry']['get']>>

/**
 * `workspace_session_list` 的参数面。`as const` 保留字面量（`required: true` 与
 * archived 枚举），供 defineTool 的 const 泛型推断参数类型。
 * The parameter face of `workspace_session_list`. `as const` keeps the literals
 * (`required: true` and the archived enum) so defineTool's const generic infers
 * argument types.
 */
const SESSION_LIST_PARAMETERS = {
  workspaceId: {
    type: 'string',
    required: true,
    description: 'The workspace id whose sessions are listed.',
  },
  agentPreset: {
    type: 'string',
    description: 'Exact agent preset match; omit to include every preset.',
  },
  provider: {
    type: 'string',
    description: 'Exact provider match of the latest recorded request; omit to include every provider.',
  },
  model: {
    type: 'string',
    description: 'Exact model id match of the latest recorded request; omit to include every model.',
  },
  archived: {
    type: 'string',
    enum: ['exclude', 'only', 'include'],
    description: "Archive filter: 'exclude' (default) lists unarchived sessions, 'only' archived ones, 'include' both.",
  },
  limit: {
    type: 'integer',
    description: 'Maximum sessions returned; defaults to the deployment cap.',
  },
} as const

/**
 * 校验并归一 limit：缺省取部署上限；非正整数或超上限报结构化错误。
 * Validate and normalize limit: default to the deployment cap; a non-positive
 * integer or an over-cap value raises a structured error.
 */
function normalizeLimit(limit: number | undefined, maxListSessions: number): number {
  if (limit === undefined) return maxListSessions
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new WorkspaceToolError('WORKSPACE_LIST_LIMIT_INVALID', 'limit must be a positive integer', { limit })
  }
  if (limit > maxListSessions) {
    throw new WorkspaceToolError(
      'WORKSPACE_LIST_LIMIT_INVALID',
      `limit must not exceed the deployment cap of ${maxListSessions}`,
      { limit, maxListSessions },
    )
  }
  return limit
}

/**
 * 归档三态判定：exclude 只留未归档，only 只留已归档，include 全留。
 * The archive tri-state: exclude keeps unarchived, only keeps archived,
 * include keeps both.
 */
function matchesArchiveFilter(args: SessionListArgs, archived: boolean): boolean {
  const mode = args.archived ?? DEFAULT_ARCHIVED
  if (mode === 'exclude') return !archived
  if (mode === 'only') return archived
  return true
}

/**
 * 条件判定：preset / provider / model 全部精确匹配，任一给定的条件不满足即排除。
 * Condition matching: preset / provider / model are exact matches; any supplied
 * condition that fails excludes the session.
 */
function matchesFilters(args: SessionListArgs, facts: { preset?: string, provider?: string, model?: string }): boolean {
  if (args.agentPreset !== undefined && facts.preset !== args.agentPreset) return false
  if (args.provider !== undefined && facts.provider !== args.provider) return false
  if (args.model !== undefined && facts.model !== args.model) return false
  return true
}

/**
 * 取列表目标工作区；找不到即结构化报错。
 * Read the workspace to list; a miss raises the structured error.
 */
function requireListedWorkspace(ctx: Context, workspaceId: string): WorkspaceRecord {
  const workspace = ctx.workspaceRegistry.get(workspaceId as WorkspaceId)
  if (workspace === undefined) {
    throw new WorkspaceToolError(
      'WORKSPACE_NOT_FOUND',
      `workspace not found: ${workspaceId}`,
      { workspaceId },
    )
  }
  return workspace
}

/**
 * 按条件收集命中条目：先过归档三态，再解析事实并过 preset/provider/model 过滤。
 * Collect the matching entries: the archive tri-state first, then resolve facts
 * and apply the preset/provider/model filters.
 */
async function collectMatches(
  ctx: Context,
  args: SessionListArgs,
  workspace: WorkspaceRecord,
  archivedIds: ReadonlySet<string>,
): Promise<SessionListEntry[]> {
  const matches: SessionListEntry[] = []
  for (const id of workspace.sessionIds) {
    const archived = archivedIds.has(id)
    if (!matchesArchiveFilter(args, archived)) continue
    const facts = await resolveSessionFacts(ctx, id)
    if (facts === undefined || !matchesFilters(args, facts)) continue
    matches.push({
      sessionId: facts.id,
      title: facts.title,
      createdAt: facts.createdAt,
      agentPreset: facts.preset,
      provider: facts.provider,
      model: facts.model,
      running: facts.running,
      archived,
    })
  }
  return matches
}

/**
 * 排序并截断命中条目，拼出返回面。返回类型保持推断的匿名对象：JsonValue 的
 * object 分支要求隐式 index signature，接口不参与隐式索引兼容。
 * Sort and truncate the matching entries, then assemble the result face. The
 * return type stays an inferred anonymous object: JsonValue's object branch
 * requires an implicit index signature, which interfaces do not participate in.
 */
function renderSessionList(matches: SessionListEntry[], limit: number) {
  // 创建时间新的在前；total 是截断前的命中总数，让模型知道列表是否被截断。
  // Newest first; total is the pre-truncation hit count so the model
  // knows whether the list was cut off.
  matches.sort((left, right) => right.createdAt - left.createdAt)
  // 返回面是 JSON 值：可选字段仅在存在时输出，缺省键不出现。
  // The result face is a JSON value: optional fields are emitted only
  // when present; absent keys do not appear.
  return {
    total: matches.length,
    sessions: matches.slice(0, limit).map(entry => ({
      sessionId: entry.sessionId,
      createdAt: entry.createdAt,
      running: entry.running,
      archived: entry.archived,
      ...(entry.title === undefined ? {} : { title: entry.title }),
      ...(entry.agentPreset === undefined ? {} : { agentPreset: entry.agentPreset }),
      ...(entry.provider === undefined ? {} : { provider: entry.provider }),
      ...(entry.model === undefined ? {} : { model: entry.model }),
    })),
  }
}

/**
 * `workspace_session_list` 的执行体：定位工作区、归一 limit、收集并渲染命中。
 * The `workspace_session_list` body: locate the workspace, normalize the limit,
 * collect and render the matches.
 */
async function executeSessionList(ctx: Context, options: SessionListOptions, args: SessionListArgs) {
  const workspace = requireListedWorkspace(ctx, args.workspaceId)
  const limit = normalizeLimit(args.limit, options.maxListSessions)
  // 归档集是注册表全局集合：账目槽位在归档后保留，unarchive 原位恢复。
  // The archive set is registry-global: the accounting slot survives
  // archiving and unarchive restores it in place.
  const archivedIds = new Set<string>(ctx.workspaceRegistry.archivedSessionIds)
  const matches = await collectMatches(ctx, args, workspace, archivedIds)
  return renderSessionList(matches, limit)
}

/**
 * 构建 `workspace_session_list` 工具定义（不注册）：应用目录复用同一份实现。
 * Build the `workspace_session_list` tool definition (unregistered): the app
 * catalog reuses this very implementation.
 * @param ctx - 携带注入能力的宿主上下文。The host context carrying injected capabilities.
 * @param options - 部署开关。The deployment knobs.
 */
export function buildWorkspaceSessionListDefinition(ctx: Context, options: SessionListOptions): ToolDefinition {
  return defineTool({
    name: 'workspace_session_list',
    description:
      'List the sessions accounted under one workspace, newest first. '
      + 'Filter by agentPreset, provider/model (the route of the latest recorded request) '
      + 'and archived state. Sessions whose route cannot be determined (cold sessions '
      + 'without a readable request header) never match a provider or model filter.',
    parameters: SESSION_LIST_PARAMETERS,
    output: {
      // 无损 JSON 输出：结果小而稳定，模型直接读原始值。
      // Lossless JSON output: results are small and stable; the model reads
      // the raw value directly.
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text' as const, text: JSON.stringify(value) }],
    },
    execute: args => executeSessionList(ctx, options, args),
    presentCall: args => ({ card: 'generic', title: 'List workspace sessions', kind: 'other', rawInput: args }),
  })
}
