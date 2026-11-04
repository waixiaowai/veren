/**
 * Turn-owned family events: run lifecycle announcements for observability and
 * the panel.
 *
 * 回合拥有的家族事件：面向观测面与面板的运行生命周期通告。
 *
 * @module @veren/im-turn/events
 */

import type { RunView } from './types.ts'

/** The payload of one run transition. */
/** 一次运行转变的载荷。 */
export interface ImRunUpdated {
  readonly run: RunView
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * A run's status changed (pure notification; the record itself is the
     * durable truth, this event only accelerates the view).
     * 一次运行的状态发生了变化（纯通知；记录本身才是持久真相，事件只加速视图）。
     * @mode emit
     */
    'im/run-updated': (payload: ImRunUpdated) => void
  }
}
