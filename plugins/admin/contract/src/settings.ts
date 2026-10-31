/**
 * The `settings` capability: module configuration with optimistic concurrency.
 *
 * `settings` 能力：带乐观并发的模块配置。
 *
 * @module @veren/admin-contract/settings
 */

import type { HealthReport } from './index.ts'

/** The `settings` capability: module configuration with optimistic concurrency. `settings` 能力：带乐观并发的模块配置。 */
export interface AdminSettings {
  /**
   * Read one module's settings.
   * @param module - module id 模块 id
   * @returns the stored values and revision 已存值与版本号
   */
  read(module: string): Promise<{
    /** Stored values. 已存值。 */
    readonly values: Readonly<Record<string, unknown>>
    /** Monotonic revision. 单调版本号。 */
    readonly revision: number
  }>

  /**
   * Replace one module's settings.
   * @param module - module id 模块 id
   * @param values - the complete new values 完整新值
   * @param expectedRevision - required revision for optimistic concurrency 乐观并发要求的版本号
   * @returns the new revision 新版本号
   */
  write(
    module: string,
    values: Readonly<Record<string, unknown>>,
    expectedRevision?: number,
  ): Promise<{ readonly revision: number }>

  /**
   * Probe the provider.
   * @returns the health verdict 健康结论
   */
  health?(): Promise<HealthReport>
}
