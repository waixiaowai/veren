/**
 * 事件订阅契约：订阅者按 `listenTo` 过滤，实体监听器只收本实体事件。
 * 事件是通知，不拦截执行；监听器抛错则中断当前操作。
 *
 * The subscriber contract: subscribers filter by `listenTo`, entity listeners
 * only see their own entity's events. Events notify, they never intercept; a
 * throwing listener aborts the current operation.
 *
 * @module @veren/orm/subscriber/subscriber
 */

import type { ColumnMetadata, EntityMetadata } from '../metadata/entity-metadata.ts'

/** 事件公共载荷。 / Common event payload. */
export interface BaseEvent<Entity extends object = object> {
  entity: Entity
  metadata: EntityMetadata
  queryRunner?: unknown
}

/** 插入事件。 / Insert event. */
export type InsertEvent<Entity extends object = object> = BaseEvent<Entity>

/** 更新事件。 / Update event. */
export interface UpdateEvent<Entity extends object = object> extends BaseEvent<Entity> {
  databaseEntity: Entity
  updatedColumns: readonly ColumnMetadata[]
}

/** 删除事件。 / Remove event. */
export type RemoveEvent<Entity extends object = object> = BaseEvent<Entity>

/** 加载事件。 / Load event. */
export type LoadEvent<Entity extends object = object> = BaseEvent<Entity>

/** 订阅者接口；只实现关心的钩子即可。 / Subscriber interface; implement only the hooks you need. */
export interface EntitySubscriberInterface<Entity extends object = object> {
  listenTo?(): Function
  afterLoad?(entity: Entity, event?: LoadEvent<Entity>): Promise<void> | void
  beforeInsert?(event: InsertEvent<Entity>): Promise<void> | void
  afterInsert?(event: InsertEvent<Entity>): Promise<void> | void
  beforeUpdate?(event: UpdateEvent<Entity>): Promise<void> | void
  afterUpdate?(event: UpdateEvent<Entity>): Promise<void> | void
  beforeRemove?(event: RemoveEvent<Entity>): Promise<void> | void
  afterRemove?(event: RemoveEvent<Entity>): Promise<void> | void
}
