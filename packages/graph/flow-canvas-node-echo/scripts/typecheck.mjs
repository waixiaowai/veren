/**
 * Type-check the echo renderer demo, reporting only its own diagnostics.
 *
 * 对 echo 渲染器演示做类型检查，只报告本包的诊断。
 *
 * @module @deepseek-ai/dsh-graph-flow-canvas-node-echo/typecheck
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
