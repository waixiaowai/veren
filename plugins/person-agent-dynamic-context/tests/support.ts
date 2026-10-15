// 测试共享支撑：三个 spec 都需要的「配置解析」「日志行类型」「快照文本读取」。
// 这里只放与宿主/插件契约对齐的小工具，不放任何断言。
// Shared test support: config resolution, the log-row type, and snapshot-text
// reading — the three things every spec needs. Only contract-aligned helpers
// live here; assertions stay in the specs.
import { Config } from '../src/index.js'
import type { ConfigShape, SessionLogView } from '../src/index.js'

/** 两个开关都打开的默认配置，语义等价于原测试里的 Config({})。
 * Both toggles on — semantically identical to the old Config({}). */
export const DEFAULT_CONFIG: ConfigShape = { includePresetRoster: true, includeWorkspaceList: true }

/**
 * 解析一份完整配置：schema 的调用签名要求两个键齐全（缺键会 ts(2345)），因此这里显式
 * 用默认值补齐，测试里只需写想覆盖的那一项。
 * Resolves a complete config: the schema's call signature requires both keys (a
 * missing key raises ts(2345)), so defaults are filled in here and a test only
 * writes the toggle it means to override.
 */
export const resolveConfig = (overrides: Partial<ConfigShape> = {}): ConfigShape =>
  Config({ ...DEFAULT_CONFIG, ...overrides })

/** One logged user/message event row. 一条已入账的 user/message 事件。
 * 形状按插件的只读日志视图推导，因此真实宿主事件可直接赋给它。
 * The shape derives from the plugin's read-only log view, so real host events
 * assign to it directly. */
export interface LoggedMessage {
  type: 'user/message'
  data: { source?: { kind?: string }, content: readonly { type: string, text?: string }[] }
}

/** 日志序号类型（宿主品牌号），从插件的日志视图推导，避免另立来源。
 * The log sequence type, derived from the plugin's own log view. */
export type LogSeq = Parameters<SessionLogView['eventAt']>[0]

/** Snapshot texts an event history currently carries. 一段事件历史当前的快照文本。 */
export function snapshotTexts(history: LoggedMessage[]): string[] {
  return history
    .filter((row) => row.data.source?.kind === 'person-agent-context')
    .map((row) => row.data.content[0]?.text ?? '')
}
