/**
 * Startup-autostart vocabulary: the durable record, its input validation, and
 * the views the model tools and the future management panel both read.
 *
 * There is no debounce here. Every successful start runs every enabled item,
 * because a restart interrupts the sessions the items drive: a run that was
 * suppressed is a run the user never gets back.
 *
 * 启动自启动的词汇表：持久化记录、输入校验，以及模型工具与日后的管理面板共同读取
 * 的视图。
 *
 * 这里没有防抖。每次成功启动都会执行每一条 enabled 的启动项 —— 重启会打断启动项正在
 * 驱动的会话，被压掉的一次执行就是用户永远拿不回来的那一次。
 * @module @veren/startup-autostart/domain
 */
import { randomUUID } from 'node:crypto';
/** Every action an item may declare, for validation and tool schemas. */
export const STARTUP_ACTIONS = [
    'new_session', 'resume_session', 'message_session', 'queue_message',
];
/**
 * Rejected management input. The trigger path never throws this: a startup item
 * that cannot be delivered records a failed outcome instead of failing boot.
 */
export class StartupInputError extends Error {
    code;
    /**
     * @param code - stable machine-readable code.
     * @param message - actionable English text for the model and the panel.
     */
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = 'StartupInputError';
    }
}
/** Longest accepted name, in characters. */
export const MAX_NAME_LENGTH = 120;
/** Longest accepted message, in characters. */
export const MAX_MESSAGE_LENGTH = 8_000;
/** Mint one fresh item identity. */
export function newStartupItemId() {
    return `startup-${randomUUID()}`;
}
/**
 * Copy every defined member of `values` onto `target`.
 *
 * The record and view types declare their optional members without
 * `| undefined`, which `exactOptionalPropertyTypes` requires. Assembling them
 * from a conditional spread would widen every optional member to
 * `T | undefined`, so optional data is attached through this one typed helper.
 * @param target - the fully required base object to extend.
 * @param values - optional members; a member that is `undefined` is skipped.
 * @returns the same target object.
 */
export function withDefined(target, values) {
    for (const [key, value] of Object.entries(values)) {
        if (value !== undefined)
            Object.assign(target, { [key]: value });
    }
    return target;
}
/** Require a non-blank, length-bounded name. */
function checkedName(value, fallback) {
    const name = (value ?? fallback ?? '').trim();
    if (name.length === 0)
        throw new StartupInputError('invalid_name', 'name must not be blank.');
    if (name.length > MAX_NAME_LENGTH) {
        throw new StartupInputError('invalid_name', `name must be at most ${MAX_NAME_LENGTH} characters.`);
    }
    return name;
}
/** Require an action from the closed set. */
function checkedAction(value, fallback) {
    const action = value ?? fallback;
    if (action === undefined || !STARTUP_ACTIONS.includes(action)) {
        throw new StartupInputError('invalid_action', `action must be one of ${STARTUP_ACTIONS.join(', ')}.`);
    }
    return action;
}
/** Require non-blank, length-bounded message text. */
function checkedMessage(value) {
    const message = (value ?? '').trim();
    if (message.length === 0)
        throw new StartupInputError('invalid_message', 'message must not be blank.');
    if (message.length > MAX_MESSAGE_LENGTH) {
        throw new StartupInputError('invalid_message', `message must be at most ${MAX_MESSAGE_LENGTH} characters.`);
    }
    return message;
}
/** Trim an optional string, mapping the empty result to absent. */
function optionalText(value) {
    if (value === undefined)
        return undefined;
    const text = value.trim();
    return text.length === 0 ? undefined : text;
}
/** Require a non-blank, trimmed target Session id. */
function checkedSessionId(value) {
    const id = value.trim();
    if (id.length === 0)
        throw new StartupInputError('invalid_target', 'session_id must not be blank.');
    return id;
}
/** Validate a supplied model target, or return undefined when none was supplied. */
function checkedModel(value) {
    if (value === undefined)
        return undefined;
    const provider = value.provider.trim();
    const model = value.model.trim();
    if (provider.length === 0 || model.length === 0) {
        throw new StartupInputError('invalid_target', 'model.provider and model.model must not be blank.');
    }
    return withDefined({ provider, model }, { reasoningEffort: value.reasoningEffort });
}
/**
 * Drop target fields the chosen action cannot use, so switching action never
 * leaves a field the new action forbids behind.
 * @param candidate - merged candidate before the target rules run.
 * @returns the candidate with inapplicable targets removed.
 */
function prunedTargets(candidate) {
    if (candidate.action === 'new_session')
        return { ...candidate, sessionId: undefined };
    return { ...candidate, cwd: undefined, workspaceId: undefined, preset: undefined };
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
function resolvedMessage(action, raw) {
    if (action === 'resume_session') {
        if (raw === undefined)
            return undefined;
        throw new StartupInputError('invalid_message', 'resume_session delivers no message; use message_session or queue_message.');
    }
    if (raw === undefined || raw.trim().length === 0) {
        if (action === 'new_session')
            return undefined;
        throw new StartupInputError('invalid_message', `action "${action}" requires message.`);
    }
    return checkedMessage(raw);
}
/**
 * Apply the action-specific target rules to an already-pruned candidate.
 * @param candidate - the candidate to check.
 * @throws StartupInputError naming the rule the candidate breaks.
 */
function checkTargetRules(candidate) {
    if (candidate.action === 'new_session') {
        if (candidate.cwd !== undefined && candidate.workspaceId !== undefined) {
            throw new StartupInputError('invalid_target', 'new_session accepts cwd or workspace_id, not both.');
        }
        return;
    }
    if (candidate.sessionId === undefined) {
        throw new StartupInputError('invalid_target', `action "${candidate.action}" requires session_id.`);
    }
}
/** Collect the optional fields of a candidate for one `withDefined` call. */
function targetFields(candidate) {
    return {
        cwd: candidate.cwd,
        workspaceId: candidate.workspaceId,
        sessionId: candidate.sessionId,
        preset: candidate.preset,
        model: candidate.model,
        message: candidate.message,
    };
}
/**
 * Validate and normalize a create request into a complete record.
 * @param input - fields supplied by the caller.
 * @param now - millisecond clock reading stamped into the record.
 * @returns the durable record to store.
 * @throws StartupInputError for any rejected field.
 */
export function createStartupItem(input, now) {
    const action = checkedAction(input.action);
    const targeted = prunedTargets({
        action,
        name: checkedName(input.name),
        enabled: input.enabled ?? true,
        cwd: optionalText(input.cwd),
        workspaceId: optionalText(input.workspaceId),
        sessionId: input.sessionId === undefined ? undefined : checkedSessionId(input.sessionId),
        preset: optionalText(input.preset),
        model: checkedModel(input.model),
        message: undefined,
    });
    // The target rules run before the message rules: when a request is missing
    // both, the missing target is the one the caller has to fix first.
    checkTargetRules(targeted);
    const candidate = { ...targeted, message: resolvedMessage(action, input.message) };
    const instant = new Date(now).toISOString();
    return withDefined({
        id: newStartupItemId(),
        name: candidate.name,
        enabled: candidate.enabled,
        action: candidate.action,
        createdAt: instant,
        updatedAt: instant,
        runCount: 0,
    }, targetFields(candidate));
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
export function updateStartupItem(current, input, now) {
    const action = checkedAction(input.action, current.action);
    const targeted = prunedTargets({
        action,
        name: checkedName(input.name, current.name),
        enabled: input.enabled ?? current.enabled,
        cwd: input.cwd === undefined ? current.cwd : optionalText(input.cwd),
        workspaceId: input.workspaceId === undefined ? current.workspaceId : optionalText(input.workspaceId),
        sessionId: input.sessionId === undefined ? current.sessionId : checkedSessionId(input.sessionId),
        preset: input.preset === undefined ? current.preset : optionalText(input.preset),
        model: input.model === undefined ? current.model : checkedModel(input.model),
        message: undefined,
    });
    checkTargetRules(targeted);
    // Switching to `resume_session` drops whatever message the record carried:
    // there is no "clear this field" verb, and refusing the switch outright would
    // leave the caller with no way to reach the action.
    const candidate = {
        ...targeted,
        message: resolvedMessage(action, action === 'resume_session' ? undefined : input.message ?? current.message),
    };
    return withDefined({
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
    });
}
/**
 * The fixed model-facing framing every delivered startup message carries, so a
 * woken Session can tell a startup instruction apart from the user typing.
 * @param item - the item whose message is delivered.
 * @param startedAt - instant the run started, ISO 8601 with milliseconds.
 * @param text - the message body to deliver.
 * @returns stable model-visible text with JSON-escaped dynamic fields.
 */
export function startupMessageText(item, startedAt, text) {
    return [
        '[STARTUP AUTOSTART]',
        'This message comes from a startup item the user registered; it runs once each time DeepSeek Harness starts.',
        `startup_item_json: ${JSON.stringify(item.name)}`,
        `startup_item_id_json: ${JSON.stringify(item.id)}`,
        `started_at: ${startedAt}`,
        `startup_prompt_json: ${JSON.stringify(text)}`,
    ].join('\n');
}
/**
 * Project one record onto the shared view.
 * @param item - the stored record.
 * @returns the view both the tools and the panel render.
 */
export function startupItemView(item) {
    return withDefined({
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
    });
}
