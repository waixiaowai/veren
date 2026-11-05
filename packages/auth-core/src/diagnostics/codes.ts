/**
 * 基础错误码：诊断域统一定义的全部 49 个基础码。
 * 全部端点只引用不重定义；扩展可贡献自己的错误码命名空间，但不得与基础集合重名。
 * 语义表见设计文档 plugins/auth/design/errors.md §5.1。
 *
 * Base error codes: the full set of 49 base codes defined by the diagnostics
 * domain. Endpoints reference them without redefining; extensions may
 * contribute their own code namespaces but must not shadow base names.
 * Semantics table: plugins/auth/design/errors.md §5.1.
 *
 * @module @veren/auth-core/diagnostics/codes
 */

/** 基础错误码字面量集合。 / The literal set of base error codes. */
export const BASE_ERROR_CODES = [
  // identity 身份域
  'USER_NOT_FOUND',
  'FAILED_TO_CREATE_USER',
  'FAILED_TO_UPDATE_USER',
  'INVALID_USER',
  'USER_ALREADY_EXISTS',
  'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL',
  'USER_EMAIL_NOT_FOUND',
  'USER_ALREADY_HAS_PASSWORD',
  'FIELD_NOT_ALLOWED',
  'FAILED_TO_UNLINK_LAST_ACCOUNT',
  'ACCOUNT_NOT_FOUND',
  'LINKED_ACCOUNT_ALREADY_EXISTS',
  'SOCIAL_ACCOUNT_ALREADY_LINKED',
  // credential 凭证域
  'INVALID_EMAIL',
  'INVALID_EMAIL_OR_PASSWORD',
  'INVALID_PASSWORD',
  'PASSWORD_TOO_SHORT',
  'PASSWORD_TOO_LONG',
  'CREDENTIAL_ACCOUNT_NOT_FOUND',
  'PASSWORD_ALREADY_SET',
  // session 会话域
  'FAILED_TO_CREATE_SESSION',
  'FAILED_TO_GET_SESSION',
  'SESSION_NOT_FRESH',
  'SESSION_EXPIRED',
  'METHOD_NOT_ALLOWED_DEFER_SESSION_REQUIRED',
  // identity 校验凭据与邮箱
  'INVALID_TOKEN',
  'TOKEN_EXPIRED',
  'FAILED_TO_CREATE_VERIFICATION',
  'VERIFICATION_EMAIL_NOT_ENABLED',
  'EMAIL_NOT_VERIFIED',
  'EMAIL_ALREADY_VERIFIED',
  'EMAIL_MISMATCH',
  'EMAIL_CAN_NOT_BE_UPDATED',
  'CHANGE_EMAIL_DISABLED',
  // oauth 联合授权域
  'ID_TOKEN_NOT_SUPPORTED',
  'PROVIDER_NOT_FOUND',
  'FAILED_TO_GET_USER_INFO',
  // guard 守卫域
  'INVALID_ORIGIN',
  'MISSING_OR_NULL_ORIGIN',
  'INVALID_CALLBACK_URL',
  'INVALID_REDIRECT_URL',
  'INVALID_ERROR_CALLBACK_URL',
  'INVALID_NEW_USER_CALLBACK_URL',
  'CALLBACK_URL_REQUIRED',
  'CROSS_SITE_NAVIGATION_LOGIN_BLOCKED',
  // endpoint 端点路由域
  'VALIDATION_ERROR',
  'MISSING_FIELD',
  'BODY_MUST_BE_AN_OBJECT',
  'ASYNC_VALIDATION_NOT_SUPPORTED',
] as const

/** 基础错误码类型。 / The base error code union type. */
export type BaseErrorCode = (typeof BASE_ERROR_CODES)[number]

/** 断言穷尽：新增错误码时由编译器指出遗漏分支。 / Exhaustiveness guard for switch statements over codes. */
export function assertNeverCode(code: never): never {
  throw new Error(`unhandled error code: ${String(code)}`)
}
