// 数据源读取职责：每个函数只读一个宿主数据源，并各自决定「读不到怎么办」。
// 读取失败一律降级 + 告警（插件永不因名单读失败而炸），成功则返回纯数据，让上层
// 组装逻辑无需再关心异常。
// Data-source reading responsibility: one function reads exactly one host data
// source and owns its own "what if it fails" decision. A failed read degrades
// with a warning (a failed roster read never breaks the plugin); a successful
// read returns plain data, so the assembly layer never handles exceptions.
//
// 【类型来源唯一】这里不重声明宿主记录的形状：会话头直接用宿主的 SessionHeader，
// sessionQuery 的形状从上下文声明推导（它的返回元素类型），因此宿主改字段这里自动跟。
// Single type source: no host record shape is re-declared here — the session
// header is the host's SessionHeader, and sessionQuery's shape is derived from
// the context declaration (its element type), so host changes flow through.
import type { Context } from '@deepseek-ai/cordis'
import type { AgentPreset } from '@deepseek-ai/dsh-agent-preset-registry'
import type { SessionHeader } from '@deepseek-ai/dsh-session'
// 类型-only import：拉取 sessionQuery 服务的 Context 声明合并（持久化会话头）。
// Type-only import: pulls the sessionQuery service Context declaration merging
// (persisted session headers).
import type {} from '@deepseek-ai/dsh-session-query'
import type { ColdHeader } from './session-info.js'

/** 冷会话（已持久化未挂载）的持久化头。Persisted header of a cold (persisted, not attached) session.
 * 就是宿主的 SessionHeader——含 id 与 createdAt。It is the host SessionHeader, id included. */
export type ColdHeaderRecord = SessionHeader

/** 统一的读取失败告警文案。One shared warning line for failed reads. */
export const snapshotWarning = (error: unknown): string =>
  `person-agent dynamic context failed: ${error instanceof Error ? error.message : String(error)}`

/**
 * Read the persisted session headers through the optional sessionQuery service:
 * a missing service lists nothing, and a failed read degrades to an empty map
 * with a warning.
 * 经可选的 sessionQuery 服务读取持久化会话头：服务缺失就当没有会话，读取失败只
 * 告警并降级为空表。
 */
async function listPersistedHeaders(ctx: Context): Promise<readonly SessionHeader[]> {
  const query: Context['sessionQuery'] | undefined = ctx.get('sessionQuery')
  if (query === undefined) return []
  return (await query.listSessions()).map(record => record.header)
}

/**
 * Await the preset roster. A failed read only warns and yields an empty roster,
 * so this snapshot simply carries no roster heading.
 * 等待预设名单。读取失败只告警并返回空名单——本次快照不带名单标题，不炸插件。
 */
export async function readPresetRoster(ctx: Context): Promise<AgentPreset[]> {
  try {
    return await ctx.agentPresets.list()
  } catch (error) {
    ctx.logger.warn(snapshotWarning(error))
    return []
  }
}

/**
 * Read the persisted headers of cold (persisted, not attached) sessions from the
 * optional sessionQuery service; a missing service or a failed read degrades to
 * an empty map with a warning.
 * 经可选的 sessionQuery 服务读取冷会话（已持久化未挂载）的头信息；服务缺失或
 * 读取失败只告警并降级为空表。
 */
export async function readColdHeaders(ctx: Context): Promise<Map<string, ColdHeader>> {
  const coldHeaders = new Map<string, ColdHeader>()
  try {
    for (const header of await listPersistedHeaders(ctx)) {
      coldHeaders.set(header.id, header)
    }
  } catch (error) {
    ctx.logger.warn(`person-agent dynamic context: sessionQuery read failed: ${error instanceof Error ? error.message : String(error)}`)
  }
  return coldHeaders
}
