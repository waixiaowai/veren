/**
 * Run this package's tests with the DSH checkout's Vitest plus the shared
 * alias config.
 *
 * 用 DSH 检出仓库的 Vitest 加共享别名配置运行测试。
 *
 * @module @deepseek-ai/dsh-graph-flow-canvas-node-echo/test
 */

import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const checkout = resolve(root, '../../../deepseek/deepseek-harness')
const result = spawnSync(
    process.execPath,
    [resolve(checkout, 'node_modules/vitest/vitest.mjs'), 'run', '--config', 'vitest.config.ts'],
    { cwd: root, stdio: 'inherit' },
)
process.exit(result.status ?? 1)
