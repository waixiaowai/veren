/**
 * Provider-neutral IM contract and registry.
 * Providers implement ImService and register one ImProvider; the host routes
 * through ImRegistry, never a channel singleton.
 *
 * This file is the thin contract facade: it re-exports the split
 * responsibility modules unchanged. The pure data model (accounts,
 * conversations, contacts, claims, messages) lives in `contract-model.ts`.
 *
 * 渠道无关的 IM 契约与注册表：provider 实现 ImService 并注册一个 ImProvider；宿主只通过
 * ImRegistry 路由，不依赖渠道单例。
 *
 * 本文件是契约的薄门面：原样再导出按职责拆开的各模块。纯数据模型（账号、会话、联系方式、
 * 自述、消息）在 `contract-model.ts`。
 *
 * @module @veren/im/contract
 */

// ---- data model: declared in contract-model.ts, re-exported unchanged ----
// ---- 数据模型：声明在 contract-model.ts，原样再导出 ----
export type {
  ImAccount,
  ImAccountView,
  ImConversation,
  ImConversationView,
  ImMessage,
  ImMessageContent,
  ImPersonClaim,
  ImPersonContact,
  ImUser,
} from './contract-model.ts'
export type {
  ImDirectoryRemote,
  ImDirectorySnapshot,
  ImDirectoryUpsert,
} from './contract-directory.ts'
export type {
  ImBindAttempt,
  ImBindChallenge,
  ImBindRequest,
  ImBindStatus,
  ImBindingSettings,
  ImFeatures,
  ImSendRequest,
  ImSendResult,
  ImSendTarget,
} from './contract-bind.ts'
export { ImError } from './contract-errors.ts'
export type { ImErrorCode } from './contract-errors.ts'
export type {
  ImMessageHandler,
  ImProvider,
  ImService,
} from './contract-service.ts'
export { ImRegistry, ImToken, imCredentialKey } from './contract-registry.ts'
