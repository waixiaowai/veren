/**
 * 运行时槽位：页面与工具取数的唯一正道。
 *
 * 装配期把存储、工具矩阵与动作面绑进这个模块级槽位，组件体与工具定义都只
 * 从这里取。组件因此不碰 ctx、不 import 服务类——它要什么，由装配期穿一根
 * 参数下来。
 *
 * The runtime slot: the only straight path for pages and tools to reach data.
 *
 * The assembly binds the storage, the tool matrix, and the action faces into
 * this module-level slot; component bodies and tool definitions read only from
 * here. A component therefore never touches ctx and never imports a service
 * class — whatever it needs arrives as a parameter from the assembly.
 *
 * @module @veren/zhihu-ops/runtime
 */
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { externalName } from './app.ts'
import type { PullOutcome } from './collect/pull.ts'
import type { ReportRow } from './store/store.ts'
import type { ZhihuOpsStorage } from './store/store.ts'

/** 凭据状态：配了还是没配 / the credential state: stored or not */
export type SecretState = 'configured' | 'missing'

/** 装配期绑定的运行时面 / the runtime faces bound at assembly time */
export interface ZhihuOpsRuntime {
  /** 持久存储 / the durable storage */
  readonly storage: ZhihuOpsStorage
  /** 全名工具矩阵 / the full-named tool matrix */
  readonly tools: readonly ToolDefinition[]
  /** 立刻重采一次 / pull right now */
  readonly refresh: () => Promise<PullOutcome>
  /** 生成一份报告并投进收件箱 / write one report and deliver it to the inbox */
  readonly writeReport: () => Promise<ReportRow>
  /** 凭据是否已配置 / whether the credential is stored */
  readonly secretState: () => Promise<SecretState>
  /** 写入 Access Secret / store the access secret */
  readonly installSecret: (secret: string) => Promise<void>
  /** 钟面来源 / the clock source */
  readonly now: () => Date
}

let runtime: ZhihuOpsRuntime | undefined

/**
 * 装配时绑定（index.ts 的接线调用一次）。
 * Binds at assembly time (called once by index.ts's wiring).
 *
 * @param bound - the runtime faces / 运行时面
 */
export function bindRuntime(bound: ZhihuOpsRuntime): void {
  runtime = bound
}

/**
 * 取绑定的运行时；未绑定 = 装配错误，fail loud。
 * Reads the bound runtime; unbound = assembly error, fail loud.
 *
 * @returns the runtime faces / 运行时面
 */
export function requireRuntime(): ZhihuOpsRuntime {
  if (runtime === undefined) {
    throw new Error('[zhihu-ops] the runtime is not bound; the app wiring must run before pages open')
  }
  return runtime
}

/**
 * 按本地名取全名工具定义。
 *
 * 装配期把工具矩阵改名成全名（`zhihu_ops__<本地名>`），因此这里必须先把本地名
 * 折成全名再查——页面体写的是本地名。
 *
 * Looks up a full-named tool definition by its local name.
 *
 * The assembly renames the tool matrix to full names (`zhihu_ops__<localName>`),
 * so the local name must be folded into the full name before the lookup — the
 * page bodies speak the local name.
 *
 * @param localName - the local tool name / 本地工具名
 * @returns the tool definition / 工具定义
 */
export function toolOf(localName: string): ToolDefinition {
  const fullName = externalName(localName)
  const found = requireRuntime().tools.find((tool) => tool.name === fullName)
  if (found === undefined) throw new Error(`[zhihu-ops] tool ${fullName} is not defined`)
  return found
}
