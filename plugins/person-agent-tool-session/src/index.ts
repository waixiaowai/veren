// 插件入口：Person Agent 的会话维护工具（创建/改名/归档/取消归档/置顶/
// 取消置顶/派活）。分叉由 session-fork-enhanced 插件接管，此处不注册。
// Plugin entry: Person Agent session maintenance tools (create / rename /
// archive / unarchive / pin / unpin / dispatch). Forking is owned by the
// session-fork-enhanced plugin and is not registered here.
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
// 类型-only import：拉取 tools、agents、sessions、sessionController 与
// workspaceRegistry 的 Context 声明合并。
// Type-only imports: pull the tools, agents, sessions, sessionController, and
// workspaceRegistry Context declaration merging.
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-workspace'
import { registerSessionCreate, registerSessionRename } from './tools-management.js'
// 应用目录收编工具时复用同一份定义：把构建器一并从包根导出（纯追加导出）。
// The app catalog reuses the same definitions: re-export the builders from the
// package root (an additive export only).
export { buildSessionCreateDefinition, buildSessionRenameDefinition } from './tools-management.js'
import { registerSessionDispatch } from './tools-dispatch.js'
import {
  registerSessionArchive,
  registerSessionPin,
  registerSessionUnarchive,
  registerSessionUnpin,
} from './tools-state.js'
import { createSettlementWatch } from './watch.js'

export const name = 'personAgentToolSession'

export interface Config {
  /** 是否提供 session_create。Whether session_create is offered. */
  allowCreate: boolean
  /** 是否提供 session_dispatch。Whether session_dispatch is offered. */
  allowDispatch: boolean
  /** 是否提供归档/取消归档。Whether archive/unarchive are offered. */
  allowArchive: boolean
  /** 是否提供置顶/取消置顶。Whether pin/unpin are offered. */
  allowPin: boolean
  /** 结算通知里收尾输出的长度上限（字符）。Character cap for a settlement notice's closing output. */
  maxReportChars: number
  /** 同时挂起的结算看守上限。Cap on concurrently armed settlement watches. */
  maxConcurrentWatches: number
}

export const Config: z<Config> = z
  .object({
    allowCreate: z.boolean().default(true).description('Offer the session_create tool.'),
    allowDispatch: z.boolean().default(true).description('Offer the session_dispatch tool (hand a prompt to a session, return at once, then report its closing output back once it settles).'),
    allowArchive: z.boolean().default(true).description('Offer the session_archive and session_unarchive tools.'),
    allowPin: z.boolean().default(true).description('Offer the session_pin and session_unpin tools.'),
    maxReportChars: z.natural().min(1).default(4000).description('Character cap for a settlement notice\'s closing output; longer text is truncated with an ellipsis.'),
    maxConcurrentWatches: z.natural().min(1).default(64).description('Cap on concurrently armed settlement watches; further reporting dispatches are rejected once it is reached.'),
  })
  .description('Person Agent session maintenance tool toggles.')

// 配置形状的类型别名：`Config` 同时是接口类型与 schema 值，测试用别名指接口。
// A type alias for the config shape: `Config` is both an interface type and a
// schema value, so tests use this alias to mean the interface.
export type ConfigShape = Config

// 注入的是能力（Service）：工具注册表、存活 Agent 注册表、会话存储、宿主 Session
// 业务 API、持久化工作区注册表（归档/置顶集合的 owner）。
// Injection targets capabilities: the tool registry, the live Agent registry,
// the session store, the host Session business API, and the durable workspace
// registry (owner of the archive/pin sets).
export const inject = ['tools', 'agents', 'sessions', 'sessionController', 'workspaceRegistry']
export const provide = []

/**
 * 注册全部启用的工具；effect 函数体返回精确卸载函数，卸载时逆序调用，不泄漏。
 * Register every enabled tool; each effect body returns the exact disposer,
 * invoked in reverse order on unload, so nothing leaks.
 * @param ctx - 宿主上下文。The host context.
 * @param config - 工具开关与结算回报上限。The tool toggles and settlement-report bounds.
 */
export const apply = (ctx: Context, config: Config): void => {
  if (config.allowCreate) ctx.effect(() => registerSessionCreate(ctx), 'person-agent-tool-session:create')
  ctx.effect(() => registerSessionRename(ctx), 'person-agent-tool-session:rename')
  if (config.allowDispatch) {
    // 取消器先注册、工具后注册：卸载时工具先摘除，随后结清所有挂起的看守，
    // 让正挂在 whenIdle() 上的观察者醒来即返回，不会去碰已失效的 Context。
    // The canceller registers first and the tool second, so unload removes the
    // tool before settling every pending watch: an observer parked on whenIdle()
    // then wakes into `settled` and returns without touching the inactive Context.
    const watch = createSettlementWatch(ctx, config)
    ctx.effect(() => () => watch.dispose(), 'person-agent-tool-session:dispatch-watch')
    ctx.effect(() => registerSessionDispatch(ctx, watch), 'person-agent-tool-session:dispatch')
  }
  if (config.allowArchive) {
    ctx.effect(() => registerSessionArchive(ctx), 'person-agent-tool-session:archive')
    ctx.effect(() => registerSessionUnarchive(ctx), 'person-agent-tool-session:unarchive')
  }
  if (config.allowPin) {
    ctx.effect(() => registerSessionPin(ctx), 'person-agent-tool-session:pin')
    ctx.effect(() => registerSessionUnpin(ctx), 'person-agent-tool-session:unpin')
  }
}
