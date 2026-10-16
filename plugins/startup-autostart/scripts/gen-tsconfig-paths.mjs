/**
 * Generate the two path maps and the declaration-emit config from the Harness
 * checkout's own `tsconfig.base.json`.
 *
 * `tsconfig.paths.json` resolves `@deepseek-ai/*` to the checkout's **sources**,
 * which is what the checker uses so the plugin is validated against the real
 * Harness code.
 *
 * Inheriting the checkout's aliases directly is not enough: a bare `zod` import
 * from this directory resolves to the outer workspace's copy instead of the
 * checkout's, and two zod copies have two unrelated `ZodType` identities, which
 * makes passing a schema to `domainTable()` a type error. The map therefore
 * pins `zod` to the checkout.
 * @module @veren/startup-autostart/gen-tsconfig-paths
 */

import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const checkout = resolve(root, '../../deepseek/deepseek-harness')

const require = createRequire(join(checkout, 'package.json'))
const ts = require('typescript')

const read = ts.readConfigFile(join(checkout, 'tsconfig.base.json'), ts.sys.readFile)
if (read.error !== undefined) {
  throw new Error(`cannot read the checkout tsconfig: ${ts.flattenDiagnosticMessageText(read.error.messageText, ' ')}`)
}

/** Checkout root relative to this package, in POSIX form, so the file stays portable. */
const prefix = relative(root, checkout).replaceAll('\\', '/')

const paths = {}
for (const [alias, targets] of Object.entries(read.config.compilerOptions.paths ?? {})) {
  paths[alias] = targets.map(target => `${prefix}/${target.replace(/^\.\//, '')}`)
}
// The checkout aliases each Client package to its `index.ts`, which leaves the
// browser half's own entry (`@pkg/client`) unmapped: the repo resolves it
// through each package's `exports` map, and that map is not part of the alias
// set. Add the two forms the panel imports, derived from the aliased file's
// package root, so client sources are checked against the real Harness sources
// rather than reported as missing modules.
for (const [alias, targets] of Object.entries({ ...paths })) {
  const target = targets[0]
  if (target === undefined || !target.endsWith('/src')) continue
  paths[`${alias}/client`] = [`${target}/client/index.ts`]
  paths[`${alias}/*`] = [`${target}/*`]
}
// One zod copy for both the plugin and the Harness sources it is checked against.
paths.zod = [`${prefix}/node_modules/zod`]
// Same reason as `zod`, for the JSX face: a bare `react` import from this
// directory resolves to the outer workspace's `@types/react`, while the Client
// sources are checked against the checkout's copy. Two copies have two
// unrelated `ReactNode` identities, which makes every component registered into
// a slot a type error. Pin both entry points to the checkout.
paths.react = [`${prefix}/node_modules/@types/react/index.d.ts`]
paths['react/jsx-runtime'] = [`${prefix}/node_modules/@types/react/jsx-runtime.d.ts`]
paths['react-dom'] = [`${prefix}/node_modules/@types/react-dom/index.d.ts`]

mkdirSync(join(root, 'scripts'), { recursive: true })
writeFileSync(
  join(root, 'tsconfig.paths.json'),
  `${JSON.stringify({
    $schema: 'https://json.schemastore.org/tsconfig',
    compilerOptions: { paths },
  }, undefined, 2)}\n`,
)
process.stdout.write(`wrote tsconfig.paths.json with ${Object.keys(paths).length} aliases\n`)
