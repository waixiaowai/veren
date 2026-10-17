/**
 * Plugin configuration and the defaults it must not hide.
 *
 * One deployment-varying fact exists here, and it is deliberately off: whether
 * presets may post and reply on their own. The user asked for a forum that is
 * lively only when they decide it should be, so the default is silence and
 * every preset is switched off individually — there is no "enable everything"
 * shortcut that could start spending tokens by accident.
 *
 * The schema supplies a value for every field, so the parsed configuration has
 * no absent members and no reader has to invent a fallback.
 *
 * 插件配置以及它不能隐瞒的默认值。
 *
 * 这里只有一个随部署变化的开关，而且是刻意关闭的：预设是否可以自己发帖回帖。用户要的是
 * 「我想让它热闹时它才热闹」，因此默认静默，且每个预设单独关闭——不存在任何可能意外开始
 * 消耗 token 的「全部开启」捷径。
 *
 * schema 为每个字段都给出取值，因此解析后的配置没有缺失成员，读取方也不必自己编一个兜底值。
 *
 * @module @veren/forum/config
 */

import z from '@deepseek-ai/schemastery'

/** Model-facing tool registration. */
export interface ForumToolConfig {
  /** Register `forum_*` tools for every agent. */
  enabled: boolean
}

/** One preset's opt-in auto-post settings. */
export interface AutoPostEntryConfig {
  /** The preset that may post by itself. */
  preset: string
  /** Whether it actually may. */
  enabled: boolean
  /** Minutes between its posts. */
  everyMinutes: number
}

/** The opt-in auto-post block. */
export interface AutoPostConfig {
  /** Tick length in seconds; the runner checks who is due on each tick. */
  tickSeconds: number
  /** Most posts one preset may publish per hour, whatever its interval. */
  maxPerHour: number
  /** Per-preset opt-ins; a preset absent from this list never posts by itself. */
  presets: readonly AutoPostEntryConfig[]
}

/** Forum plugin configuration. */
export interface ForumConfig {
  /** Model-facing tools. */
  tools: ForumToolConfig
  /** Opt-in auto-posting; empty by default, so every preset stays silent. */
  autoPost: AutoPostConfig
}

/** Default tick length in seconds. */
export const DEFAULT_TICK_SECONDS = 60

/** Default cap on one preset's posts per hour. */
export const DEFAULT_MAX_PER_HOUR = 4

/** Default minutes between two of one preset's posts. */
export const DEFAULT_EVERY_MINUTES = 30

/**
 * Config schema.
 *
 * Every field resolves a default here rather than in the code that reads it, so
 * the plugin manager shows the user the value that will actually apply.
 */
export const Config = z.object({
  tools: z.object({
    enabled: z.boolean().default(true),
  }).default({ enabled: true }),
  autoPost: z.object({
    tickSeconds: z.number().min(10).default(DEFAULT_TICK_SECONDS),
    maxPerHour: z.number().min(1).default(DEFAULT_MAX_PER_HOUR),
    presets: z.array(z.object({
      preset: z.string().required(),
      enabled: z.boolean().default(false),
      everyMinutes: z.number().min(1).default(DEFAULT_EVERY_MINUTES),
    })).default([]),
  }).default({ tickSeconds: DEFAULT_TICK_SECONDS, maxPerHour: DEFAULT_MAX_PER_HOUR, presets: [] }),
})

/** Build the tag vocabulary the runner's prompt offers when a board has none yet. */
export const SEED_TAGS: readonly string[] = ['闲聊', '进展', '问题', '灵感']

