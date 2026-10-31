/**
 * The model-facing description copy of the five startup tools.
 *
 * These strings are the tools' contract text: a model reads them to decide when
 * and how to call, so they state the no-debounce semantics and the per-action
 * rules verbatim rather than leaving them to be inferred.
 *
 * 五个启动工具面向模型的描述文案。这些字符串是工具的契约文本：模型据此决定何时以及
 * 如何调用，因此无防抖语义与逐动作规则都在这里逐字写明，而不是留给模型推断。
 * @module @veren/startup-autostart-tool/descriptions
 */

/** Shared action semantics, appended to the descriptions that take an action. */
export const ACTION_DESCRIPTION =
  'What the item does when it fires. new_session creates a session at cwd or in workspace_id and (when message is given) '
  + 'delivers it as its first turn. resume_session only brings an existing session_id live. message_session resumes '
  + 'session_id and delivers message as a new turn. queue_message resumes session_id and leaves message in its inbox '
  + 'without waking it, so the session reads it whenever it next runs.'

export const CREATE_DESCRIPTION =
  'Register a startup item: work DeepSeek Harness performs every time it starts, after the surface is serving. '
  + 'Every enabled item runs on every successful start, with no debounce: a restart interrupts the work the previous '
  + 'start began, so the next start runs the item again. The only gate is enabled. '
  + 'The item is stored outside any session log, so deleting a project folder never deletes it. ' + ACTION_DESCRIPTION

export const LIST_DESCRIPTION =
  'List every registered startup item with its action, target, enabled state, and the outcome of its last run. '
  + 'Reading the list never starts a session.'

export const UPDATE_DESCRIPTION =
  'Change one startup item in place, keeping its id and its run history. Supply only the fields to replace; '
  + 'omitted fields keep their stored values. Changing action re-applies that action\'s target rules.'

export const DELETE_DESCRIPTION =
  'Delete one startup item. It never fires again; a message already queued in a session inbox is not retracted.'

export const RUN_DESCRIPTION =
  'Run one startup item right now instead of waiting for the next start. Nothing debounces a run: the only refusal is '
  + 'item_disabled, which a switched-off item raises unless force is true.'
