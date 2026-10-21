/**
 * dsh-test types: the Config the launch reads, and the tool output contract.
 *
 * 输出契约只有一处声明：schema 用 DSH 的 `ValueSchemaSpec` 写死，`DshTestInfo`
 * 由 `InferValue` 从它推导。以前这里是「手写 interface + 手写 JSON Schema」两份，
 * 而那份 schema 还带着 DSH 强制子集不接受的 `minimum`/`maximum`（会在注册期被
 * 拒绝），类型改不动 schema、schema 也改不动类型。
 * The output contract has exactly one declaration: the schema is authored once in
 * DSH's `ValueSchemaSpec` and `DshTestInfo` is inferred from it. It used to be a
 * hand-written interface beside a hand-written JSON Schema — and that schema
 * carried `minimum`/`maximum`, which the enforced subset rejects at registration.
 *
 * @module @local/dsh-test/types
 */
import type { InferValue, ValueSchemaSpec } from '@deepseek-ai/dsh-tools'

/** Request for one `dsh web` launch after Config validation. */
export interface DshTestConfig {
  /** Executable that launches the dsh CLI, for example `pnpm` or an absolute `dsh` path. */
  command: string
  /** Arguments after the executable. */
  args: string[]
  /** TCP port handed to the web runner as `--port`; omitted follows a `--port` argument or the CLI default. */
  port?: number | undefined
  /** Working directory of the spawned process; omitted follows `srcDir`. */
  cwd?: string | undefined
  /** Source directory reported as DSH_SRC; omitted is the checkout containing this plugin. */
  srcDir?: string | undefined
  /** Harness home reported as DSH_HOME; omitted follows `$DSH_HOME`, then `~/.dsh`. */
  dshHome?: string | undefined
  /** Budget in milliseconds for the subprocess to print its ready URL. */
  startupTimeoutMs: number
}

/**
 * Canonical output schema of the instance tools (the enforced DSH subset:
 * `required` is a per-property annotation, numeric bounds are not part of it).
 * 实例工具的规范输出 schema（DSH 强制子集：`required` 是逐属性注解，数值上下限
 * 不属于该子集）。
 */
export const INFO_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    WEB_URL: { type: 'string', description: 'Token-bearing access URL of the managed web instance; present once ready.' },
    DSH_HOME: { type: 'string', required: true, description: 'Harness home directory.' },
    DSH_SRC: { type: 'string', required: true, description: 'Source directory of the deepseek-harness checkout.' },
    PORT: {
      type: 'integer',
      description: 'Target port pre-checked before launch; absent when the CLI picked the port and no check ran.',
    },
    STATUS: { type: 'string', enum: ['starting', 'ready', 'error'], required: true, description: 'Lifecycle of the managed instance.' },
    ERROR: { type: 'string', description: 'Readable startup or restart failure reason; present only after a failure.' },
  },
} as const satisfies ValueSchemaSpec

/** Canonical output value of the instance tools, inferred from the schema. */
export type DshTestInfo = InferValue<typeof INFO_OUTPUT_SCHEMA>

/** Standard Schema validation result. */
export type StandardValidation =
  | { value: DshTestConfig }
  | { issues: Array<{ message: string }> }
