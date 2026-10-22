// 库入口：Person Agent 的工作区维护与检索工具构建器（workspace_create /
// workspace_rename / workspace_session_list）。本包不是插件：没有
// apply/inject/Config，也不注册到 ctx.tools——注册动作归应用层
// （person-agent-app 经页面会话作用域挂载）。
// Library entry: the Person Agent workspace maintenance and inspection tool
// builders (workspace_create / workspace_rename / workspace_session_list).
// This package is NOT a plugin: no apply/inject/Config, no ctx.tools
// registration — registration belongs to the application layer
// (person-agent-app mounts through the page session's scope).
// 类型-only import：拉取 tools 与 workspaceRegistry 服务的 Context 声明合并。
// Type-only imports: pull the tools and workspaceRegistry Context declaration merging.
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-workspace'
// 类型-only import：拉取 sessions / sessionProjections 服务的 Context 声明合并
// （会话事实解析的数据源）。
// Type-only imports: pull the sessions / sessionProjections services Context
// declaration merging (the session-facts data sources).
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-projection'
import { buildWorkspaceCreateDefinition, buildWorkspaceRenameDefinition } from './tools.js'
import { buildWorkspaceSessionListDefinition } from './session-list.js'
import type { SessionListOptions } from './session-list.js'
import type { WorkspaceCreateOptions } from './tools.js'

export { buildWorkspaceCreateDefinition, buildWorkspaceRenameDefinition }
export { buildWorkspaceSessionListDefinition }
export type { SessionListOptions, WorkspaceCreateOptions }
export { WorkspaceToolError, requireTitle } from './types.js'
export type { WorkspaceCreateArgs, WorkspaceRenameArgs, SessionListArgs, SessionListEntry } from './types.js'
