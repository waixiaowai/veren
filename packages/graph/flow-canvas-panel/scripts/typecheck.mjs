/**
 * Type-check against the DSH checkout and this repository's graph sources,
 * reporting only diagnostics under `src/` (the checkout's own project-reference
 * diagnostics are not this package's).
 *
 * 对 DSH 检出仓库与本仓库 graph 源码做类型检查，只报告 `src/` 下的诊断。
 *
 * @module @deepseek-ai/dsh-graph-flow-canvas-panel/typecheck
 */

import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const checkout = resolve(root, '../../../deepseek/deepseek-harness')
const result = spawnSync(
  process.execPath,
  [resolve(checkout, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.json', '--noEmit', '--pretty', 'false'],
  { cwd: root, encoding: 'utf8' },
)
const lines = `${result.stdout ?? ''}${result.stderr ?? ''}`.split(/\r?\n/)
const own = lines.filter(line => line.startsWith('src/') || line.startsWith('tests/'))
if (own.length > 0) {
  process.stderr.write(`${own.join('\n')}\n`)
  process.exit(1)
}
process.stdout.write('typecheck: no diagnostics under src/ or tests/\n')
