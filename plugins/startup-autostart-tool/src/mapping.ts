/**
 * The pure helpers a tool execute runs through: mapping the flattened tool
 * arguments onto the service input, the malformed-id guard, the error
 * translation that withholds internal failures, and the deterministic
 * presentation of calls and results.
 *
 * 工具 execute 走到的纯助手：把扁平的工具参数映射为服务输入、畸形 id 守卫、屏蔽内部
 * 失败的错误翻译，以及调用与结果的确定性呈现。
 * @module @veren/startup-autostart-tool/mapping
 */

import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { GenericCallView } from '@deepseek-ai/dsh-tools'
import { StartupInputError } from '@veren/startup-autostart'
import type { StartupAction, StartupErrorCode } from '@veren/startup-autostart'

/**
 * Every failure a startup tool reports: one of the service's stable codes, or
 * the withheld `internal_error` a storage or delivery failure collapses into.
 */
export interface StartupToolError {
  readonly code: StartupErrorCode | 'internal_error'
  readonly message: string
}

/** Deterministic model content for every canonical tool value. */
export function renderValue(_args: unknown, value: unknown): ContentBlock[] {
  return [{ type: 'text', text: JSON.stringify(value) }]
}

/** Pure generic pending card. */
export function present(title: string, kind: 'read' | 'other', rawInput?: unknown): GenericCallView {
  return { card: 'generic', title, kind, ...rawInput === undefined ? {} : { rawInput } }
}

/** Stable error for failures not safe to expose. */
function internalError(): StartupToolError {
  return { code: 'internal_error', message: 'The startup item operation failed.' }
}

/** Translate invalid input while withholding internal storage failures. */
export function operationError(error: unknown): StartupToolError {
  return error instanceof StartupInputError ? { code: error.code, message: error.message } : internalError()
}

/** Reject an obviously malformed id before it reaches storage. */
export function checkedToolId(id: string): StartupToolError | undefined {
  if (id.length === 0 || id.trim() !== id) {
    return { code: 'invalid_id', message: 'id must be non-empty without surrounding whitespace.' }
  }
  return undefined
}

/** The flattened arguments every item-shaped tool shares. */
export interface StartupToolArgs {
  readonly name?: string
  readonly enabled?: boolean
  readonly action?: StartupAction
  readonly message?: string
  readonly session_id?: string
  readonly cwd?: string
  readonly workspace_id?: string
  readonly preset?: string
  readonly model?: { readonly provider: string; readonly model: string; readonly reasoning_effort?: string }
}

/**
 * Map the flattened tool arguments onto the service input.
 * @param args - validated tool arguments.
 * @returns the service input carrying only the supplied fields.
 */
export function toInput(args: StartupToolArgs) {
  return {
    ...args.name === undefined ? {} : { name: args.name },
    ...args.enabled === undefined ? {} : { enabled: args.enabled },
    ...args.action === undefined ? {} : { action: args.action },
    ...args.message === undefined ? {} : { message: args.message },
    ...args.session_id === undefined ? {} : { sessionId: args.session_id },
    ...args.cwd === undefined ? {} : { cwd: args.cwd },
    ...args.workspace_id === undefined ? {} : { workspaceId: args.workspace_id },
    ...args.preset === undefined ? {} : { preset: args.preset },
    ...args.model === undefined ? {} : {
      model: {
        provider: args.model.provider,
        model: args.model.model,
        ...args.model.reasoning_effort === undefined ? {} : { reasoningEffort: args.model.reasoning_effort },
      },
    },
  }
}
