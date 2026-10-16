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
 * 为工具插件生成宿主源码及 Harness 源码的类型路径映射。
 * @module @veren/startup-autostart-tool/gen-tsconfig-paths
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
// One zod copy for both the plugin and the Harness sources it is checked against.
paths.zod = [`${prefix}/node_modules/zod`]
// Resolve the Host's type surface directly while developing both plugins together.
// 在同一工作区开发两个插件时，直接解析宿主服务的类型接口。
paths['@veren/startup-autostart'] = ['../startup-autostart/src/index.ts']

mkdirSync(join(root, 'scripts'), { recursive: true })
writeFileSync(
  join(root, 'tsconfig.paths.json'),
  `${JSON.stringify({
    $schema: 'https://json.schemastore.org/tsconfig',
    compilerOptions: { paths },
  }, undefined, 2)}\n`,
)
process.stdout.write(`wrote tsconfig.paths.json with ${Object.keys(paths).length} aliases\n`)
