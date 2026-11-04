/**
 * Coordination-owned family events. The design's cross-module contract: 唤醒
 * 只由协调发起 — the wake request exists only here, and no other module may
 * start a turn.
 *
 * 协调拥有的家族事件。设计的跨模块契约：唤醒只由协调发起——唤醒请求只存在于此，任何其他
 * 模块都不得让回合开始。
 *
 * @module @veren/im-coordination/events
 */

import type { ImWakeRequest } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * One agent should run one turn now (pure notification; the turn module
     * consumes it and nobody else may act as a wake source).
     * 某个智能体现在应该跑一个回合（纯通知；回合模块消费它，其他任何模块都不得充当唤醒源）。
     * @mode emit
     */
    'im/wake-request': (payload: ImWakeRequest) => void
  }
}
