/**
 * 结构化错误面：稳定 code + 机器可读字段。工具层把这些错误捕获后折进
 * 规范输出值（{ kind: 'error', code, message }），模型读到的是结构而非异常栈。
 * Structured errors: a stable code plus machine-readable fields. The tool layer
 * catches these and folds them into the canonical output value
 * ({ kind: 'error', code, message }) — the model reads structure, not a stack.
 *
 * @module @veren/imagegen
 */
import { HarnessError } from '@deepseek-ai/dsh-llm'

/** 本插件全部稳定错误码。Every stable error code this plugin reports. */
export type ImagegenErrorCode =
  | 'IMAGEGEN_DISABLED'
  | 'IMAGEGEN_NO_KEY'
  | 'IMAGEGEN_NO_WORKSPACE'
  | 'IMAGEGEN_SIZE_INVALID'
  | 'IMAGEGEN_QUALITY_INVALID'
  | 'IMAGEGEN_FORMAT_INVALID'
  | 'IMAGEGEN_TRANSPARENCY_UNSUPPORTED'
  | 'IMAGEGEN_OPTION_UNSUPPORTED'
  | 'IMAGEGEN_PROMPT_EMPTY'
  | 'IMAGEGEN_INPUT_FILE_MISSING'
  | 'IMAGEGEN_CHROMA_INVALID'
  | 'IMAGEGEN_CHROMA_FAILED'
  | 'IMAGEGEN_API_ERROR'
  | 'IMAGEGEN_INVALID_RESPONSE'

/** 带稳定 code 的插件错误；`details` 只携带机器可读字段，永不携带密钥。 */
/** The plugin error carrying a stable code; `details` holds machine-readable fields only, never secrets. */
export class ImagegenError extends HarnessError {
  /** 本插件的稳定码原值（父类把 code 收宽成 string，这里保住 union）。 */
  /** This plugin's stable code verbatim (the parent widens code to string; this keeps the union). */
  readonly stableCode: ImagegenErrorCode
  readonly details: Readonly<Record<string, unknown>>

  constructor(code: ImagegenErrorCode, message: string, details: Readonly<Record<string, unknown>> = {}) {
    super(`imagegen: ${message}`, code)
    this.stableCode = code
    this.details = details
  }
}

/** 输出规范值里的错误形态（模型可见）。The error shape inside the canonical output value (model-visible). */
export interface ErrorValue {
  readonly kind: 'error'
  readonly code: ImagegenErrorCode
  readonly message: string
}

/** 把任意抛出折成规范错误值；本插件错误保留 code，其余折叠为 API_ERROR。 */
/** Folds any throw into a canonical error value; plugin errors keep their code, everything else folds into API_ERROR. */
export function toErrorValue(error: unknown): ErrorValue {
  if (error instanceof ImagegenError) {
    return { kind: 'error', code: error.stableCode, message: error.message }
  }
  const message = error instanceof Error ? error.message : String(error)
  return { kind: 'error', code: 'IMAGEGEN_API_ERROR', message: `imagegen: ${message}` }
}
