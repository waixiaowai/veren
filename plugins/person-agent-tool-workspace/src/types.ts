// 共享类型与结构化错误：工具参数、返回值和带稳定 code 的错误。
// Shared types and structured errors: tool arguments, results, and errors
// carrying a stable code.
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'

/** `workspace_create` 的模型参数。Model-facing arguments of `workspace_create`. */
export interface WorkspaceCreateArgs {
  /** 要注册的目录：完整路径拼写；必须已存在，除非 `createDirectory` 为真。 */
  /** The directory to register: fully qualified path; must exist unless `createDirectory` is true. */
  path: string
  /** 仅在新建记录时使用的显示标题。Display title used only when a new record is created. */
  title?: string
  /** 目录不存在时是否递归创建（默认 false）。Create the directory recursively when missing (default false). */
  createDirectory?: boolean
}

/** `workspace_create` 的返回值。The `workspace_create` result value. */
export interface WorkspaceCreateResult {
  /** 持久化的工作区 id。The durable workspace id. */
  workspaceId: WorkspaceId
  /** 规范化后的目录路径。The canonical directory path. */
  path: string
  /** 生效的显示标题。The effective display title. */
  title: string
  /** 记录是否为本次新建（false = 复用已有记录）。Whether the record was newly created (false = reused). */
  created: boolean
}

/** `workspace_rename` 的模型参数。Model-facing arguments of `workspace_rename`. */
export interface WorkspaceRenameArgs {
  /** 目标工作区 id。The target workspace id. */
  workspaceId: WorkspaceId
  /** 新的显示标题（去空白后非空）。The new display title (non-empty after trim). */
  title: string
}

/** `workspace_rename` 的返回值。The `workspace_rename` result value. */
export interface WorkspaceRenameResult {
  /** 已改名的工作区 id。The renamed workspace id. */
  workspaceId: WorkspaceId
  /** 生效的显示标题。The effective display title. */
  title: string
}

/** `workspace_session_list` 的模型参数。Model-facing arguments of `workspace_session_list`. */
export interface SessionListArgs {
  /** 目标工作区 id。The target workspace id. */
  workspaceId: string
  /** agent preset 精确匹配；省略不过滤。Exact agent preset match; omit to skip. */
  agentPreset?: string
  /** 最近一次请求的 provider 精确匹配；省略不过滤。Exact provider match of the latest request; omit to skip. */
  provider?: string
  /** 最近一次请求的模型 id 精确匹配；省略不过滤。Exact model match of the latest request; omit to skip. */
  model?: string
  /** 归档三态：exclude（默认）/ only / include。The archive tri-state: exclude (default) / only / include. */
  archived?: 'exclude' | 'only' | 'include'
  /** 返回条数上限；缺省取部署上限。Maximum entries returned; defaults to the deployment cap. */
  limit?: number
}

/** `workspace_session_list` 的单条会话条目。One session entry of `workspace_session_list`. */
export interface SessionListEntry {
  /** 会话 id。The session id. */
  sessionId: string
  /** 已接纳的标题（标题能力缺失时 undefined）。The accepted title (undefined without the title capability). */
  title?: string
  /** 创建时间（毫秒时间戳）。Creation time (ms epoch). */
  createdAt: number
  /** 最新生效的 agent preset。The latest-wins agent preset. */
  agentPreset?: string
  /** 最近一次请求的 provider。The provider of the latest request. */
  provider?: string
  /** 最近一次请求的模型 id。The model id of the latest request. */
  model?: string
  /** agent 是否正在运行。Whether the agent is currently running. */
  running: boolean
  /** 是否在归档集。Whether the session is in the archive set. */
  archived: boolean
}

/** `workspace_session_list` 的返回值。The `workspace_session_list` result value. */
export interface SessionListResult {
  /** 截断前的命中总数。The hit count before truncation. */
  total: number
  /** 按 limit 截断后的会话条目（创建时间新的在前）。The entries after the limit cut (newest first). */
  sessions: SessionListEntry[]
}

/** 工具层稳定错误码。Stable tool-layer error codes. */
export type WorkspaceToolErrorCode =
  | 'WORKSPACE_PATH_NOT_A_DIRECTORY'
  | 'WORKSPACE_TITLE_EMPTY'
  | 'WORKSPACE_NOT_FOUND'
  | 'WORKSPACE_CREATE_DIRECTORY_DISABLED'
  | 'WORKSPACE_LIST_LIMIT_INVALID'

/** 带稳定 code 与机器可读字段的结构化错误（misconfiguration fails loud）。 */
/** A structured error with a stable code and machine-readable fields (misconfiguration fails loud). */
export class WorkspaceToolError extends Error {
  readonly code: WorkspaceToolErrorCode
  readonly fields: Record<string, unknown>

  constructor(code: WorkspaceToolErrorCode, message: string, fields: Record<string, unknown>) {
    super(message)
    this.name = 'WorkspaceToolError'
    this.code = code
    this.fields = fields
  }
}

/**
 * 校验标题：去空白后必须非空。Title validation: non-empty after trimming.
 * @param title - 原始输入。The raw input.
 * @returns 去空白后的标题。The trimmed title.
 */
export function requireTitle(title: string): string {
  const trimmed = title.trim()
  if (trimmed === '') {
    throw new WorkspaceToolError('WORKSPACE_TITLE_EMPTY', 'title must be a non-empty string', { title })
  }
  return trimmed
}
