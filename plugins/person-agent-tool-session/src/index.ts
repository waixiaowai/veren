// 库入口：Person Agent 的会话维护工具构建器（创建/改名/派活/归档/取消归档/
// 置顶/取消置顶）。本包不是插件：没有任何 apply/inject/Config，也不注册到
// ctx.tools——注册动作归应用层（person-agent-app 经页面会话作用域挂载）。
// 分叉由 session-fork-enhanced 插件接管，此处不提供。
// Library entry: the Person Agent session-maintenance tool builders (create /
// rename / dispatch / archive / unarchive / pin / unpin). This package is NOT
// a plugin: no apply/inject/Config, no ctx.tools registration — registration
// belongs to the application layer (person-agent-app mounts through the page
// session's scope). Forking is owned by session-fork-enhanced and is not
// provided here.
//
// 构建器只造定义（defineTool 产物），执行时经闭包里的宿主 ctx 读取
// sessionController / workspaceRegistry / sessions / agents / sessionController。
// A builder only produces a definition (a defineTool product); execution reads
// sessionController / workspaceRegistry / sessions / agents through the host
// ctx captured in the closure.
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-workspace'
import { buildSessionCreateDefinition, buildSessionRenameDefinition, guardRemovedCwd, resolveWorkspaceId } from './tools-management.js'
import { buildSessionDispatchDefinition, requirePrompt } from './tools-dispatch.js'
import {
  buildSessionArchiveDefinition,
  buildSessionPinDefinition,
  buildSessionUnarchiveDefinition,
  buildSessionUnpinDefinition,
} from './tools-state.js'
import { createSettlementWatch } from './watch.js'
import type { ArmingRequest, SettlementWatch, SettlementWatchConfig } from './watch.js'

export {
  buildSessionArchiveDefinition,
  buildSessionCreateDefinition,
  buildSessionDispatchDefinition,
  buildSessionPinDefinition,
  buildSessionRenameDefinition,
  buildSessionUnarchiveDefinition,
  buildSessionUnpinDefinition,
  createSettlementWatch,
  guardRemovedCwd,
  requirePrompt,
  resolveWorkspaceId,
}
export type { ArmingRequest, SettlementWatch, SettlementWatchConfig }
export {
  SessionToolError,
  optionalModelSelection,
  requireTitle,
} from './types.js'
export type {
  NewSessionArgs,
  SessionArchiveArgs,
  SessionCreateArgs,
  SessionCreateResult,
  SessionDispatchArgs,
  SessionDispatchOutcome,
  SessionDispatchResult,
  SessionRenameArgs,
  SessionTargetArgs,
} from './types.js'
export { createSettlementNotice, deliverNotice } from './notice.js'
