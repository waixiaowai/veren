/**
 * The auth database: a @veren/orm DataSource over the sqlite driver. The
 * database file lives under the harness home's storages directory by default
 * (overridable via config), the table models come from @veren/auth-core, and
 * schema sync runs at startup so a fresh home is usable immediately.
 * 认证数据库：@veren/orm sqlite 驱动之上的 DataSource。数据库文件默认位于
 * harness home 的 storages 目录（可用配置覆盖），表模型来自 @veren/auth-core，
 * 启动期执行 schema 同步让全新 home 立即可用。
 * @module src/database
 */

import { homedir } from 'node:os'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { DataSource } from '@veren/orm'
import '@veren/orm/driver/sqlite'
import { createAuthEntities, getAuthTables } from '@veren/auth-core'

/** The auth table set of this deployment (rate limiting counts in memory). 本部署的认证表集合（限流计数走内存）。 */
const TABLES = getAuthTables({ rateLimitStorage: 'memory' })

/**
 * Resolve the sqlite file location: an explicit config path wins; otherwise
 * the storages directory of the resolved harness home.
 * 解析 sqlite 文件位置：显式配置路径优先；否则落到解析出的 harness home 的
 * storages 目录。
 * @param configured - The configured `database.file` value (`''` = default).
 * @returns the absolute database file path.
 */
export function resolveDatabaseFile(configured: string | undefined): string {
  if (configured !== undefined && configured !== '') return configured
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  return join(home, 'storages', 'web_login_gate', 'auth.db')
}

/**
 * Open the auth DataSource: create the parent directory, initialize, and
 * sync the schema. Any failure fails the plugin load loudly.
 * 打开认证 DataSource：创建父目录、初始化并同步 schema。任何失败都让插件
 * 加载显式失败。
 * @param file - The absolute sqlite file path. sqlite 文件绝对路径。
 * @returns the initialized DataSource.
 */
export async function openAuthDatabase(file: string): Promise<DataSource> {
  await mkdir(dirname(file), { recursive: true })
  const dataSource = new DataSource({
    type: 'sqlite',
    filename: file,
    entities: createAuthEntities(TABLES),
    synchronize: true,
  })
  try {
    await dataSource.initialize()
    return dataSource
  } catch (error) {
    await dataSource.destroy().catch(() => undefined)
    throw new Error(
      `web-login-gate: opening the auth database at '${file}' failed: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}
