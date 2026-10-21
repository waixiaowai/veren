/**
 * Model-facing tool definitions of the managed web instance. The tools only
 * read a snapshot or ask the lifecycle owner to restart; they never touch the
 * child process directly, so failures stay in the returned ERROR field.
 *
 * 工具定义直接走 `defineTool`（与仓库里其它工具插件同一路子）：参数、输出、
 * 执行体的类型都由 schema 推导，本文件不再持有任何手写的工具类型。
 * The tools are declared through `defineTool`, like every other tool plugin in
 * this repository: parameters, output and body are all derived from the schema,
 * so this file holds no hand-written tool types at all.
 *
 * @module @local/dsh-test/tools
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { INFO_OUTPUT_SCHEMA } from './types.js'
import type { DshTestInfo } from './types.js'

/**
 * Build the two instance tools.
 *
 * @param read - read-only snapshot of the current instance state.
 * @param restart - queued stop-and-start operation returning the resulting state.
 */
export function createInstanceTools(
  read: () => DshTestInfo,
  restart: () => Promise<DshTestInfo>,
): readonly ToolDefinition[] {
  return [
    defineTool({
      name: 'get_dsh_test_info',
      description:
        'Read the managed dsh profile web instance launched by the dsh-test plugin: '
        + 'its token-bearing WEB_URL once ready, DSH_HOME, DSH_SRC, the pre-checked PORT when known, '
        + 'startup/restart STATUS, and a readable ERROR reason after a failure. '
        + 'Without PORT (no `port` config and no `--port` argument) the CLI chose the port and no pre-check ran. '
        + 'This tool is read-only and never starts, stops, or repairs the instance; '
        + 'call restart_dsh_test when WEB_URL is unreachable or the instance must be recycled.',
      parameters: {},
      output: {
        schema: INFO_OUTPUT_SCHEMA,
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      isConcurrencySafe: () => true,
      async execute() {
        // Read-only snapshot; startup failures surface here instead of throwing.
        return read()
      },
    }),
    defineTool({
      name: 'restart_dsh_test',
      description:
        'Restart the managed dsh profile web instance: stop its current process tree, wait for the target port, '
        + 'kill whatever process currently holds that port, then launch a fresh `dsh web` and wait for its new token URL. '
        + 'Use when WEB_URL is unreachable or stale, or after changing the launch configuration; '
        + 'use get_dsh_test_info to inspect without recycling anything. '
        + 'The port pre-check runs only when a target port is known (the `port` config or a `--port` value in `args`); '
        + 'otherwise the CLI picks the port, no occupancy check or cleanup happens, and the result has no PORT. '
        + 'A failed restart reports STATUS=error and a readable ERROR instead of throwing.',
      parameters: {},
      output: {
        schema: INFO_OUTPUT_SCHEMA,
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
      },
      isConcurrencySafe: () => false,
      async execute() {
        // Queued after any in-flight startup; a second call restarts the fresh instance.
        return restart()
      },
    }),
  ]
}
