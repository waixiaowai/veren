/**
 * Generate `tsconfig.paths.json` for type-checking against the installed DSH
 * build and this repository's graph packages.
 *
 * Aliases prefer each package's built `lib/types` declarations, so the plugin's
 * `rootDir` emits only its own files; graph packages live outside the DSH
 * checkout and are resolved from this repository. Falling back to sources keeps
 * packages without a build usable during early development.
 *
 * 生成 `tsconfig.paths.json`，用于对已构建的 DSH 与本仓库 graph 包做类型检查。
 * 别名优先指向各包已构建的 `lib/types` 声明，这样插件的 `rootDir` 只emit自己的文件；
 * graph 包在 DSH 检出仓库之外，从本仓库解析。没有构建产物的包回退到源码。
 *
 * @module @deepseek-ai/dsh-graph-flow-canvas-panel/gen-tsconfig-paths
 */

import { existsSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const checkout = resolve(root, '../../../deepseek/deepseek-harness')
const repository = resolve(root, '../../..')

const require = createRequire(join(checkout, 'package.json'))
const ts = require('typescript')

const read = ts.readConfigFile(join(checkout, 'tsconfig.base.json'), ts.sys.readFile)
if (read.error !== undefined) {
  throw new Error(`cannot read the checkout tsconfig: ${ts.flattenDiagnosticMessageText(read.error.message, ' ')}`)
}

/** Checkout root relative to this package, in POSIX form, so the file stays portable. */
const prefix = relative(root, checkout).replaceAll('\\', '/')

/** Map one absolute source or directory target onto its built declaration when available. */
function preferBuilt(absolute) {
  // A directory target may end exactly at `src`, so test the suffix as well as
  // a `src` segment inside the path.
  const bare = `${sep}src`
  if (absolute.endsWith(bare)) {
    const candidate = `${absolute.slice(0, -bare.length)}${sep}lib${sep}types`
    if (existsSync(join(candidate, 'index.d.ts'))) return candidate
    return absolute
  }
  const marker = `${sep}src${sep}`
  const index = absolute.lastIndexOf(marker)
  if (index < 0) return absolute
  const builtRoot = `${absolute.slice(0, index)}${sep}lib${sep}types`
  const rest = absolute.slice(index + marker.length)
  if (rest.endsWith('.ts')) {
    const declaration = join(builtRoot, `${rest.slice(0, -3)}.d.ts`)
    return existsSync(declaration) ? declaration : absolute
  }
  if (rest.includes('*')) return absolute
  const candidate = rest === '' ? builtRoot : join(builtRoot, rest)
  return existsSync(join(candidate, 'index.d.ts')) ? candidate : absolute
}

/** Rewrite one tsconfig target for this package's relative path map. */
function target(value) {
  return relative(root, preferBuilt(resolve(checkout, value))).replaceAll('\\', '/')
}

const paths = {}
for (const [alias, targets] of Object.entries(read.config.compilerOptions.paths ?? {})) {
  paths[alias] = targets.map(value => target(value))
}
// Directory aliases leave the browser half's `@pkg/client` entry unmapped; add
// the two forms the panel imports.
for (const [alias, targets] of Object.entries({ ...paths })) {
  if (alias.includes('*')) continue
  const value = targets[0]
  if (value === undefined) continue
  const directory = value.endsWith('/src') || value.endsWith('/lib/types')
  if (!directory && !value.endsWith('/client')) continue
  const base = directory ? `${value}/client` : value
  paths[`${alias}/client`] = [`${base}/index.d.ts`]
  paths[`${alias}/*`] = [`${base}/*`]
}

// Graph packages live in this repository, not in the DSH checkout.
const graph = {
  '@deepseek-ai/dsh-graph-core': 'packages/graph/graph-core/lib/index.d.ts',
  '@deepseek-ai/dsh-graph-flow-api': 'packages/graph/flow-api/lib/index.d.ts',
  '@deepseek-ai/dsh-graph-flow-engine': 'packages/graph/flow-engine/lib/index.d.ts',
  '@deepseek-ai/dsh-graph-flow-canvas': 'packages/graph/flow-canvas/lib/index.d.ts',
  '@deepseek-ai/dsh-graph-flow-canvas/types': 'packages/graph/flow-canvas/lib/types.d.ts',
  '@veren/core': 'packages/core/dist/index.d.ts',
}
for (const [alias, value] of Object.entries(graph)) {
  paths[alias] = [relative(root, resolve(repository, value)).replaceAll('\\', '/')]
}

// One zod copy for both the plugin and the declarations it is checked against.
paths.zod = [`${prefix}/node_modules/zod`]
paths.react = [`${prefix}/node_modules/@types/react/index.d.ts`]
paths['react/jsx-runtime'] = [`${prefix}/node_modules/@types/react/jsx-runtime.d.ts`]
paths['react-dom'] = [`${prefix}/node_modules/@types/react-dom/index.d.ts`]
paths['react-dom/client'] = [`${prefix}/node_modules/@types/react-dom/client.d.ts`]
paths['@testing-library/react'] = [`${prefix}/node_modules/@testing-library/react/types/index.d.ts`]

writeFileSync(
  join(root, 'tsconfig.paths.json'),
  `${JSON.stringify({
    $schema: 'https://json.schemastore.org/tsconfig',
    compilerOptions: { paths },
  }, undefined, 2)}\n`,
)
process.stdout.write(`wrote tsconfig.paths.json with ${String(Object.keys(paths).length)} aliases\n`)
