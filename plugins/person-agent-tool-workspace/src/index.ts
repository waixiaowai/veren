// 插件入口：Person Agent 的工作区维护与检索工具（workspace_create /
// workspace_rename / workspace_session_list）。
// Plugin entry: Person Agent workspace maintenance and inspection tools
// (workspace_create / workspace_rename / workspace_session_list).
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
// 类型-only import：拉取 tools 与 workspaceRegistry 服务的 Context 声明合并。
// Type-only imports: pull the tools and workspaceRegistry Context declaration merging.
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-workspace'
// 类型-only import：拉取 sessions / sessionProjections 服务的 Context 声明合并
// （会话事实解析的数据源）。
// Type-only imports: pull the sessions / sessionProjections service Context
// declaration merging (the session-facts data sources).
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-projection'
import { registerWorkspaceCreate, registerWorkspaceRename } from './tools.js'
import { registerWorkspaceSessionList } from './session-list.js'
// 应用目录收编工具时复用同一份定义：把构建器一并从包根导出（纯追加导出）。
// The app catalog reuses the same definitions: re-export the builders from the
// package root (an additive export only).
export { buildWorkspaceCreateDefinition, buildWorkspaceRenameDefinition } from './tools.js'
export { buildWorkspaceSessionListDefinition } from './session-list.js'

export const name = 'personAgentToolWorkspace'

export interface Config {
  /** 是否提供 workspace_create（关掉后只剩改名）。Whether workspace_create is offered (off leaves rename only). */
  allowCreate: boolean
  /** 是否允许工具递归创建缺失目录。Whether the tool may create missing directories recursively. */
  allowCreateDirectory: boolean
  /** 是否提供 workspace_session_list。Whether workspace_session_list is offered. */
  allowListSessions: boolean
  /** 单次会话列表调用的返回上限。Maximum sessions returned by one session-list call. */
  maxListSessions: number
}

export const Config: z<Config> = z
  .object({
    allowCreate: z.boolean().default(true).description('Offer the workspace_create tool.'),
    allowCreateDirectory: z.boolean().default(false).description('Allow workspace_create to create missing directories.'),
    allowListSessions: z.boolean().default(true).description('Offer the workspace_session_list tool.'),
    maxListSessions: z.number().step(1).min(1).default(200).description('Maximum sessions returned by one workspace_session_list call.'),
  })
  .description('Person Agent workspace maintenance tool toggles.')

// 配置形状的类型别名：`Config` 同时是接口类型与 schema 值，测试用别名指接口。
// A type alias for the config shape: `Config` is both an interface type and a
// schema value, so tests use this alias to mean the interface.
export type ConfigShape = Config

// 注入的是能力（Service）：工具注册表、持久化工作区注册表、会话存储与
// 会话投影（会话事实解析的数据源）。
// Injection targets capabilities: the tool registry, the durable workspace
// registry, the session store and session projections (the session-facts
// data sources).
export const inject = ['tools', 'workspaceRegistry', 'sessions', 'sessionProjections']
export const provide = []

export const apply = (ctx: Context, config: Config): void => {
  // effect 的函数体返回卸载函数：register 的精确 disposer 在卸载时被逆序调用，
  // 不泄漏（与 person-agent-preset 的同一写法）。
  // The effect body returns the disposer: register's exact disposer is invoked
  // in reverse order on unload, so nothing leaks (same pattern as the
  // person-agent-preset entry).
  if (config.allowCreate) {
    ctx.effect(() => registerWorkspaceCreate(ctx, { allowCreateDirectory: config.allowCreateDirectory }), 'person-agent-tool-workspace:create')
  }
  ctx.effect(() => registerWorkspaceRename(ctx), 'person-agent-tool-workspace:rename')
  if (config.allowListSessions) {
    ctx.effect(
      () => registerWorkspaceSessionList(ctx, { maxListSessions: config.maxListSessions }),
      'person-agent-tool-workspace:session-list',
    )
  }
}
