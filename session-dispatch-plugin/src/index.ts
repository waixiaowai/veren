// 插件入口：会话派发工具 + 事件驱动完成回报。
// Plugin entry: the session dispatch tool plus event-driven completion reporting.
//
// 现状痛点：session_prompt 的 wait=true 会阻塞调用方会话直到目标会话空闲（实测
// 有过 16 分钟）。本插件把这件事拆成「派发立即返回」+「静止后回报」两段，调用方
// 全程不被阻塞，看守只挂在目标 Agent 自己的事件作用域上，不排任何定时任务。
// The problem: session_prompt's wait=true blocked the caller until the target was
// idle (16 minutes was observed). This splits it into "dispatch returns
// immediately" and "report after the target settles": the caller is never
// blocked, and the guard lives on the target Agent's own event scope with no
// scheduled work of any kind.
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
// 类型-only imports：拉取 tools / agents / sessions / sessionController 的
// Context 声明合并（inject 引用的能力名必须在类型面里存在）。
// Type-only imports: pull the tools / agents / sessions / sessionController
// Context declaration merging for every capability `inject` names.
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import { registerSessionDispatch } from './dispatch.js'
import { createWatchRegistry } from './watcher.js'

/** Cordis 插件名，出现在日志、fiber 与诊断里。The plugin name used in logs, fibers, and diagnostics. */
export const name = 'sessionDispatch'

/** 本插件的配置。This plugin's configuration. */
export interface Config {
  /**
   * 回报正文模板，必须保留 `{target_session_id}` 与 `{output}` 占位符。
   * 可用占位符：`{target_session_id}` `{watch_id}` `{outcome}` `{waited_ms}` `{output}`。
   * Report body template; it must keep the `{target_session_id}` and `{output}`
   * placeholders. Available placeholders: `{target_session_id}` `{watch_id}`
   * `{outcome}` `{waited_ms}` `{output}`.
   */
  reportTemplate: string
  /** 目标没有 assistant 文本时替换 `{output}` 的正文。Body substituted for `{output}` when the target produced no assistant text. */
  emptyOutputText: string
  /** `{output}` 的字符上限；超出时截断并追加省略号。Character cap for `{output}`; anything longer is truncated with an ellipsis. */
  maxReportChars: number
  /** 同时挂起的看守上限；到达后 report=true 的派发被拒绝。Cap on concurrently armed watches; further reporting dispatches are rejected. */
  maxConcurrentWatches: number
}

/** `Config` 既是接口类型又是 schema 值，测试用这个别名指接口。 */
/** `Config` is both an interface type and a schema value; tests use this alias for the interface. */
export type ConfigShape = Config

/**
 * 校验该行配置：占位符必须齐全，计数必须为正整数；缺一即 fail loud。
 * Validate one row config: placeholders must all be present and counts must be
 * positive integers; any gap fails loud before `apply` runs.
 */
export const Config: z<Config> = z
  .object({
    // 占位符用先行断言强制齐全：缺 {output} 会静默丢掉回报正文，属于必须在加载期报出的配置错误。
    // Placeholders are enforced with lookaheads: a template missing {output}
    // silently drops the report body, which is a load-time configuration error.
    reportTemplate: z.string()
      .pattern(/^(?=[\s\S]*\{target_session_id\})(?=[\s\S]*\{output\})/)
      .default([
        '[SESSION DISPATCH REPORT]',
        'Target session: {target_session_id}',
        'Watch: {watch_id}',
        'Outcome: {outcome} (waited {waited_ms} ms)',
        '',
        '{output}',
      ].join('\n'))
      .description('Report body template; must keep {target_session_id} and {output}.'),
    emptyOutputText: z.string()
      .default('(the dispatched session produced no assistant text)')
      .description('Body substituted for {output} when the target produced no assistant text.'),
    maxReportChars: z.natural()
      .min(1)
      .default(4000)
      .description('Character cap for {output}; longer text is truncated with an ellipsis.'),
    maxConcurrentWatches: z.natural()
      .min(1)
      .default(64)
      .description('Cap on concurrently armed watches; reporting dispatches are rejected once it is reached.'),
  })
  .description('Session dispatch tool and completion-report settings.')

/** 注入的能力（Service）：工具注册表、存活 Agent 注册表、会话存储、宿主会话业务 API。 */
/** Injected capabilities: the tool registry, the live Agent registry, the session store, and the host Session business API. */
export const inject = ['tools', 'agents', 'sessions', 'sessionController']
export const provide = []

/**
 * 注册看守与工具；effect 函数体返回精确卸载函数，卸载时逆序调用，不泄漏。
 * Register the guard and the tool; each effect body returns the exact disposer,
 * invoked in reverse order on unload, so nothing leaks.
 * @param ctx - 宿主上下文。The host context.
 * @param config - 已校验配置。The validated config.
 */
export const apply = (ctx: Context, config: Config): void => {
  const registry = createWatchRegistry(ctx, config)
  // 先注册看守取消器，再注册工具：卸载时工具先摘除，随后取消所有挂起看守。
  // The guard canceller is registered first so that on unload the tool is removed
  // before every pending watch is cancelled.
  ctx.effect(() => () => registry.dispose(), 'session-dispatch:cancel-watches')
  ctx.effect(() => registerSessionDispatch(ctx, registry), 'session-dispatch:session_dispatch')
}
