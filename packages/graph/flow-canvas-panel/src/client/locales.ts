/**
 * `flowCanvas` namespace dictionaries (Chinese is the key-set source of truth).
 *
 * Every product-visible string of the panel comes from here; node labels,
 * tool names, error codes and output JSON stay verbatim host data. The panel is
 * Chinese-first, so technical ids are always paired with a readable Chinese
 * label instead of leaking raw English chrome into the interface.
 *
 * This entry only re-exports the per-language dictionaries; the key domain is
 * derived once in `locales.zh.ts`.
 *
 * `flowCanvas` 命名空间词典（中文是键集合的事实来源）。面板所有面向用户的文本都来自这里；
 * 节点标签、工具名、错误码与 output JSON 保持宿主数据原样。面板以中文为先，技术标识
 * 必须配有可读中文标签，而不是把英文界面词漏进产品。
 *
 * 本入口只做各语言词典的 re-export；键域在 `locales.zh.ts` 中唯一推导。
 *
 * @module @deepseek-ai/dsh-graph-flow-canvas-panel/client/locales
 */

/** Dictionary namespace owned by this plugin. */
export const NS = 'flowCanvas'

export { zh, type FlowCanvasKey } from './locales.zh.ts'
export { en } from './locales.en.ts'
