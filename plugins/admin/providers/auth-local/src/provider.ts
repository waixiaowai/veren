/**
 * Stable import path of the local auth provider implementation.
 *
 * The implementation lives in `./local-auth.ts` and its configuration in
 * `./config.ts`; this module only re-exports them so existing deep imports of
 * `./provider.ts` keep working.
 *
 * 本地认证 provider 实现的稳定导入路径。实现位于 `./local-auth.ts`，配置位于
 * `./config.ts`；本模块只做再导出，因此既有的 `./provider.ts` 深导入继续有效。
 *
 * @module @veren/admin-auth-local/provider
 */

export { LocalAuth } from './local-auth.ts'
export { resolveAuthConfig } from './config.ts'
export type { AuthConfig, ResolvedAuthConfig } from './config.ts'
