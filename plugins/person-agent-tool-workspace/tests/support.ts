// 测试辅助：把 Partial 配置补全成完整 Config（语义不变、类型完整）。
// Test helper: complete a Partial config into a full Config (same semantics,
// complete type).
import type { Config } from '../src/index.js'

/** 默认配置：与 Config schema 的 default 一致。Defaults mirroring the Config schema. */
export const DEFAULT_CONFIG: Config = {
  allowCreate: true,
  allowCreateDirectory: false,
  allowListSessions: true,
  maxListSessions: 200,
}

/**
 * 合并出完整配置。Merge into a complete config.
 * @param overrides - 覆盖项。The overrides.
 * @returns 完整 Config。The complete Config.
 */
export function resolveConfig(overrides: Partial<Config> = {}): Config {
  return { ...DEFAULT_CONFIG, ...overrides }
}
