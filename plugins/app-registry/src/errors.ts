/**
 * 结构化错误：稳定 code + 机器可读字段（misconfiguration fails loud）。
 * Structured error: stable code + machine-readable fields (misconfiguration fails loud).
 *
 * 注意：错误码常量 `AppErrorCode` 冻结在 `./types.ts`，本文件只负责抛出方式。
 * Note: the frozen `AppErrorCode` constants live in `./types.ts`; this file only
 * defines how they are thrown.
 */
import type { AppErrorCode as Code } from './types.ts'

/** 注册表错误：message 里给人看，code/details 给机器判断。 */
/** Registry error: message for humans, code/details for machines. */
export class AppRegistryError extends Error {
  /** 稳定错误码（冻结常量之一）/ stable error code (one of the frozen constants) */
  readonly code: Code
  /** 机器可读上下文，如冲突双方 id / machine-readable context, e.g. both sides of a conflict */
  readonly details: Readonly<Record<string, unknown>>

  constructor(code: Code, message: string, details: Readonly<Record<string, unknown>> = {}) {
    super(`[${code}] ${message}`)
    this.name = 'AppRegistryError'
    this.code = code
    this.details = details
  }
}

/** 快捷抛出：new AppRegistryError(...) 的单行写法 / one-line throw helper */
export function fail(
  code: Code,
  message: string,
  details?: Readonly<Record<string, unknown>>,
): never {
  throw new AppRegistryError(code, message, details)
}
