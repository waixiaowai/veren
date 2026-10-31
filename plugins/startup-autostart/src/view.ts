/**
 * The read models of a startup item: the projected view the model tools and the
 * management panel both render, and the fixed model-facing framing every
 * delivered startup message carries.
 *
 * 启动项的读取模型：模型工具与管理面板共同渲染的投影视图，以及每条投递消息所携带的
 * 固定面向模型的框架文本。
 * @module @veren/startup-autostart/view
 */

import { withDefined } from './item.ts'
import type { StartupAction, StartupItemRecord, StartupModelTarget, StartupOutcome } from './item.ts'

/**
 * The fixed model-facing framing every delivered startup message carries, so a
 * woken Session can tell a startup instruction apart from the user typing.
 * @param item - the item whose message is delivered.
 * @param startedAt - instant the run started, ISO 8601 with milliseconds.
 * @param text - the message body to deliver.
 * @returns stable model-visible text with JSON-escaped dynamic fields.
 */
export function startupMessageText(item: StartupItemRecord, startedAt: string, text: string): string {
  return [
    '[STARTUP AUTOSTART]',
    'This message comes from a startup item the user registered; it runs once each time DeepSeek Harness starts.',
    `startup_item_json: ${JSON.stringify(item.name)}`,
    `startup_item_id_json: ${JSON.stringify(item.id)}`,
    `started_at: ${startedAt}`,
    `startup_prompt_json: ${JSON.stringify(text)}`,
  ].join('\n')
}

/** One item as the tools and the panel read it. */
export interface StartupItemView {
  readonly id: string
  readonly name: string
  readonly enabled: boolean
  readonly action: StartupAction
  readonly cwd?: string
  readonly workspaceId?: string
  readonly sessionId?: string
  readonly preset?: string
  readonly model?: StartupModelTarget
  readonly message?: string
  readonly createdAt: string
  readonly updatedAt: string
  readonly lastRunAt?: string
  readonly lastOutcome?: StartupOutcome
  readonly runCount: number
}

/**
 * Project one record onto the shared view.
 * @param item - the stored record.
 * @returns the view both the tools and the panel render.
 */
export function startupItemView(item: StartupItemRecord): StartupItemView {
  return withDefined<StartupItemView>({
    id: item.id,
    name: item.name,
    enabled: item.enabled,
    action: item.action,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    runCount: item.runCount,
  }, {
    cwd: item.cwd,
    workspaceId: item.workspaceId,
    sessionId: item.sessionId,
    preset: item.preset,
    model: item.model,
    message: item.message,
    lastRunAt: item.lastRunAt,
    lastOutcome: item.lastOutcome,
  })
}
