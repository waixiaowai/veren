/**
 * The tool face: the helpers every `mail_*` tool shares.
 *
 * Two things live here because every tool needs them and neither belongs to
 * any one tool: turning the plugin's failures into the tool result shape, and
 * the output declaration the tools answer with.
 *
 * The tools are built with `defineTool`, which is the recommended way: it
 * compiles the parameter schema, validates the arguments before the body
 * runs, and derives the model's argument types from the schema — so a
 * parameter's type is declared once and cannot drift from its description.
 *
 * 工具面：每个 `mail_*` 工具共用的助手。
 *
 * 两件事放在这里，因为每个工具都需要它们，而它们不属于任何一个工具：把插件的失败转成工具
 * 结果形状，以及工具作答所用的输出声明。
 *
 * 工具用 `defineTool` 构建——这是推荐写法：它编译参数 schema、在主体运行前校验参数，并从
 * schema 推导模型侧的参数类型——因此一个参数的类型只声明一次，不会与其说明漂移。
 *
 * @module @veren/mail-tool/face
 */

import { defineTool, type ParameterSchemaSpec, type ValueSchemaSpec } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { MailError } from '@veren/mail'

/**
 * The result every mail tool answers with. The payload is declared as `json`
 * rather than spelled out: the tool's result is the service's own view, and
 * re-describing it here would be a second declaration that could drift.
 *
 * 每个邮件工具作答所用的结果。载荷声明为 `json` 而不逐一展开：工具的结果就是服务自身的视图，
 * 在此复述一遍会成为可能与服务漂移的第二份声明。
 */
export interface MailToolResult {
  /** Whether the call succeeded. / 调用是否成功。 */
  readonly ok: boolean
  /** The failure, when the call did not succeed. / 失败时的错误。 */
  readonly error?: ToolFailure
  /** The call's result, as the service's own view of it. / 调用结果，即服务自身的视图。 */
  readonly data?: object
}

/**
 * The output every mail tool answers with.
 *
 * 每个邮件工具作答所用的输出声明。
 */
export const MAIL_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: true,
  properties: {
    ok: { type: 'boolean', required: true, description: 'Whether the call succeeded.' },
    error: { type: 'json', description: 'The failure, when the call did not succeed.' },
    data: { type: 'json', description: 'The call\'s result.' },
  },
} as const satisfies ValueSchemaSpec

/**
 * The failure a tool reports. The code is the stable contract the caller
 * switches on; the message says what happened in one sentence.
 *
 * 工具报告的失败。错误码是调用方据以分支的稳定契约；消息用一句话说明发生了什么。
 */
export interface ToolFailure {
  /** The stable error code. / 稳定错误码。 */
  readonly code: string
  /** What went wrong. / 发生了什么。 */
  readonly message: string
  /** Any further machine-readable detail. / 更多机器可读的细节。 */
  readonly [key: string]: JsonValue
}

/**
 * Turn any thrown value into the tool's failure shape.
 *
 * A `MailError` keeps its code; anything else becomes an internal failure,
 * so a raw provider error never reaches the model as-is.
 *
 * 把任何抛出值转成工具的失败形状。
 *
 * `MailError` 保留其错误码；其余一律转为内部失败，因此原始提供方错误不会原样抵达模型。
 *
 * @param error - the thrown value / 抛出的值
 * @returns the failure / 失败
 */
export function failureOf(error: unknown): ToolFailure {
  if (error instanceof MailError) {
    return { code: error.code, message: error.message }
  }
  const message = error instanceof Error ? error.message : String(error)
  return { code: 'MAIL_INTERNAL', message }
}

/**
 * Normalize a value into lossless JSON.
 *
 * The result crosses into the model as JSON, and JSON has no `undefined`:
 * a round trip is what turns the service's views — which carry absent
 * optional fields — into a value the wire can hold.
 *
 * 把一个值归一为无损 JSON。
 *
 * 结果要跨到模型侧，而 JSON 没有 `undefined`：一次往返正是把服务的视图——它们带有缺省的
 * 可选字段——转成线上能承载的值。
 *
 * @param value - the value to normalize / 要归一化的值
 * @returns the JSON projection / JSON 投影
 */
export function jsonOf<T>(value: T): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue
}

/**
 * Build one tool definition with the shared output declaration.
 *
 * 构建一个带共享输出声明的工具定义。
 *
 * @param name - the tool's name / 工具名
 * @param description - what the model sees / 模型看到的说明
 * @param parameters - the parameter schema / 参数 schema
 * @param execute - the tool's body / 工具主体
 * @returns the tool definition / 工具定义
 */
export function mailTool<const S extends ParameterSchemaSpec>(
  name: string,
  description: string,
  parameters: S,
  execute: (args: Record<string, unknown>) => Promise<MailToolResult>,
) {
  return defineTool({
    name,
    description,
    parameters,
    output: {
      schema: MAIL_OUTPUT_SCHEMA,
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    execute: async (args) => {
      const result = await execute(args as Record<string, unknown>)
      return {
        ok: result.ok,
        ...(result.error === undefined ? {} : { error: jsonOf(result.error) }),
        ...(result.data === undefined ? {} : { data: jsonOf(result.data) }),
      }
    },
  })
}
