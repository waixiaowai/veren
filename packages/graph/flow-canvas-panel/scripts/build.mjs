/**
 * Build the Host entry and the browser bundle with the DSH checkout's own
 * client build tooling: `tsc` emits `lib/types`, then the shared
 * `clientBundle` preset emits `lib/index.js` and the
 * `window.__ModuleLoader__.load` browser artifact `lib/client.js`.
 *
 * 用 DSH 检出仓库自带的客户端构建工具构建：`tsc` 先产出 `lib/types`，再由共享
 * `clientBundle` 预设产出 `lib/index.js` 与浏览器工件 `lib/client.js`。
 *
 * @module @deepseek-ai/dsh-graph-flow-canvas-panel/build
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
