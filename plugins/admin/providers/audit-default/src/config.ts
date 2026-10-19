/**
 * Audit provider configuration: the entry cap and the retention window.
 *
 * Both knobs bound the stored trail. They are validated here, not in the
 * provider, so a misconfigured deployment fails at load instead of silently
 * keeping (or dropping) the wrong amount of history.
 *
 * 审计 provider 配置：条目上限与保留窗口。两个开关共同约束已存轨迹。校验放在这里而不是
 * provider 内部，因此配置错误会在加载时失败，而不是静默保留（或丢弃）错误数量的历史。
 *
 * @module @veren/admin-audit-default/config
 */

import z from '@deepseek-ai/schemastery'
import { AdminError } from '@veren/admin-contract'

/** Entry cap applied when the plugin config omits `maxEntries`. 插件配置省略 `maxEntries` 时采用的条目上限。 */
export const DEFAULT_MAX_ENTRIES = 100_000

/** Retention window applied when the plugin config omits `retentionDays`. 插件配置省略 `retentionDays` 时采用的保留天数。 */
export const DEFAULT_RETENTION_DAYS = 180

/**
 * Plugin configuration as authored in a profile row.
 *
 * Every field is optional because defaults cover the common deployment; the
 * resolver below turns it into {@link ResolvedConfig}.
 *
 * profile 行中书写的插件配置。全部字段可选，因为默认值覆盖常见部署；下方的解析函数把
 * 它变成 {@link ResolvedConfig}。
 */
export interface Config {
  /**
   * Maximum number of retained entries. Older entries are dropped first.
   * 最多保留的条目数；超出时优先丢弃更早的条目。
   */
  maxEntries?: number
  /**
   * Retention window in days. Entries older than this cutoff are dropped.
   * 保留窗口（天）。早于该截止时刻的条目会被丢弃。
   */
  retentionDays?: number
}

/** Schemastery schema the loader validates before {@link resolveConfig}. 加载器在 {@link resolveConfig} 之前校验的 schemastery schema。 */
export const Config: z<Config> = z.object({
  maxEntries: z.natural().min(1).default(DEFAULT_MAX_ENTRIES),
  retentionDays: z.natural().min(1).default(DEFAULT_RETENTION_DAYS),
})

/** Configuration with every default applied and every value validated. 已应用全部默认值并完成校验的配置。 */
export interface ResolvedConfig {
  /** Effective entry cap. 生效的条目上限。 */
  readonly maxEntries: number
  /** Effective retention window in days. 生效的保留天数。 */
  readonly retentionDays: number
}

/**
 * Apply defaults to a validated plugin config.
 *
 * Direct callers (tests, embedders) may pass a partial object; this function
 * therefore resolves defaults itself rather than trusting the loader.
 *
 * 对已校验的插件配置应用默认值。直接调用方（测试、嵌入方）可能传入部分对象，因此本函数
 * 自行解析默认值，而不是依赖加载器。
 *
 * @param config - plugin config, possibly partial 插件配置，可以是部分对象
 * @returns the effective configuration 生效配置
 * @throws AdminError `VALIDATION_FAILED` when a value is not a positive integer 值不是正整数时抛出
 */
export function resolveConfig(config: Config): ResolvedConfig {
  const maxEntries = config.maxEntries ?? DEFAULT_MAX_ENTRIES
  const retentionDays = config.retentionDays ?? DEFAULT_RETENTION_DAYS
  assertPositiveInteger('maxEntries', maxEntries)
  assertPositiveInteger('retentionDays', retentionDays)
  return { maxEntries, retentionDays }
}

/**
 * Reject a non-positive or fractional bound.
 *
 * @param field - config field name used in the message 消息中使用的配置字段名
 * @param value - candidate value 候选值
 * @throws AdminError `VALIDATION_FAILED` when the value is unusable 值不可用时抛出
 */
function assertPositiveInteger(field: string, value: number): void {
  if (Number.isInteger(value) && value > 0) return
  throw new AdminError('VALIDATION_FAILED', `config.${field} must be a positive integer`, { [field]: value })
}
