/**
 * Model-facing `startup_create`, `startup_list`, `startup_update`,
 * `startup_delete`, and `startup_run` tools over the Host `ctx.startupAutostart`
 * service. Mounting the plugin registers them in the mounting scope, so a preset
 * decides which agents receive them.
 *
 * 面向模型的 `startup_*` 工具族，作用于宿主 `ctx.startupAutostart` 服务。挂载在
 * 哪个作用域，工具就注册到哪个作用域，由 preset 决定哪些 agent 拿到它们。
 * @module @local/startup-autostart/tool
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView } from '@deepseek-ai/dsh-tools'
import {
  MAX_MESSAGE_LENGTH, MAX_NAME_LENGTH, STARTUP_ACTIONS, StartupInputError,
} from './domain.ts'
import type { StartupAction, StartupErrorCode, StartupItemView, StartupOutcome } from './domain.ts'

/** Plugin name registered with the Loader. */
export const name = 'tool-startup-autostart'

/** Host services this plugin consumes; `startupAutostart` is resolved per scope. */
export const inject = ['tools']

/**
 * Every failure a startup tool reports: one of the service's stable codes, or
 * the withheld `internal_error` a storage or delivery failure collapses into.
 */
interface StartupToolError {
  readonly code: StartupErrorCode | 'internal_error'
  readonly message: string
}

const OUTCOME_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string', required: true, enum: ['ok', 'failed'] },
    detail: { type: 'string', required: true },
    at: { type: 'string', required: true },
  },
} as const

const MODEL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    provider: { type: 'string', required: true },
    model: { type: 'string', required: true },
    reasoning_effort: { type: 'string' },
  },
} as const

const ITEM_VIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    name: { type: 'string', required: true },
    enabled: { type: 'boolean', required: true },
    action: { type: 'string', required: true, enum: [...STARTUP_ACTIONS] },
    runCount: { type: 'number', required: true },
    createdAt: { type: 'string', required: true },
    updatedAt: { type: 'string', required: true },
    cwd: { type: 'string' },
    workspaceId: { type: 'string' },
    sessionId: { type: 'string' },
    preset: { type: 'string' },
    message: { type: 'string' },
    lastRunAt: { type: 'string' },
    model: MODEL_SCHEMA,
    lastOutcome: OUTCOME_SCHEMA,
  },
} as const

/** Build one exact two-field error schema while preserving its literal code. */
function errorSchema<const C extends string>(code: C) {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      code: { type: 'string', required: true, const: code },
      message: { type: 'string', required: true },
    },
  } as const
}

const ERROR_SCHEMAS = [
  errorSchema('invalid_name'),
  errorSchema('invalid_id'),
  errorSchema('invalid_action'),
  errorSchema('invalid_target'),
  errorSchema('invalid_message'),
  errorSchema('item_disabled'),
  errorSchema('storage_unavailable'),
  errorSchema('item_not_found'),
  errorSchema('internal_error'),
] as const

const ITEM_OUTPUT_SCHEMA = { oneOf: [ITEM_VIEW_SCHEMA, ...ERROR_SCHEMAS] } as const
const LIST_OUTPUT_SCHEMA = {
  oneOf: [
    { type: 'array', items: ITEM_VIEW_SCHEMA },
    ...ERROR_SCHEMAS,
  ],
} as const
const DELETE_OUTPUT_SCHEMA = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        id: { type: 'string', required: true },
        deleted: { type: 'boolean', required: true },
      },
    },
    ...ERROR_SCHEMAS,
  ],
} as const
const RUN_OUTPUT_SCHEMA = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        id: { type: 'string', required: true },
        outcome: OUTCOME_SCHEMA,
      },
    },
    ...ERROR_SCHEMAS,
  ],
} as const

const ACTION_DESCRIPTION =
  'What the item does when it fires. new_session creates a session at cwd or in workspace_id and (when message is given) '
  + 'delivers it as its first turn. resume_session only brings an existing session_id live. message_session resumes '
  + 'session_id and delivers message as a new turn. queue_message resumes session_id and leaves message in its inbox '
  + 'without waking it, so the session reads it whenever it next runs.'

const CREATE_DESCRIPTION =
  'Register a startup item: work DeepSeek Harness performs every time it starts, after the surface is serving. '
  + 'Every enabled item runs on every successful start, with no debounce: a restart interrupts the work the previous '
  + 'start began, so the next start runs the item again. The only gate is enabled. '
  + 'The item is stored outside any session log, so deleting a project folder never deletes it. ' + ACTION_DESCRIPTION

const LIST_DESCRIPTION =
  'List every registered startup item with its action, target, enabled state, and the outcome of its last run. '
  + 'Reading the list never starts a session.'

const UPDATE_DESCRIPTION =
  'Change one startup item in place, keeping its id and its run history. Supply only the fields to replace; '
  + 'omitted fields keep their stored values. Changing action re-applies that action\'s target rules.'

const DELETE_DESCRIPTION =
  'Delete one startup item. It never fires again; a message already queued in a session inbox is not retracted.'

const RUN_DESCRIPTION =
  'Run one startup item right now instead of waiting for the next start. Nothing debounces a run: the only refusal is '
  + 'item_disabled, which a switched-off item raises unless force is true.'

/** Deterministic model content for every canonical tool value. */
function renderValue(_args: unknown, value: unknown): ContentBlock[] {
  return [{ type: 'text', text: JSON.stringify(value) }]
}

/** Pure generic pending card. */
function present(title: string, kind: 'read' | 'other', rawInput?: unknown): GenericCallView {
  return { card: 'generic', title, kind, ...rawInput === undefined ? {} : { rawInput } }
}

/** Stable error for failures not safe to expose. */
function internalError(): StartupToolError {
  return { code: 'internal_error', message: 'The startup item operation failed.' }
}

/** Translate invalid input while withholding internal storage failures. */
function operationError(error: unknown): StartupToolError {
  return error instanceof StartupInputError ? { code: error.code, message: error.message } : internalError()
}

/** Reject an obviously malformed id before it reaches storage. */
function checkedToolId(id: string): StartupToolError | undefined {
  if (id.length === 0 || id.trim() !== id) {
    return { code: 'invalid_id', message: 'id must be non-empty without surrounding whitespace.' }
  }
  return undefined
}

/** The flattened arguments every item-shaped tool shares. */
interface StartupToolArgs {
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
function toInput(args: StartupToolArgs) {
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

/** Parameters every item-shaped tool shares, in the order the catalog states them. */
const ITEM_PARAMETERS = {
  name: {
    type: 'string',
    description: `Short human-readable name in the user's language, at most ${MAX_NAME_LENGTH} characters.`,
  },
  enabled: {
    type: 'boolean',
    description: 'Whether every start runs this item. This is the only gate: a disabled item never runs on its own. Defaults to true.',
  },
  action: { type: 'string', enum: [...STARTUP_ACTIONS], description: ACTION_DESCRIPTION },
  message: {
    type: 'string',
    description: `Text delivered to the target session, at most ${MAX_MESSAGE_LENGTH} characters. `
      + 'Required by message_session and queue_message; optional for new_session.',
  },
  session_id: { type: 'string', description: 'Target session of every action except new_session.' },
  cwd: { type: 'string', description: 'Working directory of a new session; exclusive with workspace_id.' },
  workspace_id: { type: 'string', description: 'Workspace a new session joins; exclusive with cwd.' },
  preset: { type: 'string', description: 'Agent preset a new session runs.' },
  model: MODEL_SCHEMA,
} as const

/**
 * Register the five startup tools in the mounting scope.
 * @param ctx - Context owning the `tools` registry.
 */
export function apply(ctx: Context): void {
  ctx.inject(['startupAutostart'], (startupCtx) => { registerStartupTools(startupCtx) })
}

/**
 * Register the tools in the scope that resolved the startup service.
 * @param ctx - Scope whose `startupAutostart` service the tools act through.
 */
function registerStartupTools(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'startup_create',
    description: CREATE_DESCRIPTION,
    parameters: ITEM_PARAMETERS,
    output: { schema: ITEM_OUTPUT_SCHEMA, render: renderValue },
    async execute(args): Promise<StartupItemView | StartupToolError> {
      try {
        return await ctx.startupAutostart.create(toInput(args))
      } catch (error: unknown) {
        return operationError(error)
      }
    },
    presentCall: args => present('Register startup item', 'other', args.name),
  }))

  ctx.tools.register(defineTool({
    name: 'startup_list',
    description: LIST_DESCRIPTION,
    parameters: {},
    output: { schema: LIST_OUTPUT_SCHEMA, render: renderValue },
    async execute(): Promise<StartupItemView[] | StartupToolError> {
      try {
        return await ctx.startupAutostart.catalog()
      } catch (error: unknown) {
        return operationError(error)
      }
    },
    presentCall: () => present('List startup items', 'read'),
  }))

  ctx.tools.register(defineTool({
    name: 'startup_update',
    description: UPDATE_DESCRIPTION,
    parameters: {
      id: { type: 'string', required: true, description: 'Startup item id returned by startup_list.' },
      ...ITEM_PARAMETERS,
    },
    output: { schema: ITEM_OUTPUT_SCHEMA, render: renderValue },
    async execute(args): Promise<StartupItemView | StartupToolError> {
      const invalid = checkedToolId(args.id)
      if (invalid !== undefined) return invalid
      try {
        return await ctx.startupAutostart.update({ id: args.id, ...toInput(args) })
      } catch (error: unknown) {
        return operationError(error)
      }
    },
    presentCall: args => present('Update startup item', 'other', args.id),
  }))

  ctx.tools.register(defineTool({
    name: 'startup_delete',
    description: DELETE_DESCRIPTION,
    parameters: {
      id: { type: 'string', required: true, description: 'Exact startup item id.' },
    },
    output: { schema: DELETE_OUTPUT_SCHEMA, render: renderValue },
    async execute(args): Promise<{ id: string; deleted: boolean } | StartupToolError> {
      const invalid = checkedToolId(args.id)
      if (invalid !== undefined) return invalid
      try {
        return await ctx.startupAutostart.delete({ id: args.id })
      } catch (error: unknown) {
        return operationError(error)
      }
    },
    presentCall: args => present('Delete startup item', 'other', args.id),
  }))

  ctx.tools.register(defineTool({
    name: 'startup_run',
    description: RUN_DESCRIPTION,
    parameters: {
      id: { type: 'string', required: true, description: 'Exact startup item id.' },
      force: { type: 'boolean', description: 'Run even while the item is inside its cooldown window.' },
    },
    output: { schema: RUN_OUTPUT_SCHEMA, render: renderValue },
    async execute(args): Promise<{ id: string; outcome: StartupOutcome } | StartupToolError> {
      const invalid = checkedToolId(args.id)
      if (invalid !== undefined) return invalid
      try {
        return await ctx.startupAutostart.run({
          id: args.id,
          ...args.force === undefined ? {} : { force: args.force },
        })
      } catch (error: unknown) {
        return operationError(error)
      }
    },
    presentCall: args => present('Run startup item now', 'other', args.id),
  }))
}
