/**
 * 插件配置面：schemastery 契约 + 解析后的运行配置。
 *
 * 配置只管"怎么跑"（什么时候拉、一天拉多少次、请求间隔多长、报告什么节奏），
 * **不管凭据**——Access Secret 走凭据存储，不进配置、不进日志。
 *
 * The plugin configuration face: the schemastery contract plus the resolved
 * runtime configuration.
 *
 * Configuration only covers "how it runs" (when to pull, how many calls a day,
 * the request interval, the report cadence); it never holds credentials — the
 * access secret lives in the credential store, out of configuration and logs.
 *
 * @module @veren/zhihu-ops/config
 */
import z from '@deepseek-ai/schemastery'

/** 配置契约 / the configuration contract */
export interface Config {
  /** 每日采集时刻（本地时间 HH:mm）/ the daily pull time (local HH:mm) */
  pullLocalTime: string
  /** 本地日调用上限；0 = 不限（另受官方额度约束）/ the local daily call cap; 0 = unlimited */
  dailyCallLimit: number
  /** 请求间隔（毫秒）/ the request interval in milliseconds */
  requestIntervalMs: number
  /** 报告节奏 / the report cadence */
  reportCadence: 'daily' | 'weekly'
  /** 报告覆盖的天数 / how many days a report covers */
  reportWindowDays: number
  /** 每次采集拉取的内容条数上限 / how many contents one pull reads */
  contentLimit: number
  /** 自动采集开关 / whether the automatic pull runs */
  autoPull: boolean
}

/** 配置的 schemastery 契约 / the schemastery contract of the configuration */
export const Config: z<Config> = z.object({
  pullLocalTime: z.string().default('08:00').description('每日采集时刻（本地时间 HH:mm）/ the daily pull time (local HH:mm)'),
  dailyCallLimit: z.number().default(60).description('本地日调用上限，0 表示不限（官方额度另算）/ the local daily call cap; 0 means unlimited (the platform allowance is counted separately)'),
  requestIntervalMs: z.number().default(3000).description('两次采集请求之间的最小间隔（毫秒）/ the minimum gap between two pull requests (ms)'),
  reportCadence: z.union([z.const('daily'), z.const('weekly')]).default('weekly').description('报告节奏：每日或每周 / the report cadence: daily or weekly'),
  reportWindowDays: z.number().default(7).description('一份报告覆盖的天数 / how many days one report covers'),
  contentLimit: z.number().default(20).description('每次采集拉取的内容条数上限 / how many contents one pull reads'),
  autoPull: z.boolean().default(true).description('是否按计划自动采集 / whether the automatic pull runs on schedule'),
})

/** 解析后的运行配置 / the resolved runtime configuration */
export interface RuntimeConfig {
  /** 每日采集时刻（本地时间 HH:mm）/ the daily pull time (local HH:mm) */
  readonly pullLocalTime: string
  /** 本地日调用上限 / the local daily call cap */
  readonly dailyCallLimit: number
  /** 请求间隔（毫秒）/ the request interval */
  readonly requestIntervalMs: number
  /** 报告节奏 / the report cadence */
  readonly reportCadence: 'daily' | 'weekly'
  /** 报告覆盖的天数 / how many days a report covers */
  readonly reportWindowDays: number
  /** 每次采集拉取的内容条数上限 / how many contents one pull reads */
  readonly contentLimit: number
  /** 自动采集开关 / whether the automatic pull runs */
  readonly autoPull: boolean
}

/**
 * 把配置解析成运行配置；非法值响亮失败，绝不静默纠正。
 * Resolves the configuration into the runtime configuration; an illegal value
 * fails loudly and is never silently corrected.
 *
 * @param config - the validated plugin configuration / 已校验的插件配置
 * @returns the resolved runtime configuration / 解析后的运行配置
 */
export function resolveConfig(config: Config): RuntimeConfig {
  const pullLocalTime = config.pullLocalTime
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(pullLocalTime)) {
    throw new Error(`[zhihu-ops] pullLocalTime must be HH:mm (24-hour local time), got "${pullLocalTime}"`)
  }
  if (config.dailyCallLimit < 0) {
    throw new Error(`[zhihu-ops] dailyCallLimit must not be negative, got ${config.dailyCallLimit}`)
  }
  if (config.requestIntervalMs < 0) {
    throw new Error(`[zhihu-ops] requestIntervalMs must not be negative, got ${config.requestIntervalMs}`)
  }
  if (config.reportWindowDays < 1) {
    throw new Error(`[zhihu-ops] reportWindowDays must be at least 1, got ${config.reportWindowDays}`)
  }
  if (config.contentLimit < 1) {
    throw new Error(`[zhihu-ops] contentLimit must be at least 1, got ${config.contentLimit}`)
  }
  return {
    pullLocalTime,
    dailyCallLimit: config.dailyCallLimit,
    requestIntervalMs: config.requestIntervalMs,
    reportCadence: config.reportCadence,
    reportWindowDays: config.reportWindowDays,
    contentLimit: config.contentLimit,
    autoPull: config.autoPull,
  }
}
