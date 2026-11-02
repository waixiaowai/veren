/**
 * @veren/zhihu-client public entry: the canonical Zhihu types, the data-source
 * port every collector implements, the structured error face, and the official
 * open-platform client that is the port's v1 implementation.
 *
 * 公开入口：规范类型、数据源端口、结构化错误面，以及作为该端口 v1 实现的
 * 官方开放平台客户端。
 *
 * @module @veren/zhihu-client
 */

export { CONTENT_TYPES } from './types.ts'
export type {
  AccountSnapshot,
  CommentItem,
  ContentRef,
  ContentStats,
  ContentType,
  HotItem,
  QuestionSuggestion,
  QuotaState,
} from './types.ts'
export type { ZhihuDataSource } from './port.ts'
export { ZhihuError, ZhihuErrorCode, codeOfPlatform, toZhihuError } from './errors.ts'
export type { ZhihuErrorDetails } from './errors.ts'
export { OfficialZhihuClient } from './official/client.ts'
export type { OfficialClientOptions } from './official/client.ts'
export { DailyCallBudget } from './official/budget.ts'
export type { Clock } from './official/budget.ts'
export {
  AUTH_HEADER,
  CONTENT_TYPE_ALL,
  ENDPOINT_PATHS,
  EndpointName,
  PLATFORM_BASE_URL,
  QUOTA_API_IDS,
  QueryParam,
  TIMESTAMP_HEADER,
} from './official/endpoints.ts'
export type { TransportOptions } from './official/http.ts'
export { HttpTransport } from './official/http.ts'
export { contentIdOf, toContentType, toIso } from './official/normalize.ts'
