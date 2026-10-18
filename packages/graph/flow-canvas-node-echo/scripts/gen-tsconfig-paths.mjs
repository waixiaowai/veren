/**
 * Generate this package's type path map from the panel's own map, rebasing
 * every target and adding the panel's built declarations.
 *
 * 从面板自己的映射生成本包的类型路径映射：重定基每个目标，并加入面板的构建声明。
 *
 * @module @deepseek-ai/dsh-graph-flow-canvas-node-echo/gen-tsconfig-paths
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const panel = resolve(root, '../flow-canvas-panel')

const read = JSON.parse(readFileSync(join(panel, 'tsconfig.paths.json'), 'utf8'))
const paths = {}
for (const [alias, targets] of Object.entries(read.compilerOptions.paths)) {
  paths[alias] = targets.map(target => target.startsWith('.') ? `../flow-canvas-panel/${target}` : target)
}
paths['@deepseek-ai/dsh-graph-flow-canvas-panel'] = ['../flow-canvas-panel/lib/types/index.d.ts']
paths['@deepseek-ai/dsh-graph-flow-canvas-panel/client'] = ['../flow-canvas-panel/lib/types/client/index.d.ts']

writeFileSync(
  join(root, 'tsconfig.paths.json'),
  `${JSON.stringify({
    $schema: 'https://json.schemastore.org/tsconfig',
    compilerOptions: { paths },
  }, undefined, 2)}\n`,
)
process.stdout.write(`wrote tsconfig.paths.json with ${String(Object.keys(paths).length)} aliases\n`)
