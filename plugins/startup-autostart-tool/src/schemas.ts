/**
 * The JSON-schema contract of the five startup tools: the parameter surface
 * every item-shaped tool shares, and the exact output schema each tool's result
 * must satisfy.
 *
 * The output schemas enumerate every stable failure code as a one-variant
 * `oneOf` branch, so a model reads the refusal it got back as data instead of
 * guessing at free text.
 *
 * 五个启动工具的 JSON-schema 契约：所有条目形工具共享的参数面，以及每个工具结果必须
 * 满足的精确输出 schema。输出 schema 把每个稳定失败码都枚举成 `oneOf` 的单变体分支，
 * 模型因此把拒绝当作数据读取，而不必猜自由文本。
 * @module @veren/startup-autostart-tool/schemas
 */

import { MAX_MESSAGE_LENGTH, MAX_NAME_LENGTH, STARTUP_ACTIONS } from '@veren/startup-autostart'
import { ACTION_DESCRIPTION } from './descriptions.ts'

export const OUTCOME_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string', required: true, enum: ['ok', 'failed'] },
    detail: { type: 'string', required: true },
    at: { type: 'string', required: true },
  },
} as const

export const MODEL_SCHEMA = {
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

export const ITEM_OUTPUT_SCHEMA = { oneOf: [ITEM_VIEW_SCHEMA, ...ERROR_SCHEMAS] } as const
export const LIST_OUTPUT_SCHEMA = {
  oneOf: [
    { type: 'array', items: ITEM_VIEW_SCHEMA },
    ...ERROR_SCHEMAS,
  ],
} as const
export const DELETE_OUTPUT_SCHEMA = {
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
export const RUN_OUTPUT_SCHEMA = {
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

/** Parameters every item-shaped tool shares, in the order the catalog states them. */
export const ITEM_PARAMETERS = {
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
