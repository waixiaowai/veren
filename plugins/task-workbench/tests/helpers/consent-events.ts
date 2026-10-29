/**
 * 同意门测试夹具：合成会话事件（turn/start 重置 + user/message 合并的折叠
 * 输入）与武装助手。事件形状按真机日志口径（`data.message.source.kind` +
 * 文本块）。
 * Consent-gate test fixtures: synthetic session events (the fold's inputs:
 * reset on turn/start, merge on user/message) and arming helpers. Event shapes
 * follow the real-log convention (`data.message.source.kind` + text blocks).
 */
import type { ConsentBook } from '../../src/consent.ts'

/** 事件的最小测试形状（SessionEvent 的结构子集）/ the minimal test event shape (a structural subset of SessionEvent) */
export interface TestEvent {
  readonly type: string
  readonly data?: {
    readonly message?: {
      readonly source?: { readonly kind?: string }
      readonly content?: readonly { readonly type?: string; readonly text?: string }[]
    }
  }
}

/** 稳定会话对象（同意台账按对象键）/ a stable session object (the ledger keys on the object) */
export function fakeSession(id = 'spec-session'): { readonly id: string } {
  return { id }
}

/** 人类消息事件（广域同意）/ a human message event (broad consent) */
export function userEvent(text = '把 t-1 接了'): TestEvent {
  return { type: 'user/message', data: { message: { source: { kind: 'user' }, content: [{ type: 'text', text }] } } }
}

/** 投递通知事件（按 `任务：<id>` 收窄）/ a delivery-notice event (narrowed by `任务：<id>`) */
export function noticeEvent(taskId: string): TestEvent {
  return { type: 'user/message', data: { message: { source: { kind: 'task-center/notice' }, content: [{ type: 'text', text: `[task-center] 标题\n任务：${taskId}\n页面：/apps/x` }] } } }
}

/** TASK 块事件（按块头 id 收窄）/ a TASK-block event (narrowed by the header id) */
export function taskBlockEvent(taskId: string): TestEvent {
  return { type: 'user/message', data: { message: { source: { kind: 'app/task' }, content: [{ type: 'text', text: `TASK ${taskId} 标题` }] } } }
}

/** 页面块事件（零同意——旧反例的形态）/ a PAGE-block event (zero consent — the old counter-example's shape) */
export function pageBlockEvent(): TestEvent {
  return { type: 'user/message', data: { message: { source: { kind: 'app/page' }, content: [{ type: 'text', text: 'PAGE task-workbench/list /apps/task-workbench/list' }] } } }
}

/** 回合开始（重置切片）/ a turn start (resets the slice) */
export function turnStartEvent(): TestEvent {
  return { type: 'turn/start' }
}

/** 武装一个用户回合：turn/start → 用户消息 / arm a user turn: turn/start → the user message */
export function armUserTurn(book: ConsentBook, session: object): void {
  book.observe(session, turnStartEvent() as never)
  book.observe(session, userEvent() as never)
}

/** 武装一个投递回合：turn/start → 点名任务的投递通知 / arm a delivery turn: turn/start → the notice naming the task */
export function armDeliveryTurn(book: ConsentBook, session: object, taskId: string): void {
  book.observe(session, turnStartEvent() as never)
  book.observe(session, noticeEvent(taskId) as never)
}

/** 首屏形态（零同意）：turn/start → PAGE 块 / the first-screen shape (zero consent): turn/start → the PAGE block */
export function armFirstScreen(book: ConsentBook, session: object): void {
  book.observe(session, turnStartEvent() as never)
  book.observe(session, pageBlockEvent() as never)
}
