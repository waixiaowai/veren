// 插件入口：Person Agent 的会话维护工具（创建/改名/分叉/归档/取消归档/置顶/
// 取消置顶/派活）。
// Plugin entry: Person Agent session maintenance tools (create / rename /
// fork / archive / unarchive / pin / unpin / prompt).
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
// 类型-only import：拉取 tools、sessionController 与 workspaceRegistry 的
// Context 声明合并。
// Type-only imports: pull the tools, sessionController, and workspaceRegistry
// Context declaration merging.
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-workspace'
import { registerSessionCreate, registerSessionFork, registerSessionRename } from './tools-management.js'
import { registerSessionPrompt } from './tools-prompt.js'
import {
  registerSessionArchive,
  registerSessionPin,
  registerSessionUnarchive,
  registerSessionUnpin,
} from './tools-state.js'

export const name = 'personAgentToolSession'

export interface Config {
  /** 是否提供 session_create。Whether session_create is offered. */
  allowCreate: boolean
  /** 是否提供 session_prompt。Whether session_prompt is offered. */
  allowPrompt: boolean
  /** 是否提供 session_fork。Whether session_fork is offered. */
  allowFork: boolean
  /** 是否提供归档/取消归档。Whether archive/unarchive are offered. */
  allowArchive: boolean
  /** 是否提供置顶/取消置顶。Whether pin/unpin are offered. */
  allowPin: boolean
}

export const Config: z<Config> = z
  .object({
    allowCreate: z.boolean().default(true).description('Offer the session_create tool.'),
    allowPrompt: z.boolean().default(true).description('Offer the session_prompt tool (deliver a prompt into a session and wake it).'),
    allowFork: z.boolean().default(true).description('Offer the session_fork tool.'),
    allowArchive: z.boolean().default(true).description('Offer the session_archive and session_unarchive tools.'),
    allowPin: z.boolean().default(true).description('Offer the session_pin and session_unpin tools.'),
  })
  .description('Person Agent session maintenance tool toggles.')

// 配置形状的类型别名：`Config` 同时是接口类型与 schema 值，测试用别名指接口。
// A type alias for the config shape: `Config` is both an interface type and a
// schema value, so tests use this alias to mean the interface.
export type ConfigShape = Config

// 注入的是能力（Service）：工具注册表、宿主 Session 业务 API、持久化工作区
// 注册表（归档/置顶集合的 owner）。
// Injection targets capabilities: the tool registry, the host Session business
// API, and the durable workspace registry (owner of the archive/pin sets).
export const inject = ['tools', 'sessionController', 'workspaceRegistry']
export const provide = []

/**
 * 注册全部启用的工具；effect 函数体返回精确卸载函数，卸载时逆序调用，不泄漏。
 * Register every enabled tool; each effect body returns the exact disposer,
 * invoked in reverse order on unload, so nothing leaks.
 * @param ctx - 宿主上下文。The host context.
 * @param config - 工具开关。The tool toggles.
 */
export const apply = (ctx: Context, config: Config): void => {
  if (config.allowCreate) ctx.effect(() => registerSessionCreate(ctx), 'person-agent-tool-session:create')
  ctx.effect(() => registerSessionRename(ctx), 'person-agent-tool-session:rename')
  if (config.allowPrompt) ctx.effect(() => registerSessionPrompt(ctx), 'person-agent-tool-session:prompt')
  if (config.allowFork) ctx.effect(() => registerSessionFork(ctx), 'person-agent-tool-session:fork')
  if (config.allowArchive) {
    ctx.effect(() => registerSessionArchive(ctx), 'person-agent-tool-session:archive')
    ctx.effect(() => registerSessionUnarchive(ctx), 'person-agent-tool-session:unarchive')
  }
  if (config.allowPin) {
    ctx.effect(() => registerSessionPin(ctx), 'person-agent-tool-session:pin')
    ctx.effect(() => registerSessionUnpin(ctx), 'person-agent-tool-session:unpin')
  }
}
