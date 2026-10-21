/**
 * Model-facing tool definitions of the managed web instance. The tools only
 * read a snapshot or ask the lifecycle owner to restart; they never touch the
 * child process directly, so failures stay in the returned ERROR field.
 */
import type { DshTestInfo, ToolDefinition } from './types.js'

/** Shared JSON output contract of both instance tools. */
const INFO_OUTPUT: ToolDefinition['output'] = {
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['DSH_HOME', 'DSH_SRC', 'STATUS'],
    properties: {
      WEB_URL: { type: 'string', description: 'Token-bearing access URL of the managed web instance.' },
      DSH_HOME: { type: 'string' },
      DSH_SRC: { type: 'string' },
      PORT: {
        type: 'integer',
        minimum: 1,
        maximum: 65535,
        description: 'Target port pre-checked before launch; absent when the CLI picked the port and no check ran.',
      },
      STATUS: { type: 'string', enum: ['starting', 'ready', 'error'] },
      ERROR: { type: 'string', description: 'Readable startup or restart failure reason; present only after a failure.' },
    },
  },
  render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
}

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
    {
      name: 'get_dsh_test_info',
      description:
        'Read the managed dsh profile web instance launched by the dsh-test plugin: '
        + 'its token-bearing WEB_URL once ready, DSH_HOME, DSH_SRC, the pre-checked PORT when known, '
        + 'startup/restart STATUS, and a readable ERROR reason after a failure. '
        + 'Without PORT (no `port` config and no `--port` argument) the CLI chose the port and no pre-check ran. '
        + 'This tool is read-only and never starts, stops, or repairs the instance; '
        + 'call restart_dsh_test when WEB_URL is unreachable or the instance must be recycled.',
      parameters: {},
      output: INFO_OUTPUT,
      isConcurrencySafe: () => true,
      async execute() {
        // Read-only snapshot; startup failures surface here instead of throwing.
        return read()
      },
    },
    {
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
      output: INFO_OUTPUT,
      isConcurrencySafe: () => false,
      async execute() {
        // Queued after any in-flight startup; a second call restarts the fresh instance.
        return restart()
      },
    },
  ]
}
