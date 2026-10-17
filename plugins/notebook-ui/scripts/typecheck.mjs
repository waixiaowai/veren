/**
 * Type-check the panel against the real Harness sources and report only this
 * package's own diagnostics.
 *
 * Compiling the checkout's sources under a standalone config surfaces that
 * checkout's project-reference-specific diagnostics too. None of them are this
 * plugin's, so this wrapper keeps them out of the exit status while still
 * failing on any diagnostic under `src/`.
 *
 * 对真实 Harness 源码做类型检查，只报告本包自己的诊断。在独立配置下编译检出仓库源码也会
 * 冒出该仓库的项目引用类诊断；它们都不是本插件的，因此这个包装把它们排除在退出码之外，同时
 * 对 `src/` 下的任何诊断失败。
 *
 * @module @veren/forum-ui/typecheck
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
const own = lines.filter(line => line.startsWith('src/'))
if (own.length > 0) {
  process.stderr.write(`${own.join('\n')}\n`)
  process.exit(1)
}
process.stdout.write('typecheck: no diagnostics under src/\n')
