/**
 * Build the echo renderer demo with the DSH checkout's shared client preset.
 *
 * 用 DSH 检出仓库的共享客户端预设构建 echo 渲染器演示。
 *
 * @module @deepseek-ai/dsh-graph-flow-canvas-node-echo/build
 */

import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const checkout = resolve(root, '../../../deepseek/deepseek-harness')

/** Run one Node entry point and fail the build on a non-zero exit. */
function run(entry, args) {
    const result = spawnSync(process.execPath, [entry, ...args], { cwd: root, stdio: 'inherit' })
    if (result.status !== 0) process.exit(result.status ?? 1)
}

run(resolve(checkout, 'node_modules/typescript/bin/tsc'), ['-p', 'tsconfig.json'])
run(resolve(checkout, 'node_modules/tsdown/dist/run.mjs'), ['--config', 'tsdown.config.ts'])
