/**
 * Operation payload shapes of the IM contract: static capabilities, the
 * authorization attempt lifecycle, and the explicit-send request/result.
 *
 * IM 契约的操作载荷形状：静态能力、授权尝试生命周期，以及显式发送的请求与结果。
 *
 * @module @veren/im/contract-bind
 */

import type { ImAccount, ImMessageContent } from './contract-model.ts'

/** Capabilities a provider declares statically. */
/** provider 静态声明的能力。 */
export interface ImFeatures {
  direct: boolean
  group: boolean
  threads: boolean
  markdown: boolean
  media: { image: boolean; file: boolean }
  typing: boolean
  auth: ReadonlyArray<'qrcode' | 'oauth' | 'token' | 'password'>
  limits: { textChars?: number; fileBytes?: number }
}

/** How one account authorization starts. */
/** 一次账号授权如何发起。 */
export type ImBindRequest =
  | { method: 'qrcode'; label?: string }
  | { method: 'oauth'; label?: string }
  | { method: 'token'; token: string; label?: string }
  | { method: 'password'; username: string; password: string; label?: string }

/** Human-facing challenge produced by an authorization attempt. */
/** 授权尝试产出的人类可读质询。 */
export interface ImBindChallenge {
  kind: 'qrcode' | 'device-code' | 'url'
  /** Remote challenge URL; never exposed through a tool result or a log. */
  /** 远端质询 URL；绝不通过工具结果或日志外泄。 */
  url?: string
  /** Local PNG path for a QR challenge; safe to return to the caller. */
  /** 二维码质询的本地 PNG 路径；可以返回给调用方。 */
  imagePath?: string
  userCode?: string
  expiresAt?: number
}

/** One authorization attempt's state. */
/** 一次授权尝试的状态。 */
export type ImBindStatus = 'pending' | 'scanned' | 'needs-code' | 'bound' | 'expired' | 'failed'

/** A live authorization attempt; the provider advances it in the background. */
/** 活跃的授权尝试；provider 在后台推进它。 */
export interface ImBindAttempt {
  bindId: string
  readonly status: ImBindStatus
  challenge?: ImBindChallenge
  submitCode?(code: string): Promise<void>
  wait(signal?: AbortSignal): Promise<ImAccount>
  cancel(): Promise<void>
}

/** One explicit outbound destination. */
/** 一个显式的出站目的地。 */
export interface ImSendTarget {
  accountId: string
  conversationId: string
}

/** One send request; `target` is always explicit. */
/** 一个发送请求；`target` 永远显式给出。 */
export interface ImSendRequest {
  target: ImSendTarget
  content: ImMessageContent
  replyToMessageId?: string
}

/** One send result. */
/** 一个发送结果。 */
export interface ImSendResult {
  id: string
  sentAt: number
  /** True when the message may have been delivered. */
  /** 消息可能已送达时为真。 */
  uncertain?: boolean
}

/**
 * Per-conversation agent settings. Bindings are gone (2.1.8): the shape stays
 * because session creation and the model tools still speak it.
 * 按会话的 agent 设置。绑定已删除（2.1.8）：会话创建与模型工具仍使用该形状，故类型保留。
 */
export type ImBindingSettings = {
  presetId?: string
  provider?: string
  model?: string
  reasoning?: string
}
