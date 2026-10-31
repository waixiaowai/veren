/**
 * Untrusted-input validation for the API gateway.
 *
 * One helper, one error shape: every schema failure becomes the same
 * `VALIDATION_FAILED` error with the offending field name, no matter which
 * schema rejected the value.
 *
 * API 网关的不可信输入校验。单一助手、单一错误形状：无论哪个 schema 拒绝了值，
 * 校验失败都变成同一个带字段名的 `VALIDATION_FAILED` 错误。
 *
 * @module @veren/admin-api-kernel/validation
 */

import { AdminError, type AdminSchema } from '@veren/admin-contract'

/**
 * Validate one untrusted value with an optional schema.
 *
 * @param schema - schema to apply 要应用的 schema
 * @param value - untrusted value 不可信值
 * @param field - field name used in the error 错误中使用的字段名
 * @returns the validated value, or the input when no schema exists 校验后的值；无 schema 时原值
 */
export function validate(schema: AdminSchema | undefined, value: unknown, field: string): unknown {
  if (schema === undefined) return value
  try {
    return schema.parse(value)
  } catch (error) {
    throw new AdminError('VALIDATION_FAILED', `${field} is invalid`, {
      field,
      reason: error instanceof Error ? error.message : String(error),
    })
  }
}
