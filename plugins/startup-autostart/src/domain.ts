/**
 * Facade over the domain vocabulary, kept so existing importers of this module
 * path keep working: the package entry re-exports from here, and the panel
 * package imports the view types through this exact path.
 *
 * The vocabulary itself lives in three responsibility modules: `item.ts` (the
 * durable record and its error), `validate.ts` (create/update normalization),
 * and `view.ts` (the projected view and the delivered-message framing).
 *
 * 词汇表门面：保留本模块路径，让既有导入方继续工作——包入口从这里再导出，面板包也
 * 通过这个确切路径导入视图类型。
 *
 * 词汇表本体按职责分三个模块：`item.ts`（持久化记录与错误）、`validate.ts`
 * （创建/更新规范化）、`view.ts`（投影视图与投递消息框架）。
 * @module @veren/startup-autostart/domain
 */

export {
  MAX_MESSAGE_LENGTH,
  MAX_NAME_LENGTH,
  STARTUP_ACTIONS,
  StartupInputError,
  newStartupItemId,
  withDefined,
} from './item.ts'
export type {
  StartupAction,
  StartupErrorCode,
  StartupItemId,
  StartupItemInput,
  StartupItemRecord,
  StartupModelTarget,
  StartupOutcome,
} from './item.ts'
export { createStartupItem, updateStartupItem } from './validate.ts'
export { startupItemView, startupMessageText } from './view.ts'
export type { StartupItemView } from './view.ts'
