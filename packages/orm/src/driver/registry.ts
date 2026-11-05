/**
 * 方言注册表：数据库类型可扩展的唯一入口。
 * 第三方方言只需 `registerDriver({ type, create })`，业务侧通过 `type` 名引用，
 * 核心不出现任何 `if (type === 'postgres')` 分支。
 *
 * Dialect registry: the single extension point for database types. A
 * third-party dialect calls `registerDriver({ type, create })` and business code
 * refers to it by `type`; the core never branches on a dialect name.
 *
 * @module @veren/orm/driver/registry
 */

import { MissingDriverError } from '../errors/index.ts'
import type { DataSourceOptions } from '../types.ts'
import type { Driver } from './driver.ts'

/** 一个可注册的驱动。 / One registerable driver. */
export interface DriverDefinition {
  readonly type: string
  create(options: DataSourceOptions): Driver
}

/** 进程级注册表；重复注册保持首次实现（双份库副本共存时不炸）。 / Process-level registry; duplicate registration keeps the first implementation (survives two library copies). */
const registry = new Map<string, DriverDefinition>()

/** 注册一个方言；同类型重复注册是幂等空操作。 / Register a dialect; duplicate types are a no-op. */
export function registerDriver(definition: DriverDefinition): void {
  if (!registry.has(definition.type)) registry.set(definition.type, definition)
}

/** 按类型取驱动定义；未知类型抛 MissingDriverError。 / Look up a driver; unknown types throw MissingDriverError. */
export function getDriverDefinition(type: string): DriverDefinition {
  const definition = registry.get(type)
  if (definition === undefined) throw new MissingDriverError(type, [...registry.keys()].sort())
  return definition
}

/** 已注册类型清单（诊断用）。 / Registered types, for diagnostics. */
export function getRegisteredDriverTypes(): string[] {
  return [...registry.keys()].sort()
}

/** 是否已注册某类型。 / Whether a type is registered. */
export function hasDriver(type: string): boolean {
  return registry.has(type)
}
