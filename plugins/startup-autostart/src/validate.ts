/**
 * Input validation and normalization for startup items: field checks, the
 * action-specific target and message rules, and the two management operations
 * (create, update) that turn a caller's request into a complete record.
 *
 * 启动项的输入校验与规范化：字段检查、按动作而异的目标与消息规则，以及把调用方请求
 * 变成完整记录的两个管理操作（创建、更新）。
 * @module @veren/startup-autostart/validate
 */

import type { SessionId } from '@deepseek-ai/dsh-session'
import {
  MAX_MESSAGE_LENGTH, MAX_NAME_LENGTH, STARTUP_ACTIONS, StartupInputError, newStartupItemId,
  withDefined,
} from './item.ts'
import type { StartupAction, StartupItemInput, StartupItemRecord, StartupModelTarget } from './item.ts'

/** A validated candidate whose optional fields are explicitly absent or present. */
interface StartupCandidate {
  action: StartupAction
  name: string
  enabled: boolean
  cwd?: string | undefined
  workspaceId?: string | undefined
  sessionId?: SessionId | undefined
  preset?: string | undefined
  model?: StartupModelTarget | undefined
  message?: string | undefined
}

/** Optional members of a record, accepted with an explicit `undefined`. */
type OptionalFieldValues = { readonly [K in keyof StartupItemRecord]?: StartupItemRecord[K] | undefined }

/** Require a non-blank, length-bounded name. */
function checkedName(value: string | undefined, fallback?: string): string {
  const name = (value ?? fallback ?? '').trim()
  if (name.length === 0) throw new StartupInputError('invalid_name', 'name must not be blank.')
  if (name.length > MAX_NAME_LENGTH) {
    throw new StartupInputError('invalid_name', `name must be at most ${MAX_NAME_LENGTH} characters.`)
  }
  return name
}

/** Require an action from the closed set. */
function checkedAction(value: StartupAction | undefined, fallback?: StartupAction): StartupAction {
  const action = value ?? fallback
  if (action === undefined || !STARTUP_ACTIONS.includes(action)) {
    throw new StartupInputError('invalid_action', `action must be one of ${STARTUP_ACTIONS.join(', ')}.`)
  }
  return action
}

/** Require non-blank, length-bounded message text. */
function checkedMessage(value: string | undefined): string {
  const message = (value ?? '').trim()
  if (message.length === 0) throw new StartupInputError('invalid_message', 'message must not be blank.')
  if (message.length > MAX_MESSAGE_LENGTH) {
    throw new StartupInputError('invalid_message', `message must be at most ${MAX_MESSAGE_LENGTH} characters.`)
  }
  return message
}

/** Trim an optional string, mapping the empty result to absent. */
function optionalText(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const text = value.trim()
  return text.length === 0 ? undefined : text
}

/** Require a non-blank, trimmed target Session id. */
function checkedSessionId(value: string): SessionId {
  const id = value.trim()
  if (id.length === 0) throw new StartupInputError('invalid_target', 'session_id must not be blank.')
  return id as SessionId
}

/** Validate a supplied model target, or return undefined when none was supplied. */
function checkedModel(value: StartupModelTarget | undefined): StartupModelTarget | undefined {
  if (value === undefined) return undefined
  const provider = value.provider.trim()
  const model = value.model.trim()
  if (provider.length === 0 || model.length === 0) {
    throw new StartupInputError('invalid_target', 'model.provider and model.model must not be blank.')
  }
  return withDefined<StartupModelTarget>({ provider, model }, { reasoningEffort: value.reasoningEffort })
}

/**
 * Drop target fields the chosen action cannot use, so switching action never
 * leaves a field the new action forbids behind.
 * @param candidate - merged candidate before the target rules run.
 * @returns the candidate with inapplicable targets removed.
 */
function prunedTargets(candidate: StartupCandidate): StartupCandidate {
  if (candidate.action === 'new_session') return { ...candidate, sessionId: undefined }
  return { ...candidate, cwd: undefined, workspaceId: undefined, preset: undefined }
}

/**
 * Resolve the message for one action: required by `message_session` and
 * `queue_message`, forbidden for `resume_session`, optional for `new_session`.
 * @param action - the item's action.
 * @param raw - supplied message text, if any.
 * @returns the message to store, or undefined when the action carries none.
 * @throws StartupInputError when a required message is blank, an over-long
 * message is supplied, or `resume_session` is given one.
 */
function resolvedMessage(action: StartupAction, raw: string | undefined): string | undefined {
  if (action === 'resume_session') {
    if (raw === undefined) return undefined
    throw new StartupInputError('invalid_message', 'resume_session delivers no message; use message_session or queue_message.')
  }
  if (raw === undefined || raw.trim().length === 0) {
    if (action === 'new_session') return undefined
    throw new StartupInputError('invalid_message', `action "${action}" requires message.`)
  }
  return checkedMessage(raw)
}

/**
 * Apply the action-specific target rules to an already-pruned candidate.
 * @param candidate - the candidate to check.
 * @throws StartupInputError naming the rule the candidate breaks.
 */
function checkTargetRules(candidate: StartupCandidate): void {
  if (candidate.action === 'new_session') {
    if (candidate.cwd !== undefined && candidate.workspaceId !== undefined) {
      throw new StartupInputError('invalid_target', 'new_session accepts cwd or workspace_id, not both.')
    }
    return
  }
  if (candidate.sessionId === undefined) {
    throw new StartupInputError('invalid_target', `action "${candidate.action}" requires session_id.`)
  }
}

/** Collect the optional fields of a candidate for one `withDefined` call. */
function targetFields(candidate: StartupCandidate): OptionalFieldValues {
  return {
    cwd: candidate.cwd,
    workspaceId: candidate.workspaceId,
    sessionId: candidate.sessionId,
    preset: candidate.preset,
    model: candidate.model,
    message: candidate.message,
  }
}

/**
 * Validate a create request into a pruned candidate, before the message rules.
 * @param input - fields supplied by the caller.
 * @param action - the already-checked action.
 * @returns the candidate carrying every supplied field.
 * @throws StartupInputError for any rejected field.
 */
function createdCandidate(input: StartupItemInput, action: StartupAction): StartupCandidate {
  return prunedTargets({
    action,
    name: checkedName(input.name),
    enabled: input.enabled ?? true,
    cwd: optionalText(input.cwd),
    workspaceId: optionalText(input.workspaceId),
    sessionId: input.sessionId === undefined ? undefined : checkedSessionId(input.sessionId),
    preset: optionalText(input.preset),
    model: checkedModel(input.model),
    message: undefined,
  })
}

/**
 * Merge an update request onto the stored record, then prune for the action.
 * An omitted field keeps its stored value; a supplied field replaces it.
 * @param current - the stored record.
 * @param input - fields to replace.
 * @param action - the already-checked action (stored one when not supplied).
 * @returns the merged candidate before the message rules run.
 * @throws StartupInputError for any rejected supplied field.
 */
function mergedCandidate(
  current: StartupItemRecord,
  input: StartupItemInput,
  action: StartupAction,
): StartupCandidate {
  return prunedTargets({
    action,
    name: checkedName(input.name, current.name),
    enabled: input.enabled ?? current.enabled,
    cwd: input.cwd === undefined ? current.cwd : optionalText(input.cwd),
    workspaceId: input.workspaceId === undefined ? current.workspaceId : optionalText(input.workspaceId),
    sessionId: input.sessionId === undefined ? current.sessionId : checkedSessionId(input.sessionId),
    preset: input.preset === undefined ? current.preset : optionalText(input.preset),
    model: input.model === undefined ? current.model : checkedModel(input.model),
    message: undefined,
  })
}

/**
 * Validate and normalize a create request into a complete record.
 * @param input - fields supplied by the caller.
 * @param now - millisecond clock reading stamped into the record.
 * @returns the durable record to store.
 * @throws StartupInputError for any rejected field.
 */
export function createStartupItem(input: StartupItemInput, now: number): StartupItemRecord {
  const action = checkedAction(input.action)
  const targeted = createdCandidate(input, action)
  // The target rules run before the message rules: when a request is missing
  // both, the missing target is the one the caller has to fix first.
  checkTargetRules(targeted)
  const candidate = { ...targeted, message: resolvedMessage(action, input.message) }
  const instant = new Date(now).toISOString()
  return withDefined<StartupItemRecord>({
    id: newStartupItemId(),
    name: candidate.name,
    enabled: candidate.enabled,
    action: candidate.action,
    createdAt: instant,
    updatedAt: instant,
    runCount: 0,
  }, targetFields(candidate))
}

/**
 * Apply a partial edit to a stored record, re-validating the complete result.
 * An omitted field keeps its stored value; a supplied field replaces it.
 * @param current - the stored record.
 * @param input - fields to replace.
 * @param now - millisecond clock reading stamped into `updatedAt`.
 * @returns the updated record.
 * @throws StartupInputError for any rejected field, including one the stored
 * record cannot satisfy after an action change.
 */
export function updateStartupItem(
  current: StartupItemRecord,
  input: StartupItemInput,
  now: number,
): StartupItemRecord {
  const action = checkedAction(input.action, current.action)
  const targeted = mergedCandidate(current, input, action)
  checkTargetRules(targeted)
  // Switching to `resume_session` drops whatever message the record carried:
  // there is no "clear this field" verb, and refusing the switch outright would
  // leave the caller with no way to reach the action.
  const candidate = {
    ...targeted,
    message: resolvedMessage(action, action === 'resume_session' ? undefined : input.message ?? current.message),
  }
  return withDefined<StartupItemRecord>({
    id: current.id,
    name: candidate.name,
    enabled: candidate.enabled,
    action: candidate.action,
    createdAt: current.createdAt,
    updatedAt: new Date(now).toISOString(),
    runCount: current.runCount,
  }, {
    ...targetFields(candidate),
    lastRunAt: current.lastRunAt,
    lastOutcome: current.lastOutcome,
  })
}
