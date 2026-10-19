/**
 * Type-check the plugin against the real Harness sources and report only the
 * plugin's own diagnostics.
 *
 * Compiling the checkout's sources under a standalone config surfaces that
 * checkout's project-reference-specific diagnostics too (the vendored Cordis
 * copy and a few packages are tuned by their own tsconfigs). None of them are
 * this plugin's, so this wrapper keeps them out of the exit status while still
 * failing on any diagnostic under `src/`.
 * 只报告技能插件源码与测试自身的诊断，不混入宿主仓库诊断。
 * @module @veren/startup-autostart-skill/typecheck
 */

import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const tsc = resolve(root, '../../deepseek/deepseek-harness/node_modules/typescript/bin/tsc')

const result = spawnSync(process.execPath, [tsc, '-p', join(root, 'tsconfig.json'), '--pretty', 'false'], {
  cwd: root,
  encoding: 'utf8',
})

const lines = `${result.stdout ?? ''}${result.stderr ?? ''}`.split(/\r?\n/)
const own = lines.filter(line => line.startsWith('src/') || line.startsWith('tests/'))
if (own.length > 0) {
  process.stderr.write(`${own.join('\n')}\n`)
  process.exit(1)
}
process.stdout.write('typecheck: no diagnostics under src/ or tests/\n')
