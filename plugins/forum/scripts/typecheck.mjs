/**
 * Type-check the plugin against the real Harness sources and report only the
 * plugin's own diagnostics.
 *
 * Compiling the checkout's sources under a standalone config surfaces that
 * checkout's project-reference-specific diagnostics too (the vendored Cordis
 * copy and a few packages are tuned by their own tsconfigs). None of them are
 * this plugin's, so this wrapper keeps them out of the exit status while still
 * failing on any diagnostic under `src/` or `tests/`.
 *
 * 对真实 Harness 源码做类型检查，只报告本插件自己的诊断。
 *
 * 在独立配置下编译检出仓库源码，也会冒出该仓库的项目引用类诊断（vendored Cordis 副本
 * 与少数包由各自的 tsconfig 调过）。它们都不是本插件的，因此这个包装把它们排除在退出码
 * 之外，同时对 `src/`、`tests/` 下的任何诊断失败。
 *
 * @module @veren/forum/typecheck
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
