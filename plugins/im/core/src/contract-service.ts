/**
 * The provider behavior contract: the six operations every channel implements,
 * the registration descriptor that pairs them with identity and capabilities,
 * and the handler type the registry feeds inbound messages through.
 *
 * provider 行为契约：每个渠道都要实现的六个操作，把它们与身份、能力配对的注册描述符，
 * 以及 registry 投递入站消息所经过的回调类型。
 *
 * @module @veren/im/contract-service
 */

import type { ImAccount, ImMessage } from './contract-model.ts'
import type { ImBindAttempt, ImBindRequest, ImSendRequest, ImSendResult } from './contract-bind.ts'
import type { ImFeatures } from './contract-bind.ts'

/**
 * The behavior every provider implements.
 *
 * Identity and capabilities live on `ImProvider`; this interface intentionally
 * carries only the six operations the router and tools need.
 * 每个 provider 实现的行为。
 *
 * 身份与能力在 `ImProvider` 上；本接口刻意只携带路由与工具需要的六个操作。
 */
export interface ImService {
  start(): Promise<void>
  stop(): Promise<void>
  accounts(): Promise<ImAccount[]>
  listen(
    handler: (message: ImMessage) => void | Promise<void>,
    signal?: AbortSignal,
  ): () => void
  bind(request: ImBindRequest): Promise<ImBindAttempt>
  send(request: ImSendRequest): Promise<ImSendResult>
  /**
   * Remove one account's runtime state and local files. Optional: providers
   * without it fall back to a full runtime stop/restart around account removal.
   * 删除单账号的运行时状态与本地文件。可选：未实现的 provider 退回整体 stop/restart。
   */
  removeAccount?(accountId: string): Promise<void>
}

/** Registration descriptor: provider identity, capabilities, and behavior. */
/** 注册描述符：provider 的身份、能力与行为。 */
export interface ImProvider {
  id: string
  displayName: string
  features: ImFeatures
  service: ImService
}

/** Callback the registry uses to hand an inbound message to the router. */
/** registry 把入站消息交给路由所用的回调。 */
export type ImMessageHandler = (providerId: string, message: ImMessage) => void | Promise<void>
