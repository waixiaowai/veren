/**
 * @veren/auth-core 公共入口：装配、端点、域权威与诊断面。
 * 域实现细节各自成模块；宿主应用只需要 `createAuth` 与适配器装配两件事。
 *
 * The public entry of @veren/auth-core: assembly, endpoints, domain
 * authorities and the diagnostics face. Domain internals live in their own
 * modules; host applications only need `createAuth` and the adapter setup.
 *
 * @module @veren/auth-core
 */

// 装配 / Assembly
export { createAuth } from './auth.ts'
export type { Auth, EmbeddedInput } from './auth.ts'
export { createAuthContext } from './context/auth-context.ts'
export type { AuthContext, CreateAuthContextInput } from './context/auth-context.ts'
export { normalizeOptions, DEFAULTS } from './context/options.ts'
export type {
  AuthOptions,
  NormalizedOptions,
  SessionOptions,
  RateLimitOptions,
  PasswordOptions,
  EmailVerificationOptions,
  UserModelOptions,
  AdvancedOptions,
  DatabaseHooks,
  HooksOptions,
} from './context/options.ts'
export { createAuthCookies, parseCookieHeader, serializeCookie } from './context/cookies.ts'
export type { AuthCookies, CookieAttributes } from './context/cookies.ts'
export { resolveSecret, signWithSecret, verifyWithSecret } from './context/secret.ts'
export type { SecretConfig } from './context/secret.ts'
export { isTrustedOrigin, loopbackOriginAliases, mergeTrustedOrigins } from './context/trusted-origins.ts'

// 存储域 / Storage domain
export { createOrmAdapter } from './storage/orm-adapter.ts'
export { createAuthEntities } from './storage/entities.ts'
export { getAuthTables } from './storage/tables.ts'
export { whereOperators } from './storage/adapter.ts'
export type {
  DBAdapter,
  DBFieldAttribute,
  DBSchema,
  DBTableIndex,
  DBTableModel,
  DBFieldType,
  Where,
  WhereOperator,
  CleanedWhere,
  SortDirection,
} from './storage/adapter.ts'

// 诊断域 / Diagnostics domain
export { APIError, isAPIError, statusNameOf } from './diagnostics/api-error.ts'
export type { APIStatus, APIErrorBody } from './diagnostics/api-error.ts'
export { BASE_ERROR_CODES } from './diagnostics/codes.ts'
export type { BaseErrorCode } from './diagnostics/codes.ts'

// 域权威 / Domain authorities
export { createInternalAdapter } from './identity/internal-adapter.ts'
export type { InternalAdapter, UserWithAccounts, InternalAdapterHooks } from './identity/internal-adapter.ts'
export { createSessionAuthority, isExpired, isFresh, isRefreshDue } from './session/authority.ts'
export type { SessionAuthority, SessionAuthorityConfig, CreateSessionInput } from './session/authority.ts'
export { createPasswordCapability, defaultHash, defaultVerify } from './credential/password.ts'
export type { PasswordCapability } from './credential/password.ts'

// 守卫域 / Guard domain
export { originCheckMiddleware, crossSiteNavigationMiddleware, requireTrustedCallbackURL, validateRedirectValue } from './guard/origin-check.ts'
export { consumeRateLimit, resolveRateLimitRule, resolveClientIP, resetRateLimitStore, tooManyRequestsResponse } from './guard/rate-limit.ts'

// 端点域 / Endpoint domain
export { createAuthEndpoint, buildRouteTable, matchRoute } from './endpoint/endpoint.ts'
export type { AuthEndpoint, EndpointHandler, RouteMatch } from './endpoint/endpoint.ts'
export type {
  EndpointDefinition,
  EndpointContext,
  EndpointRequestState,
  EndpointMetadata,
  EndpointTable,
  Middleware,
  AuthHook,
} from './endpoint/endpoint-types.ts'
export { dispatchAuthEndpoint, RedirectSignal } from './endpoint/dispatch.ts'
export type { DispatchInput, DispatchResult } from './endpoint/dispatch.ts'
export { resolveSession, sessionMiddleware, sensitiveSessionMiddleware, freshSessionMiddleware, requestOnlySessionMiddleware } from './endpoint/middleware.ts'

// 插件域 / Plugin domain
export type { AuthPlugin, PluginMiddleware, PluginRateLimitRule } from './plugin/plugin-types.ts'

// 实体行 / Entity rows
export type { UserRow, SessionRow, AccountRow, VerificationRow, RateLimitRow, SessionContext } from './types.ts'
