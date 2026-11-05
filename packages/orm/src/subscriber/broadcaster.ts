/**
 * 事件广播器：订阅者先于实体监听器，事件点上串行等待。
 * 订阅者按 `listenTo` 过滤；监听器抛错直接中断当前操作，绝不吞掉。
 *
 * The event broadcaster: subscribers run before entity listeners and events
 * await serially. Subscribers filter by `listenTo`; a throwing listener aborts
 * the current operation and is never swallowed.
 *
 * @module @veren/orm/subscriber/broadcaster
 */

import type { ColumnMetadata, EntityMetadata } from '../metadata/entity-metadata.ts'
import type { BaseEvent, EntitySubscriberInterface } from './subscriber.ts'

/** 可广播的钩子。 / Broadcastable hooks. */
export type SubscriberHook =
  | 'beforeInsert'
  | 'afterInsert'
  | 'beforeUpdate'
  | 'afterUpdate'
  | 'beforeRemove'
  | 'afterRemove'

/** 广播载荷。 / Broadcast payload. */
export interface SubscriberEventData extends BaseEvent {
  databaseEntity?: object
  updatedColumns?: readonly ColumnMetadata[]
}

/** 事件广播器。 / The event broadcaster. */
export class Broadcaster {
  constructor(private readonly subscribers: readonly EntitySubscriberInterface<object>[]) {}

  /** 广播一个事件点。 / Broadcast one event point. */
  async broadcast(hook: SubscriberHook, event: SubscriberEventData): Promise<void> {
    for (const subscriber of this.matching(event.metadata)) {
      const handler = subscriber[hook] as ((payload: SubscriberEventData) => Promise<void> | void) | undefined
      if (typeof handler === 'function') await handler.call(subscriber, event)
    }
  }

  /** 命中本实体的订阅者；未声明 `listenTo` 视为全局收听。 / Subscribers that match this entity; no `listenTo` means listen globally. */
  private matching(metadata: EntityMetadata): readonly EntitySubscriberInterface<object>[] {
    return this.subscribers.filter((subscriber) => {
      const listenTo = subscriber.listenTo?.()
      return listenTo === undefined || listenTo === metadata.target
    })
  }
}
