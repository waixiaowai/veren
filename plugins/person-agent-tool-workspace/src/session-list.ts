// 工具实现：workspace_session_list——按条件检索一个工作区账目下的会话。
// Tool implementation: workspace_session_list - conditional session search over
// one workspace's accounted sessions.
import { defineTool } from '@deepseek-ai/dsh-tools'
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

/** `registerWorkspaceSessionList` 的部署开关。Deployment knobs of `registerWorkspaceSessionList`. */
export interface SessionListOptions {
  /** 单次调用返回的会话数上限。Maximum sessions returned by one call. */
  maxListSessions: number
}

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
 * 注册 `workspace_session_list`：列出一个工作区账目下的会话，支持按 preset、
 * provider/model 与归档状态检索，创建时间新的在前。
 * Register `workspace_session_list`: list the sessions accounted under one
 * workspace, searchable by preset, provider/model and archive state, newest
 * first.
 * @param ctx - 携带注入能力的宿主上下文。The host context carrying injected capabilities.
 * @param options - 部署开关。The deployment knobs.
 */
export function registerWorkspaceSessionList(ctx: Context, options: SessionListOptions): () => void {
  return ctx.tools.register(
    defineTool({
      name: 'workspace_session_list',
      description:
        'List the sessions accounted under one workspace, newest first. '
        + 'Filter by agentPreset, provider/model (the route of the latest recorded request) '
        + 'and archived state. Sessions whose route cannot be determined (cold sessions '
        + 'without a readable request header) never match a provider or model filter.',
      parameters: {
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
      },
      output: {
        // 无损 JSON 输出：结果小而稳定，模型直接读原始值。
        // Lossless JSON output: results are small and stable; the model reads
        // the raw value directly.
        schema: { type: 'json' },
        render: (_args, value) => [{ type: 'text' as const, text: JSON.stringify(value) }],
      },
      async execute(args) {
        const workspace = ctx.workspaceRegistry.get(args.workspaceId as WorkspaceId)
        if (workspace === undefined) {
          throw new WorkspaceToolError(
            'WORKSPACE_NOT_FOUND',
            `workspace not found: ${args.workspaceId}`,
            { workspaceId: args.workspaceId },
          )
        }
        const limit = normalizeLimit(args.limit, options.maxListSessions)
        // 归档集是注册表全局集合：账目槽位在归档后保留，unarchive 原位恢复。
        // The archive set is registry-global: the accounting slot survives
        // archiving and unarchive restores it in place.
        const archivedIds = new Set<string>(ctx.workspaceRegistry.archivedSessionIds)
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
      },
      presentCall: (args) => ({
        card: 'generic',
        title: 'List workspace sessions',
        kind: 'other',
        rawInput: args,
      }),
    }),
  )
}
