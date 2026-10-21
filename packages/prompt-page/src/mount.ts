/**
 * mountPage：把一个页面绑定为独立页面会话 / bind a page as an isolated page-session
 *
 * 一页一会话：独立 MessageHost（独立版本链/快照基线）；store 是跨页面共享的权威状态，
 * 页面关闭只丢会话（消息日志），不丢状态。
 */
import { bindStore, createRoot, scheduleRender } from '@veren/prompt-core'
import { MessageHost, createSyncAssembler, policyFor, renderSync } from '@veren/prompt-host-messages'
import type { AssembledSync, CachePolicy, CompactionOptions, MessageHostOptions } from '@veren/prompt-host-messages'
import { formatPath } from './registry.ts'
import type { PageDefinition, PageParams, PageSession } from './types.ts'

/**
 * 会话装配策略（可选；不给就没有 assemble 方法，行为与历史版本一致）。
 * Optional session assembly policy; when omitted there is no assemble method
 * and behavior matches previous versions exactly.
 */
export interface SessionAssembly {
  /** 系统提示词（planMessages 的静态前缀；独立运行时用）/ system prompt (planMessages static prefix; standalone runtimes) */
  readonly systemPrompt: string
  /** provider 名；缺省 '' → policyFor 的显式默认（deepseek 语义）/ provider name; default '' → policyFor's explicit default (deepseek semantics) */
  readonly provider?: string
  /** 显式给定时优先于 provider 推导 / overrides the provider-derived policy when given */
  readonly policy?: CachePolicy
  /** 预算阈值（缺省 tokenBudgetPolicy 默认值）/ budget thresholds (tokenBudgetPolicy defaults) */
  readonly budget?: CompactionOptions
}

export interface MountOptions<S> {
  page: PageDefinition<S>
  store: import('@veren/prompt-core').ExternalStore<S>
  params?: PageParams
  /** 透传给 MessageHost 的选项（复用其选项类型）/ forwarded MessageHost options */
  hostOptions?: MessageHostOptions
  /** 策略层装配（缺省不接策略层）/ policy-layer assembly (policy layer unwired by default) */
  assembly?: SessionAssembly
}

export function mountPage<S>(options: MountOptions<S>): PageSession<S> {
  const { page, store, params = {}, hostOptions = {} } = options
  const host = new MessageHost(hostOptions)
  const root = createRoot(host)
  const unsubscribe = bindStore(root, store, (state) => page.tree(params, state))
  scheduleRender(root, page.tree(params, store.getState())) // 初始挂载建立基线 / initial mount builds the baseline
  const pointerMessage = `OPEN ${formatPath(page.url, params)} ${JSON.stringify(params)}`
  // 策略接线：给了 assembly 才创建装配器（预算 remount + 按 provider 断点）。
  // Policy wiring: the assembler exists only when assembly is given (budget
  // remount + per-provider breakpoints).
  const assembler = options.assembly === undefined ? undefined : createSyncAssembler({
    host,
    policy: options.assembly.policy ?? policyFor(options.assembly.provider ?? ''),
    systemPrompt: options.assembly.systemPrompt,
    budget: options.assembly.budget,
  })
  return {
    page,
    params,
    host,
    pointerMessage,
    get version(): number {
      return host.currentVersion
    },
    syncText(cursor?: number): string {
      return renderSync(host.renderSince(cursor))
    },
    ...(assembler === undefined ? {} : {
      assemble: (): AssembledSync => assembler.assemble(),
    }),
    unsubscribe,
  }
}
