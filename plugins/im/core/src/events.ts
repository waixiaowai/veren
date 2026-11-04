/**
 * Core-owned family events: the moment a channel observation enters the
 * pipeline. This is the single hand-off point between channel adapters and the
 * conversation domain — the registry emits, the conversation package ingests.
 *
 * 核心拥有的家族事件：渠道观察进入管线的瞬间。这是渠道适配器与会话域之间唯一的交接点——
 * registry 负责发出，conversation 包负责吸收。
 *
 * Dependency direction is enforced by ownership: only the emitter's package
 * declares the event, consumers import the payload type. Later stages own
 * their own events (`im/message-new` in @veren/im-conversation,
 * `im/wake-request` in @veren/im-coordination, `im/run-updated` in
 * @veren/im-turn); wake decisions are never expressed here.
 * 依赖方向由归属强制：事件只由发出方的包声明，消费方导入载荷类型。后续各阶段拥有自己的
 * 事件（`im/message-new` 在 @veren/im-conversation，`im/wake-request` 在
 * @veren/im-coordination，`im/run-updated` 在 @veren/im-turn）；唤醒决策绝不在此表达。
 *
 * @module @veren/im/events
 */

import type { ImMessage } from './contract-model.ts'

/** One channel observation handed from an adapter into the conversation domain. */
/** 一条由适配器交接进会话域的渠道观察。 */
export interface ImMessageObserved {
  /** Provider that observed the message. */
  /** 观察到这条消息的 provider。 */
  readonly providerId: string
  /** The normalized inbound message. */
  /** 归一化的入站消息。 */
  readonly message: ImMessage
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * A channel adapter observed one inbound message (pure notification, no
     * interception). Emitted once per provider-observed message; the
     * conversation domain turns it into a durable room message.
     * 渠道适配器观察到一条入站消息（纯通知，无拦截面）。每条 provider 观察到的消息发一次；
     * 会话域把它变成一条持久的房间消息。
     * @mode emit
     */
    'im/message-observed': (payload: ImMessageObserved) => void
  }
}
