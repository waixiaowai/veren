/**
 * 迁移执行器：账本建表、pending 判定、按时间戳升序执行、单条回退。
 * 每条迁移在自己的事务里执行；账本行与 DDL 同生共死。
 *
 * The migration executor: create the ledger, decide pending work, run in
 * timestamp order and revert one step. Each migration runs in its own
 * transaction; the ledger row and the DDL live or die together.
 *
 * @module @veren/orm/migration/executor
 */

import type { QueryRunner } from '../driver/query-runner.ts'
import { MigrationError } from '../errors/index.ts'
import type { DataSource } from '../runtime/data-source.ts'
import { migrationFromClass, type Migration, type MigrationInterface } from './migration.ts'

/** 迁移执行器。 / The migration executor. */
export class MigrationExecutor {
  private readonly tableName: string

  constructor(private readonly dataSource: DataSource) {
    this.tableName = dataSource.options.migrationsTableName ?? 'migrations'
  }

  /** 执行全部 pending。 / Run every pending migration. */
  async executePendingMigrations(): Promise<Migration[]> {
    const runner = await this.openRunner()
    try {
      await this.ensureTable(runner)
      const declared = this.declaredMigrations()
      const executed = await this.loadExecuted(runner)
      const executedNames = new Set(executed.map((migration) => migration.name))
      const pending = declared.filter((migration) => !executedNames.has(migration.name))
      const applied: Migration[] = []
      for (const migration of pending) applied.push(await this.applyOne(runner, migration))
      return applied
    } finally {
      await runner.release()
    }
  }

  /** 回退最后一条。 / Revert the last migration. */
  async undoLastMigration(): Promise<void> {
    const runner = await this.openRunner()
    try {
      await this.ensureTable(runner)
      const executed = await this.loadExecuted(runner)
      const last = executed.at(-1)
      if (last === undefined) return
      const declared = this.declaredMigrations().find((migration) => migration.name === last.name)
      if (declared?.instance === undefined) throw new MigrationError(last.name, 'the migration file is missing, so it cannot be reverted')
      await this.inTransaction(runner, async () => {
        await declared.instance!.down(runner)
        await this.deleteRecord(runner, last.name)
      })
    } finally {
      await runner.release()
    }
  }

  /** 声明与账本合并后的状态。 / Declared migrations merged with the ledger. */
  async showMigrations(): Promise<Migration[]> {
    const runner = await this.openRunner()
    try {
      await this.ensureTable(runner)
      const executed = await this.loadExecuted(runner)
      const executedMap = new Map(executed.map((migration) => [migration.name, migration]))
      return this.declaredMigrations().map((migration) => executedMap.get(migration.name) ?? migration)
    } finally {
      await runner.release()
    }
  }

  /** 声明的迁移按时间戳升序；重复名直接拒绝。 / Declared migrations sorted by timestamp; duplicate names are rejected. */
  private declaredMigrations(): Migration[] {
    const migrations = this.dataSource.migrations.map((MigrationClass) => migrationFromClass(MigrationClass))
    const seen = new Set<string>()
    for (const migration of migrations) {
      if (seen.has(migration.name)) throw new MigrationError(migration.name, 'duplicate migration name')
      seen.add(migration.name)
    }
    return migrations.sort((left, right) => left.timestamp - right.timestamp)
  }

  /** 单条执行 + 记账。 / Apply one migration and record it. */
  private async applyOne(runner: QueryRunner, migration: Migration): Promise<Migration> {
    await this.inTransaction(runner, async () => {
      await migration.instance!.up(runner)
      await this.insertRecord(runner, migration)
    })
    return migration
  }

  /** 在支持事务的方言上包一层事务；不支持时直接执行。 / Wrap in a transaction when supported; otherwise run directly. */
  private async inTransaction(runner: QueryRunner, work: () => Promise<void>): Promise<void> {
    if (!this.dataSource.driver.dialect.capabilities.transactions) {
      await work()
      return
    }
    await runner.startTransaction()
    try {
      await work()
      await runner.commitTransaction()
    } catch (error) {
      if (runner.isTransactionActive) await runner.rollbackTransaction()
      throw error
    }
  }

  /** 账本建表（幂等）。 / Create the ledger (idempotent). */
  private async ensureTable(runner: QueryRunner): Promise<void> {
    const escape = this.dataSource.driver.dialect.escape.bind(this.dataSource.driver.dialect)
    const id = this.driverName() === 'sqlite'
      ? 'INTEGER PRIMARY KEY AUTOINCREMENT'
      : this.driverName() === 'mysql' ? 'INT AUTO_INCREMENT PRIMARY KEY' : 'SERIAL PRIMARY KEY'
    await runner.query(`CREATE TABLE IF NOT EXISTS ${escape(this.tableName)} (${escape('id')} ${id}, ${escape('timestamp')} BIGINT NOT NULL, ${escape('name')} VARCHAR(255) NOT NULL)`)
  }

  /** 读出账本。 / Read the ledger. */
  private async loadExecuted(runner: QueryRunner): Promise<Migration[]> {
    const escape = this.dataSource.driver.dialect.escape.bind(this.dataSource.driver.dialect)
    const result = await runner.query(`SELECT ${escape('id')}, ${escape('timestamp')}, ${escape('name')} FROM ${escape(this.tableName)} ORDER BY ${escape('id')} ASC`)
    return result.rows.map((row) => ({
      id: Number(row.id),
      timestamp: Number(row.timestamp),
      name: String(row.name),
    }))
  }

  /** 写入账本行。 / Insert a ledger row. */
  private async insertRecord(runner: QueryRunner, migration: Migration): Promise<void> {
    const [sql, parameters] = this.dataSource.driver.escapeQueryWithParameters(
      `INSERT INTO ${this.escape(this.tableName)} (${this.escape('timestamp')}, ${this.escape('name')}) VALUES (:timestamp, :name)`,
      { timestamp: migration.timestamp, name: migration.name },
    )
    await runner.query(sql, parameters)
  }

  /** 删除账本行。 / Delete a ledger row. */
  private async deleteRecord(runner: QueryRunner, name: string): Promise<void> {
    const [sql, parameters] = this.dataSource.driver.escapeQueryWithParameters(
      `DELETE FROM ${this.escape(this.tableName)} WHERE ${this.escape('name')} = :name`,
      { name },
    )
    await runner.query(sql, parameters)
  }

  /** 打开执行器。 / Open a query runner. */
  private async openRunner(): Promise<QueryRunner> {
    const runner = this.dataSource.createQueryRunner()
    await runner.connect()
    return runner
  }

  /** 方言名快捷读取。 / Shortcut to the dialect name. */
  private driverName(): string {
    return this.dataSource.driver.dialect.name
  }

  /** 标识符转义快捷方法。 / Shortcut for identifier escaping. */
  private escape(identifier: string): string {
    return this.dataSource.driver.dialect.escape(identifier)
  }
}

/** 迁移实例的类型出口。 / Type export for migration instances. */
export type { MigrationInterface }
