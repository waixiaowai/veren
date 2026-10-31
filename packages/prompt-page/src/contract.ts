/**
 * 页面实例与 URL 契约 / page-instance & url contract
 *
 * 应用侧（app-registry）与任务侧（task-center）共用的最小面集中在这里；
 * prompt-page 不 import 任何插件包——插件来实现本文件的接口（依赖方向：插件 → 本包）。
 * The minimal face shared by the two plugins lives here; plugins depend on this
 * package, never the reverse (no import cycles).
 *
 * 本文件是组合入口：职责拆分在各自模块——page-url（规范 URL）、page-errors
 * （结构化错误）、page-instance（实例记录与索引）、app-url（应用作用域 URL 形态）、
 * page-archetype（页面档位）。全部导出经此处原样转发，导出面零变化。
 * This file is the composition entry: the responsibilities live in their own
 * modules — page-url (canonical urls), page-errors (structured errors),
 * page-instance (records & the index), app-url (app-scoped url shape) and
 * page-archetype (page archetypes). Every export is forwarded here unchanged.
 */
export { canonicalizePageUrl } from './page-url.ts'
export type { PageInstanceKey, AppIdString, CanonicalizePageUrl } from './page-url.ts'
// PageErrorCode 同时是值（常量表）与类型，一条导出同时携带两个含义。
// PageErrorCode is both a value (the const table) and a type; one export carries both.
export { PageError, PageErrorCode } from './page-errors.ts'
export type { PageInstanceState, PageInstanceRecord, PageInstanceIndex, InstanceSnapshot } from './page-instance.ts'
export {
  APPS_URL_PREFIX,
  RESERVED_APP_IDS,
  assertAppUrlPattern,
  isAppUrlPattern,
  isValidAppId,
  patternParamsOf,
} from './app-url.ts'
export { assertParamsMatchPattern, pageArchetypeOf } from './page-archetype.ts'
export type { PageArchetype } from './page-archetype.ts'
