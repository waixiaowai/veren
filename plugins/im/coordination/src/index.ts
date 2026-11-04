/**
 * @veren/im-coordination plugin entry: opens the coordination domain, builds
 * the watermark store, budget, service, and wake fan-out, and consumes the
 * conversation's committed-message events.
 *
 * Nothing here talks to a model. The cheap-model judgment is a documented v1
 * deferral; every decision this module ships is deterministic code.
 *
 * @veren/im-coordination 插件入口：打开协调域，构建水位存储、预算、服务与唤醒扇出，并
 * 消费会话的已提交消息事件。
 *
 * 这里没有任何地方调用模型。廉价模型判断是已文档化的 v1 推迟；本模块交付的每一个决策
 * 都是确定性代码。
 *
 * @module @veren/im-coordination
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import './events.ts'
import { Watermarks } from './watermarks.ts'
import { BudgetRing } from './budget.ts'
import { CoordinationService, CoordinationToken } from './service.ts'
import { Fanout } from './fanout.ts'

export * from './types.ts'
export { coordinationDomain, Watermarks, watermarkKey } from './watermarks.ts'
export type { CoordinationStore, WatermarkRow, WatermarkTable } from './watermarks.ts'
export { BudgetRing } from './budget.ts'
export {
  CoordinationService, CoordinationToken, HOLD_EXCERPT_CHARS, MAX_HOLD_ATTEMPTS, MAX_HOLD_LINES,
} from './service.ts'
export type { CoordinationOptions } from './service.ts'
export { Fanout } from './fanout.ts'
export type { ImWakeRequest, TriageSource, TriageVerdict, WakeReason } from './types.ts'

/** Plugin name. */
/** 插件名。 */
export const name = 'imCoordination'

/**
 * Host services: durable storage plus the conversation facade and the roster.
 * 宿主服务：持久存储，加上会话门面与名册。
 */
export const inject = ['storageDomain', 'imConversation', 'imParticipants'] as const
/** Services this plugin provides. */
/** 本插件提供的服务。 */
export const provide = [CoordinationToken] as const

/** Plugin configuration. */
/** 插件配置。 */
export interface Config {
  /** Low-priority wakes allowed per process per minute (design default: 20). */
  /** 每进程每分钟允许的低优先唤醒次数（设计默认：20）。 */
  lowPriorityWakesPerMinute: number
}
/** Configuration schema. */
/** 配置 schema。 */
export const Config: z<Config> = z.object({
  lowPriorityWakesPerMinute: z.number().min(1).default(20),
})

/**
 * Apply the coordination plugin.
 * @param ctx - host context.
 * @param config - validated plugin configuration.
 */
export const apply = async (ctx: Context, config: Config): Promise<void> => {
  const watermarks = new Watermarks()
  await watermarks.openDomain(ctx)
  ctx.effect(() => () => watermarks.close(), 'im-coordination:storage')

  const coordination = new CoordinationService({
    conversation: ctx.imConversation,
    participants: ctx.imParticipants,
    watermarks,
    budget: new BudgetRing(config.lowPriorityWakesPerMinute, 60_000),
  })
  ctx.effect(() => ctx.provide(CoordinationToken, coordination), 'im-coordination:service')

  const fanout = new Fanout({
    ctx,
    conversation: ctx.imConversation,
    participants: ctx.imParticipants,
    coordination,
  })
  ctx.effect(
    () => ctx.on('im/message-new', payload => {
      void fanout.onMessageNew(payload)
    }),
    'im-coordination:fanout',
  )
  // Registered last so it runs first on unload: drop the wake claims before
  // the coordination service leaves the context.
  // 最后注册、卸载时最先执行：在协调服务离开 context 之前丢弃唤醒认领。
  ctx.effect(() => () => fanout.dispose(), 'im-coordination:fanout-dispose')
}
