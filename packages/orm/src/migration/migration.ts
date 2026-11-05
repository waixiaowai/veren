/**
 * 迁移契约：一个类就是一次版本化模式演进。
 * 类名末尾的 13 位时间戳是身份与排序的唯一依据；缺失即拒绝执行。
 *
 * The migration contract: one class is one versioned schema evolution. The
 * 13-digit timestamp at the end of the class name is the sole identity and
 * ordering key; a missing one is rejected.
 *
 * @module @veren/orm/migration/migration
 */

import { MigrationError } from '../errors/index.ts'
import type { QueryRunner } from '../driver/query-runner.ts'

/** 迁移实现。 / A migration implementation. */
export interface MigrationInterface {
  name?: string
  transaction?: boolean
  up(queryRunner: QueryRunner): Promise<void>
  down(queryRunner: QueryRunner): Promise<void>
}

/** 迁移记录与声明。 / A migration record and declaration. */
export interface Migration {
  id?: number
  timestamp: number
  name: string
  instance?: MigrationInterface
}

/** 提取类名末尾 13 位时间戳；非法即拒绝。 / Extract the trailing 13-digit timestamp; invalid names are rejected. */
export function migrationTimestamp(name: string): number {
  const match = /(\d{13})$/.exec(name)
  if (match === null) {
    throw new MigrationError(name, 'migration class names must end with a 13-digit timestamp, for example "AddUsers1712345678901"')
  }
  return Number(match[1])
}

/** 从类构造迁移记录。 / Build a migration record from a class. */
export function migrationFromClass(MigrationClass: new () => MigrationInterface): Migration {
  const instance = new MigrationClass()
  const name = instance.name ?? MigrationClass.name
  return { name, timestamp: migrationTimestamp(name), instance }
}
